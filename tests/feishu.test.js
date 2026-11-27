import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FeishuClient, FeishuDirectory, FeishuApiError, buildReminderCard, sendFeishuReminderCards } from '../server/feishu.js';
import { DirectoryError } from '../server/directory.js';
import { createDirectoryCache } from '../server/directory-cache.js';

const json = (payload, status = 200, headers = {}) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...headers } });
const token = () => json({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 });
const ok = data => json({ code: 0, msg: 'success', data });
const client = (fetchImpl, options = {}) => new FeishuClient({ appId: 'app', appSecret: 'secret', fetchImpl, ...options });
const user = id => ({ open_id: id, name: id, employee_no: `number-${id}`, enterprise_email: `${id}@example.com` });
const scope = (extra = {}) => ({ user_ids: [], department_ids: [], group_ids: [], has_more: false, ...extra });
const envelope = data => ({ code: 0, data });

test('tenant token uses internal endpoint, caches and coalesces concurrent requests', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, options });
    assert.equal(new URL(url).pathname, '/open-apis/auth/v3/tenant_access_token/internal');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { app_id: 'app', app_secret: 'secret' });
    assert.equal(options.headers.get('authorization'), null);
    return token();
  });
  assert.deepEqual(await Promise.all([api.getTenantToken(), api.getTenantToken(), api.getTenantToken()]), ['tenant-token', 'tenant-token', 'tenant-token']);
  assert.equal(await api.getTenantToken(), 'tenant-token');
  assert.equal(calls.length, 1);
  api.tokenExpiresAt = 0;
  await api.getTenantToken();
  assert.equal(calls.length, 2);
});

test('failed token request is not cached and can recover', async () => {
  let count = 0;
  const api = client(async () => ++count === 1 ? json({ code: 10003, msg: 'invalid app' }) : token());
  await assert.rejects(api.getTenantToken(), error => error instanceof FeishuApiError && error.code === 10003);
  assert.equal(await api.getTenantToken(), 'tenant-token');
  assert.equal(count, 2);
});

test('invalid token responses fail explicitly', async () => {
  for (const response of [{ code: 0 }, { code: 0, tenant_access_token: 'x', expire: 0 }, { code: 0, tenant_access_token: 'x', expire: '7200' }]) {
    await assert.rejects(client(async () => json(response)).getTenantToken(), /tenant_access_token\/expire/);
  }
});

test('request adds tenant auth, serializes body/query, returns full envelope and forbids redirect', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url: new URL(url), options });
    return calls.length === 1 ? token() : ok({ value: 1 });
  });
  const result = await api.request('/contact/v3/users', { method: 'POST', body: { value: 3 }, query: { q: 'a+b /', omit: undefined }, headers: { Authorization: 'Bearer attacker', 'X-Test': 'yes' } });
  assert.deepEqual(result, { code: 0, msg: 'success', data: { value: 1 } });
  const request = calls[1];
  assert.equal(request.url.origin, 'https://open.feishu.cn');
  assert.equal(request.url.pathname, '/open-apis/contact/v3/users');
  assert.equal(request.url.searchParams.get('q'), 'a+b /');
  assert.equal(request.url.searchParams.has('omit'), false);
  assert.equal(request.options.headers.get('authorization'), 'Bearer tenant-token');
  assert.equal(request.options.headers.get('x-test'), 'yes');
  assert.deepEqual(JSON.parse(request.options.body), { value: 3 });
  assert.equal(request.options.redirect, 'error');
  await api.request('/open-apis/contact/v3/scopes');
  assert.equal(calls[2].url.pathname, '/open-apis/contact/v3/scopes');
});

test('external paths and invalid configuration are rejected before any network call', async () => {
  const api = client(() => { throw new Error('must not fetch'); });
  for (const path of ['https://evil.example/x', '//evil.example/x', '/../../evil']) await assert.rejects(api.request(path), /路径|path/);
  assert.throws(() => new FeishuClient({}), /APP_ID/);
  assert.throws(() => client(fetch, { maxRetries: 6 }), /maxRetries/);
  assert.throws(() => client(fetch, { timeoutMs: 0 }), /timeoutMs/);
});

test('explicit API errors preserve code, HTTP status and request id without request credentials', async () => {
  let count = 0;
  const api = client(async () => ++count === 1 ? token() : json({ code: 41050, msg: 'no user authority' }, 403, { 'x-request-id': 'request-42' }));
  await assert.rejects(api.request('/contact/v3/users/u'), error => {
    assert.equal(error.code, 41050);
    assert.equal(error.status, 403);
    assert.equal(error.requestId, 'request-42');
    assert.match(error.message, /no user authority/);
    assert.doesNotMatch(error.message, /secret|tenant-token/);
    return true;
  });
  assert.equal(count, 2);
});

test('HTTP 429 is retried finitely and retry-after is honored', async () => {
  let count = 0;
  const api = client(async url => {
    if (url.includes('/auth/')) return token();
    count += 1;
    return count < 3 ? json({ code: 99991400, msg: 'rate limited' }, 429, { 'retry-after': '0' }) : ok({ done: true });
  });
  assert.deepEqual((await api.request('/contact/v3/scopes')).data, { done: true });
  assert.equal(count, 3);
});

test('HTTP-200 rate limit API errors and non-JSON 429 responses have bounded retries', async () => {
  for (const makeResponse of [
    () => json({ code: 99991400, msg: 'rate limited' }, 200, { 'retry-after': '0' }),
    () => new Response('busy', { status: 429, headers: { 'retry-after': '0' } }),
  ]) {
    let count = 0;
    const api = client(async url => {
      if (url.includes('/auth/')) return token();
      count += 1;
      return makeResponse();
    }, { maxRetries: 2 });
    await assert.rejects(api.request('/contact/v3/scopes'), /限流重试次数已耗尽/);
    assert.equal(count, 3);
  }
});

test('monthly quota exhaustion is not retried as a transient rate limit', async () => {
  let count = 0;
  const api = client(async url => {
    if (url.includes('/auth/')) return token();
    count += 1;
    return json({ code: 99991403, msg: 'monthly quota exceeded' });
  });
  await assert.rejects(api.request('/contact/v3/scopes'), error => error.code === 99991403);
  assert.equal(count, 1);
});

test('timeout bounds fetch and JSON body even when fetch ignores abort', async () => {
  const never = () => new Promise(() => {});
  const api = client(never, { timeoutMs: 10 });
  await assert.rejects(api.getTenantToken(), error => error.code === 'TIMEOUT');
  const slowBody = client(async () => ({ status: 200, ok: true, json: never }), { timeoutMs: 10 });
  await assert.rejects(slowBody.getTenantToken(), error => error.code === 'TIMEOUT');
});

test('cancellation and network/non-JSON errors remain explicit', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(client(() => { throw new Error('must not fetch'); }).request('/contact/v3/scopes', { signal: controller.signal }), /cancelled/);
  await assert.rejects(client(async () => { throw new Error('secret in fetch error'); }).getTenantToken(), error => error.code === 'NETWORK_ERROR' && !error.message.includes('secret'));
  await assert.rejects(client(async () => new Response('<html>error</html>', { status: 502 })).getTenantToken(), /非 JSON.*502/);
  await assert.rejects(client(async () => json({ data: {} })).getTenantToken(), /合法 API 状态/);
});

test('department user pagination passes correct ID types and page token', async () => {
  const calls = [];
  const directory = new FeishuDirectory({ request: async (path, options) => {
    calls.push({ path, options });
    return envelope(calls.length === 1 ? { items: [user('a')], has_more: true, page_token: 'next+/=' } : { items: [user('b')], has_more: false });
  } });
  assert.deepEqual((await directory.listDepartmentUsers('od-one')).map(item => item.open_id), ['a', 'b']);
  assert.equal(calls[0].path, '/contact/v3/users/find_by_department');
  assert.deepEqual(calls[0].options.query, { user_id_type: 'open_id', department_id_type: 'open_department_id', department_id: 'od-one', page_size: 50, page_token: undefined });
  assert.equal(calls[1].options.query.page_token, 'next+/=');
});

test('descendant lookup requests recursive children and getUser requests open_id', async () => {
  const directory = new FeishuDirectory({ request: async (path, { query }) => {
    assert.equal(query.user_id_type, 'open_id');
    assert.equal(query.department_id_type, 'open_department_id');
    if (path.includes('/children')) {
      assert.equal(path, '/contact/v3/departments/od-parent/children');
      assert.equal(query.fetch_child, true);
      return envelope({ items: [{ open_department_id: 'od-child' }], has_more: false });
    }
    assert.equal(path, '/contact/v3/users/u%2Fone');
    return envelope({ user: user('u/one') });
  } });
  assert.deepEqual(await directory.listDescendantDepartments('od-parent'), [{ open_department_id: 'od-child' }]);
  assert.equal((await directory.getUser('u/one')).open_id, 'u/one');
});

test('scopes enumerates standalone users, departments and descendants, deduplicating overlap', async () => {
  const calls = [];
  const directory = new FeishuDirectory({ request: async (path, { query }) => {
    calls.push({ path, query });
    if (path.endsWith('/scopes')) {
      assert.equal(query.page_size, 100);
      return envelope(query.page_token ? scope({ department_ids: ['od-root'] }) : scope({ user_ids: ['solo', 'a'], has_more: true, page_token: 'scope-next' }));
    }
    if (path.endsWith('/children')) return envelope({ items: [{ open_department_id: 'od-child' }], has_more: false });
    if (path.endsWith('/find_by_department')) return envelope({ items: query.department_id === 'od-root' ? [user('a')] : [user('a'), user('b')], has_more: false });
    if (path.endsWith('/users/batch')) {
      const ids = [].concat(query.user_ids || []);
      return envelope({ items: ids.map(id => user(id)) });
    }
    return envelope({ user: user(path.split('/').at(-1)) });
  } });
  assert.deepEqual((await directory.listAllUsers()).map(item => item.open_id), ['solo', 'a', 'b']);
  assert.deepEqual(calls.filter(call => call.path.endsWith('/find_by_department')).map(call => call.query.department_id).sort(), ['od-child', 'od-root']);
  assert.ok(calls.some(call => call.path.endsWith('/users/batch')));
  assert.ok(!calls.some(call => call.query.department_id === '0'));
});

test('unknown scopes fail closed before any user result is fetched', async () => {
  for (const data of [{ has_more: false, department_ids: [] }, scope({ unknown_ids: ['x'] }), scope({ user_ids: [null] })]) {
    let calls = 0;
    const directory = new FeishuDirectory({ request: async path => {
      calls += 1;
      assert.equal(path, '/contact/v3/scopes');
      return envelope(data);
    } });
    await assert.rejects(directory.listAllUsers(), /授权范围/);
    assert.equal(calls, 1);
  }
});

test('group scopes expand user and department members then continue scanning', async () => {
  const calls = [];
  const directory = new FeishuDirectory({ request: async (path, options) => {
    calls.push({ path, query: options.query });
    if (path === '/contact/v3/scopes') {
      return envelope(scope({ user_ids: ['solo'], group_ids: ['g1'] }));
    }
    if (path === '/contact/v3/group/g1/member/simplelist') {
      assert.equal(options.query.member_id_type, 'open_id');
      if (options.query.member_type === 'user') {
        return envelope({ memberlist: [{ member_id: 'ou_from_group', member_type: 'user' }], has_more: false });
      }
      return envelope({ memberlist: [{ member_id: 'od-from-group', member_type: 'department' }], has_more: false });
    }
    if (path.endsWith('/children')) return envelope({ items: [], has_more: false });
    if (path.endsWith('/find_by_department')) {
      assert.equal(options.query.department_id, 'od-from-group');
      return envelope({ items: [user('dept_user')], has_more: false });
    }
    if (path.endsWith('/users/batch')) {
      return envelope({ items: [].concat(options.query.user_ids || []).map(id => user(id)) });
    }
    return envelope({ user: user(path.split('/').at(-1)) });
  } });
  assert.deepEqual((await directory.listAllUsers()).map(item => item.open_id).sort(), ['dept_user', 'ou_from_group', 'solo']);
  assert.ok(calls.some(call => call.path === '/contact/v3/group/g1/member/simplelist' && call.query.member_type === 'user'));
  assert.ok(calls.some(call => call.path === '/contact/v3/group/g1/member/simplelist' && call.query.member_type === 'department'));
});

test('group scopes on later page are expanded; explicitly empty scope succeeds', async () => {
  let count = 0;
  const directory = new FeishuDirectory({ request: async (path, options) => {
    if (path === '/contact/v3/scopes') {
      count += 1;
      return envelope(count === 1 ? scope({ user_ids: ['a'], has_more: true, page_token: 'next' }) : scope({ group_ids: ['g'] }));
    }
    if (path === '/contact/v3/group/g/member/simplelist') {
      return envelope({ memberlist: options.query.member_type === 'user' ? [{ member_id: 'a' }] : [], has_more: false });
    }
    if (path.endsWith('/users/batch')) {
      return envelope({ items: [].concat(options.query.user_ids || []).map(id => user(id)) });
    }
    return envelope({ user: user(path.split('/').at(-1)) });
  } });
  assert.deepEqual((await directory.listAllUsers()).map(item => item.open_id), ['a']);
  const emptyClient = { request: async () => envelope(scope()) };
  assert.deepEqual(await new FeishuDirectory(emptyClient).listAllUsers(), []);
});

test('listAllUsers caches completed scans in memory and on disk', async () => {
  let scopes = 0;
  const client = { request: async path => {
    if (path.endsWith('/scopes')) {
      scopes += 1;
      return envelope(scope({ user_ids: ['a'] }));
    }
    if (path.endsWith('/users/batch')) return envelope({ items: [user('a')] });
    throw new Error(`unexpected ${path}`);
  } };
  const cache = createDirectoryCache({ filePath: null, ttlMs: 60_000, appId: 'cli_test' });
  const first = new FeishuDirectory(client, { cache });
  assert.deepEqual((await first.listAllUsers()).map(item => item.open_id), ['a']);
  assert.equal(scopes, 1);
  assert.deepEqual((await first.withSignal(undefined).listAllUsers()).map(item => item.open_id), ['a']);
  assert.equal(scopes, 1);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'feishu-dir-cache-'));
  const filePath = path.join(dir, 'cache.json');
  const diskCache = createDirectoryCache({ filePath, ttlMs: 3_600_000, appId: 'cli_test' });
  const diskDir = new FeishuDirectory(client, { cache: diskCache });
  assert.deepEqual((await diskDir.listAllUsers()).map(item => item.open_id), ['a']);
  assert.equal(scopes, 2);
  const cold = new FeishuDirectory(client, {
    cache: createDirectoryCache({ filePath, ttlMs: 3_600_000, appId: 'cli_test' }),
  });
  assert.deepEqual((await cold.listAllUsers()).map(item => item.open_id), ['a']);
  assert.equal(scopes, 2);
  const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(raw.appId, 'cli_test');
  assert.equal(raw.users[0].employee_no, 'number-a');
  await fs.rm(dir, { recursive: true, force: true });
});

test('repeated or missing pagination tokens fail rather than return partial users', async () => {
  for (const pageToken of ['same', undefined, '']) {
    let count = 0;
    const directory = new FeishuDirectory({ request: async () => {
      count += 1;
      return envelope({ items: [user('a')], has_more: true, page_token: pageToken });
    } });
    await assert.rejects(directory.listDepartmentUsers('od-one'), /token 缺失或重复/);
    assert.ok(count <= 2);
  }
});

test('pagination page cap prevents endless unique tokens', async () => {
  let count = 0;
  const directory = new FeishuDirectory({ request: async () => envelope({ items: [], has_more: true, page_token: `page-${++count}` }) });
  await assert.rejects(directory.listDepartmentUsers('od-one'), /1000 页/);
  assert.equal(count, 1000);
});

test('malformed data, mismatched user ID and oversized scans reject', async () => {
  for (const data of [{}, { has_more: 'false', items: [] }, { has_more: false, items: {} }]) {
    const directory = new FeishuDirectory({ request: async () => envelope(data) });
    await assert.rejects(directory.listDepartmentUsers('od-one'), /格式未知|不是数组/);
  }
  await assert.rejects(new FeishuDirectory({ request: async () => envelope({ user: user('b') }) }).getUser('a'), /不一致/);
  const huge = new FeishuDirectory({ request: async () => envelope({ items: Array(25001).fill(user('a')), has_more: false }) });
  await assert.rejects(huge.listDepartmentUsers('od-one'), /25000/);
});

test('scope and pagination integrity errors are safe DirectoryError instances', async () => {
  const check = error => {
    assert.ok(error instanceof DirectoryError);
    assert.equal(error.name, 'DirectoryError');
    assert.doesNotMatch(error.message, /private-group-id|secret-page-token/);
    return true;
  };
  await assert.rejects(new FeishuDirectory({ request: async () => envelope(scope({ unknown_ids: ['private-group-id'] })) }).listAllUsers(), check);
  await assert.rejects(new FeishuDirectory({ request: async () => envelope({ has_more: false }) }).listAllUsers(), check);
  await assert.rejects(new FeishuDirectory({ request: async () => envelope({ items: [], has_more: true, page_token: 'secret-page-token' }) }).listDepartmentUsers('od-one'), check);
});

test('withSignal creates isolated instances and cancellation prevents pagination followups', async () => {
  const controller = new AbortController();
  const reason = new Error('scan cancelled');
  let calls = 0;
  const original = new FeishuDirectory({ request: async (path, options) => {
    calls += 1;
    assert.equal(options.signal, controller.signal);
    controller.abort(reason);
    return envelope({ items: [user('a')], has_more: true, page_token: 'next' });
  } });
  const scoped = original.withSignal(controller.signal);
  assert.notEqual(scoped, original);
  assert.equal(original.signal, undefined);
  assert.equal(scoped.client, original.client);
  await assert.rejects(scoped.listDepartmentUsers('od-one'), error => error === reason);
  assert.equal(calls, 1);
  await assert.rejects(scoped.getUser('a'), error => error === reason);
  assert.equal(calls, 1);
});

test('whole scan cancellation stops direct users and authorized department expansion', async () => {
  for (const mode of ['users', 'roots', 'departments']) {
    const controller = new AbortController();
    const reason = new Error(`cancel ${mode}`);
    const calls = [];
    const directory = new FeishuDirectory({ request: async (path, { signal }) => {
      assert.equal(signal, controller.signal);
      calls.push(path);
      if (path.endsWith('/scopes')) return envelope(scope(mode === 'users' ? { user_ids: ['a', 'b'] } : { department_ids: ['od-one', 'od-two'] }));
      if (mode === 'users') {
        controller.abort(reason);
        if (path.endsWith('/users/batch')) return envelope({ items: [user('a')] });
        return envelope({ user: user('a') });
      }
      if (path.endsWith('/children')) {
        if (mode === 'roots') controller.abort(reason);
        return envelope({ items: [], has_more: false });
      }
      controller.abort(reason);
      return envelope({ items: [user('a')], has_more: false });
    } }, { signal: controller.signal });
    await assert.rejects(directory.listAllUsers(), error => error === reason);
    assert.equal(calls.length, mode === 'departments' ? 4 : 2);
  }
});

test('client cancellation rejects before shared token completes without cancelling other callers', async () => {
  const controller = new AbortController();
  const reason = new Error('scan deadline expired');
  let release;
  let tokenStarted;
  const started = new Promise(resolve => { tokenStarted = resolve; });
  let calls = 0;
  const api = client(async () => {
    calls += 1;
    tokenStarted();
    return new Promise(resolve => { release = () => resolve(token()); });
  });
  const request = api.request('/contact/v3/scopes', { signal: controller.signal });
  await started;
  const otherCaller = api.getTenantToken();
  let otherCompleted = false;
  otherCaller.then(() => { otherCompleted = true; });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  controller.abort(reason);
  // This must settle before release(), rather than waiting for the token request.
  await assert.rejects(request, error => error === reason);
  assert.equal(otherCompleted, false);
  assert.equal(api.token, null);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  release();
  assert.equal(await otherCaller, 'tenant-token');
  assert.equal(calls, 1);
});

test('cancelled token wait observes later refresh failure and removes its listener', async () => {
  const controller = new AbortController();
  const reason = new Error('cancel pending token');
  let rejectToken;
  const api = client(async () => new Promise((resolve, reject) => { rejectToken = reject; }));
  const request = api.request('/contact/v3/scopes', { signal: controller.signal });
  const otherCaller = api.getTenantToken();
  controller.abort(reason);
  await assert.rejects(request, error => error === reason);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const failure = assert.rejects(otherCaller, error => error.code === 'NETWORK_ERROR');
  rejectToken(new Error('upstream failed after cancellation'));
  await failure;
  assert.equal(api.tokenPromise, null);
});

test('successful token waits remove listeners and pre-aborted requests never start refresh', async () => {
  const controller = new AbortController();
  let calls = 0;
  const api = client(async () => ++calls === 1 ? token() : ok({ done: true }));
  await api.request('/contact/v3/scopes', { signal: controller.signal });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const reason = new Error('already cancelled');
  controller.abort(reason);
  const fresh = client(async () => { calls += 1; return token(); });
  await assert.rejects(fresh.request('/contact/v3/scopes', { signal: controller.signal }), error => error === reason);
  assert.equal(calls, 2);
  assert.equal(fresh.tokenPromise, null);
});

test('provider errors propagate without returning partially scanned directory', async () => {
  const failure = new FeishuApiError('no authority', { code: 41050 });
  const directory = new FeishuDirectory({ request: async path => {
    if (path.endsWith('/scopes')) return envelope(scope({ user_ids: ['a', 'b'] }));
    if (path.endsWith('/a')) return envelope({ user: user('a') });
    throw failure;
  } });
  await assert.rejects(directory.listAllUsers(), error => error === failure);
});

test('department scan records membership when Feishu omits department_ids', async () => {
  const directory = new FeishuDirectory({ request: async (path, { query }) => {
    if (path.endsWith('/scopes')) return envelope(scope({ department_ids: ['od-root'] }));
    if (path.endsWith('/children')) return envelope({ items: [{ open_department_id: 'od-child', name: '子部门' }], has_more: false });
    if (path.endsWith('/find_by_department')) return envelope({ items: [user(query.department_id === 'od-root' ? 'a' : 'b')], has_more: false });
    return envelope({ items: [], has_more: false });
  } });
  const users = await directory.listAllUsers();
  const byId = new Map(users.map(item => [item.open_id, item.department_ids]));
  assert.deepEqual(byId.get('a'), ['od-root']);
  assert.deepEqual(byId.get('b'), ['od-child']);
});

test('department names prefer API fields and fill gaps from the local fallback file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'feishu-dept-names-'));
  const filePath = path.join(dir, 'department-names.json');
  await fs.writeFile(filePath, JSON.stringify({ departments: { 'od-hidden': '财务部', 'od-named': '不应覆盖' } }));
  const directory = new FeishuDirectory({ request: async path => {
    assert.equal(path, '/contact/v3/departments/0/children');
    return envelope({
      items: [
        { open_department_id: 'od-named', name: '研发部' },
        { open_department_id: 'od-i18n', i18n_name: { zh_cn: '市场部' } },
        { open_department_id: 'od-hidden' },
      ],
      has_more: false,
    });
  } }, { departmentNamesFile: filePath });
  const names = await directory.getDepartmentNameMap();
  assert.equal(names.get('od-named'), '研发部');
  assert.equal(names.get('od-i18n'), '市场部');
  assert.equal(names.get('od-hidden'), '财务部');
  await fs.rm(dir, { recursive: true, force: true });
});

test('bot-disabled reminder stops after the global failure and explains how to enable it', async () => {
  let calls = 0;
  const delivery = await sendFeishuReminderCards({
    request: async () => {
      calls += 1;
      throw new FeishuApiError('Bot ability is not activated.', { code: 230006 });
    },
  }, {
    recipients: [{ openId: 'ou_a', name: '甲' }, { openId: 'ou_b', name: '乙' }, { openId: 'ou_c', name: '丙' }],
    card: buildReminderCard({ title: '制度', ackUrl: 'https://ops.example.com/ack/demo' }),
    concurrency: 1,
  });
  assert.equal(calls, 1);
  assert.equal(delivery.sentCount, 0);
  assert.equal(delivery.failedCount, 3);
  assert.equal(delivery.failures[0].code, 230006);
  assert.match(delivery.failures[0].message, /机器人/);
  assert.equal(delivery.failures[2].message, delivery.failures[0].message);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { createApp, loadConfig } from '../server/app.js';

const ORIGIN = 'http://localhost:5173';
const feishuConfig = (extra = {}) => ({ mode: 'feishu', appOrigin: ORIGIN, appId: 'cli_test', appSecret: 'SECRET_NOT_FOR_BROWSER', tenantKey: 'tenant_expected', directoryCachePath: null, ...extra });
const user = { open_id: 'ou_allowed', name: '测试成员', tenant_key: 'tenant_expected' };
const mockUser = { open_id: 'ou_allowed', name: '测试成员', employee_no: '0012', enterprise_email: 'member@example.com' };
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
function authFetch(identity = user, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://accounts.feishu.cn/oauth/v3/token') return json({ code: 0, access_token: 'USER_TOKEN_SECRET', expires_in: 7200 });
    if (url === 'https://open.feishu.cn/open-apis/authen/v1/user_info') return json({ code: 0, data: identity });
    throw new Error(`Unexpected test fetch: ${url}`);
  };
}
const provider = (extra = {}) => ({
  listAllUsers: async () => [mockUser], getUser: async id => id === mockUser.open_id ? mockUser : null,
  listDepartmentUsers: async () => [mockUser], listDescendantDepartments: async () => [], ...extra,
});
async function server(t, options = {}) {
  const app = createApp(options);
  const http = app.listen(0, '127.0.0.1');
  await once(http, 'listening');
  t.after(async () => { http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); });
  const base = `http://127.0.0.1:${http.address().port}`;
  const request = (route, { method = 'GET', body, cookie, origin = ORIGIN, headers = {} } = {}) => fetch(base + route, {
    method, headers: { ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { app, base, request };
}
async function login(request) {
  const response = await request('/api/auth/feishu', { method: 'POST', body: { code: 'one-time-code' } });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return { response, cookie: response.headers.get('set-cookie').split(';')[0] };
}

test('configuration fails closed in production and validates origin and proxy', () => {
  assert.equal(loadConfig({}).mode, 'demo');
  assert.equal(loadConfig({}).host, '127.0.0.1');
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /APP_MODE/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', APP_MODE: 'demo' }), /APP_MODE/);
  assert.throws(() => loadConfig({ APP_MODE: 'feishu' }), /FEISHU/);
  const env = { NODE_ENV: 'production', APP_MODE: 'feishu', APP_ORIGIN: 'https://app.example.com', FEISHU_APP_ID: 'cli_test', FEISHU_APP_SECRET: 'secret' };
  assert.equal(loadConfig(env).production, true);
  assert.equal(loadConfig(env).tenantKey, '');
  assert.throws(() => loadConfig({ ...env, APP_ORIGIN: 'http://app.example.com' }), /HTTPS/);
  assert.throws(() => loadConfig({ ...env, APP_ORIGIN: 'https://user:pass@app.example.com' }), /APP_ORIGIN/);
  assert.throws(() => loadConfig({ ...env, APP_ORIGIN: 'https://app.example.com/path' }), /APP_ORIGIN/);
  assert.throws(() => loadConfig({ ...env, TRUST_PROXY: '2' }), /TRUST_PROXY/);
  assert.throws(() => loadConfig({ ...env, ALLOWED_OPEN_IDS: 'not-an-openid' }), /ALLOWED_OPEN_IDS/);
  assert.equal(loadConfig({ ...env, TRUST_PROXY: '1', ALLOWED_OPEN_IDS: 'ou_one, ou_two' }).trustProxy, 1);
});

test('demo bootstrap and both resolve modes work without live credentials', async t => {
  const { request } = await server(t, { config: { mode: 'demo' } });
  const response = await request('/api/bootstrap');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const boot = await response.json();
  assert.equal(boot.mode, 'demo');
  assert.equal(boot.authenticated, true);
  assert.equal(boot.demoContacts.length, 8);
  assert.equal(boot.limits.employeeNumbers, 1000);
  const byNumber = await request('/api/resolve/employee-numbers', { method: 'POST', body: { numbers: ['E1001', 'E1003'] } });
  assert.equal(byNumber.status, 200);
  const numbers = await byNumber.json();
  assert.deepEqual(numbers.emails, ['lin.xiao@example.com']);
  assert.equal(numbers.issues[0].reason, 'missing_email');
  const bySelection = await request('/api/resolve/selection', { method: 'POST', body: { userIds: [boot.demoContacts[0].open_id], departmentIds: ['od-demo-rd'], includeChildren: true } });
  assert.equal(bySelection.status, 200);
  const selection = await bySelection.json();
  assert.equal(selection.emails.length, 3);
  assert.equal(selection.stats.people, 4);
  const direct = await request('/api/resolve/selection', { method: 'POST', body: { departmentIds: ['od-demo-rd'], includeChildren: false } });
  assert.deepEqual((await direct.json()).emails, []);
});

test('CSRF rejects absent, malicious and lookalike Origin on every mutation', async t => {
  const { request, base } = await server(t, { config: { mode: 'demo' } });
  for (const route of ['/api/resolve/employee-numbers', '/api/resolve/selection', '/api/auth/feishu', '/api/auth/logout']) {
    for (const origin of ['https://evil.example', `${ORIGIN}.evil.example`, 'null']) {
      const response = await request(route, { method: 'POST', origin, body: {} });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, 'ORIGIN_REJECTED');
    }
    assert.equal((await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
  }
});

test('input validation rejects malformed bodies, oversize payloads and wrong ID types', async t => {
  const { request, base } = await server(t, { config: { mode: 'demo' } });
  for (const numbers of [[], [12], [''], ['line\nbreak'], Array(1001).fill('E1001')]) {
    assert.equal((await request('/api/resolve/employee-numbers', { method: 'POST', body: { numbers } })).status, 400);
  }
  for (const body of [{}, { userIds: ['user_id_not_open_id'] }, { departmentIds: ['custom_department_id'] }, { userIds: ['ou_x'], includeChildren: 'true' }, { departmentIds: Array(101).fill('od-test') }, { userIds: ['ou_x/../evil'] }]) {
    assert.equal((await request('/api/resolve/selection', { method: 'POST', body })).status, 400);
  }
  const malformed = await fetch(base + '/api/resolve/employee-numbers', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{not-json' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
  const huge = await request('/api/resolve/employee-numbers', { method: 'POST', body: { numbers: ['x'.repeat(70_000)] } });
  assert.equal(huge.status, 413);
  const wrongType = await fetch(base + '/api/resolve/employee-numbers', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(wrongType.status, 415);
});

test('live bootstrap requires authentication and does not expose demo or secret data', async t => {
  const { request } = await server(t, { config: feishuConfig(), directory: provider(), fetchImpl: authFetch() });
  const response = await request('/api/bootstrap');
  const body = await response.json();
  assert.equal(body.mode, 'feishu');
  assert.equal(body.authenticated, false);
  assert.equal(body.user, null);
  assert.equal(body.demoContacts, undefined);
  assert.equal(JSON.stringify(body).includes('SECRET'), false);
  assert.equal((await request('/api/feishu/js-config?url=' + encodeURIComponent(ORIGIN + '/'))).status, 401);
  assert.equal((await request('/api/resolve/employee-numbers', { method: 'POST', body: { numbers: ['0012'] } })).status, 401);
});

test('OAuth uses v3 then user_info, rotates HttpOnly sessions and logout revokes them', async t => {
  const calls = [];
  const { request } = await server(t, { config: feishuConfig(), directory: provider(), fetchImpl: authFetch(user, calls) });
  const first = await login(request);
  const setCookie = first.response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Max-Age=3600/);
  assert.doesNotMatch(setCookie, /Secure/);
  assert.equal(calls[0].url, 'https://accounts.feishu.cn/oauth/v3/token');
  assert.equal(calls[0].options.body.get('client_secret'), 'SECRET_NOT_FOR_BROWSER');
  assert.equal(calls[0].options.body.get('code'), 'one-time-code');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer USER_TOKEN_SECRET');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(JSON.stringify(await first.response.json()).includes('TOKEN'), false);
  assert.equal((await (await request('/api/bootstrap', { cookie: first.cookie })).json()).authenticated, true);
  const resolved = await request('/api/resolve/employee-numbers', { method: 'POST', cookie: first.cookie, body: { numbers: ['0012'] } });
  assert.deepEqual((await resolved.json()).emails, ['member@example.com']);
  const second = await request('/api/auth/feishu', { method: 'POST', cookie: first.cookie, body: { code: 'new-code' } });
  const nextCookie = second.headers.get('set-cookie').split(';')[0];
  assert.notEqual(nextCookie, first.cookie);
  assert.equal((await (await request('/api/bootstrap', { cookie: first.cookie })).json()).authenticated, false);
  assert.equal((await request('/api/auth/logout', { method: 'POST', cookie: nextCookie })).status, 200);
  assert.equal((await (await request('/api/bootstrap', { cookie: nextCookie })).json()).authenticated, false);
});

test('tenant key is not required and optional user allowlist is enforced before setting a session', async t => {
  const mismatchedTenant = await server(t, {
    config: feishuConfig({ tenantKey: '' }),
    directory: provider(),
    fetchImpl: authFetch({ ...user, tenant_key: 'tenant_other' }),
  });
  assert.equal((await mismatchedTenant.request('/api/auth/feishu', { method: 'POST', body: { code: 'code' } })).status, 200);

  const { request } = await server(t, { config: feishuConfig({ allowedOpenIds: ['ou_other'] }), directory: provider(), fetchImpl: authFetch(user) });
  const response = await request('/api/auth/feishu', { method: 'POST', body: { code: 'code' } });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await response.json()).error.code, 'USER_REJECTED');
});

test('production sessions are Secure and Helmet CSP only allows official SDK scripts', async t => {
  const { request } = await server(t, { config: feishuConfig({ production: true, appOrigin: 'https://app.example.com' }), directory: provider(), fetchImpl: authFetch() });
  const response = await request('/api/auth/feishu', { method: 'POST', origin: 'https://app.example.com', body: { code: 'code' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Secure/);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' 'unsafe-eval' https:\/\/lf-scm-cn\.feishucdn\.com/);
  assert.match(csp, /connect-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('session cap is enforced and expired sessions are removed on next request', async t => {
  const { request } = await server(t, { config: feishuConfig({ maxSessions: 1, sessionTtlMs: 100 }), directory: provider(), fetchImpl: authFetch() });
  const first = await login(request);
  const rejected = await request('/api/auth/feishu', { method: 'POST', body: { code: 'other-code' } });
  assert.equal(rejected.status, 503);
  assert.equal((await rejected.json()).error.code, 'SESSION_LIMIT');
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal((await (await request('/api/bootstrap', { cookie: first.cookie })).json()).authenticated, false);
  assert.equal((await request('/api/auth/feishu', { method: 'POST', body: { code: 'after-expiry' } })).status, 200);
});

test('JS config signs exact URL, caches ticket and makes fresh nonce each time', async t => {
  let requests = 0;
  const client = { request: async (route, options) => {
    requests += 1;
    assert.equal(route, '/jssdk/ticket/get');
    assert.equal(options.method, 'POST');
    return { code: 0, data: { ticket: 'TICKET_SECRET', expire_in: 7200 } };
  } };
  const { request } = await server(t, { config: feishuConfig(), client, directory: provider(), fetchImpl: authFetch() });
  const { cookie } = await login(request);
  const url = ORIGIN + '/page?x=%2f&y=two';
  const route = '/api/feishu/js-config?url=' + encodeURIComponent(url);
  const response = await request(route, { cookie });
  assert.equal(response.status, 200);
  const a = await response.json();
  const b = await (await request(route, { cookie })).json();
  const expected = crypto.createHash('sha1').update(`jsapi_ticket=TICKET_SECRET&noncestr=${a.nonceStr}&timestamp=${a.timestamp}&url=${url}`).digest('hex');
  assert.equal(a.signature, expected);
  assert.notEqual(a.nonceStr, b.nonceStr);
  assert.equal(requests, 1);
  assert.equal(typeof a.timestamp, 'number');
  assert.ok(a.timestamp > 1e12);
  assert.equal(JSON.stringify(a).includes('TICKET_SECRET'), false);
  for (const bad of ['https://evil.example/', 'http://localhost.evil.example:5173/', ORIGIN + '/#hash', 'http://user:pass@localhost:5173/']) {
    assert.equal((await request('/api/feishu/js-config?url=' + encodeURIComponent(bad), { cookie })).status, 403);
  }
  assert.equal((await request('/api/feishu/js-config', { cookie })).status, 400);
  assert.equal(requests, 1);
});

test('global query concurrency rejects excess work and recovers after failures', async t => {
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const directory = provider({ listAllUsers: async () => { started(); await blocked; return [mockUser]; } });
  const { request } = await server(t, { config: { mode: 'demo', maxConcurrentQueries: 1 }, directory });
  const first = request('/api/resolve/employee-numbers', { method: 'POST', body: { numbers: ['0012'] } });
  await entered;
  const second = await request('/api/resolve/employee-numbers', { method: 'POST', body: { numbers: ['0012'] } });
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error.code, 'BUSY');
  release();
  assert.equal((await first).status, 200);
  assert.equal((await request('/api/resolve/employee-numbers', { method: 'POST', body: { numbers: ['0012'] } })).status, 200);
});

test('API errors and credential-bearing upstream details never reach responses', async t => {
  const { request } = await server(t, { config: { mode: 'demo' }, directory: provider({ listAllUsers: async () => { throw new Error('RAW_STACK SECRET_NOT_FOR_BROWSER bearer token'); } }) });
  const response = await request('/api/resolve/employee-numbers', { method: 'POST', body: { numbers: ['0012'] } });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(body), /RAW_STACK|SECRET|bearer/);
  assert.equal((await request('/api/no-such-api')).status, 404);
  const source = await request('/server/app.js');
  assert.doesNotMatch(await source.text(), /import express|SECRET_NOT_FOR_BROWSER/);
  assert.equal((await request('/.env')).status, 404);
});

test('OAuth HTTP-200 business failure and hanging fetch yield safe failures', async t => {
  const failed = await server(t, { config: feishuConfig(), directory: provider(), fetchImpl: async () => json({ code: 20005, msg: 'RAW_SECRET' }) });
  const response = await failed.request('/api/auth/feishu', { method: 'POST', body: { code: 'code' } });
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /RAW_SECRET/);
  const stalled = await server(t, { config: feishuConfig({ requestTimeoutMs: 30 }), directory: provider(), fetchImpl: async () => new Promise(() => {}) });
  const timeout = await stalled.request('/api/auth/feishu', { method: 'POST', body: { code: 'code' } });
  assert.equal(timeout.status, 504);
  assert.equal((await timeout.json()).error.code, 'AUTH_TIMEOUT');
});

test('login endpoint rate limit returns structured JSON', async t => {
  const { request } = await server(t, { config: feishuConfig(), directory: provider(), fetchImpl: authFetch() });
  for (let i = 0; i < 10; i += 1) assert.equal((await request('/api/auth/feishu', { method: 'POST', body: {} })).status, 400);
  const response = await request('/api/auth/feishu', { method: 'POST', body: {} });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, 'RATE_LIMITED');
});

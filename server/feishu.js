import fs from 'node:fs/promises';
import { assertScanLimit, departmentId, userId, SCOPE_NOTE, DirectoryError } from './directory.js';

const ORIGIN = 'https://open.feishu.cn';
const TOKEN_PATH = '/open-apis/auth/v3/tenant_access_token/internal';
// Monthly quota exhaustion (99991403) is not a transient frequency limit.
const RATE_LIMIT_CODES = new Set([99991400, 1000004, 1000005]);
const MAX_PAGES = 1000;

export class FeishuApiError extends Error {
  constructor(message, { code, status, path, requestId, cause } = {}) {
    super(message, { cause });
    this.name = 'FeishuApiError';
    this.code = code;
    this.status = status;
    this.path = path;
    this.requestId = requestId;
  }
}

function apiUrl(path, query) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    throw new TypeError('飞书 API path 必须为相对路径，不能传入外部网址');
  }
  const url = new URL(path.startsWith('/open-apis/') ? path : `/open-apis${path}`, ORIGIN);
  if (url.origin !== ORIGIN || !url.pathname.startsWith('/open-apis/')) throw new TypeError('无效的飞书 API 路径');
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function mapPool(items, concurrency, worker) {
  const list = [...items];
  if (!list.length) return [];
  const limit = Math.min(Math.max(1, concurrency), list.length);
  const results = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await worker(list[index], index);
    }
  }));
  return results;
}

function checkTimeout(value) {
  if (!Number.isFinite(value) || value < 1 || value > 60_000) throw new RangeError('timeoutMs 必须在 1–60000 毫秒之间');
  return value;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason || new Error('请求已取消')); return; }
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason || new Error('请求已取消')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

// Cancel only this wait, never the shared token refresh. Both settlement handlers
// remain attached so a later refresh failure is observed even after cancellation.
function waitForShared(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      cleanup();
      reject(signal.reason || new Error('请求已取消'));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); },
    );
    if (signal.aborted) abort();
  });
}

export class FeishuClient {
  constructor({ appId, appSecret, fetchImpl = fetch, timeoutMs = 10_000, maxRetries = 2 } = {}) {
    if (typeof appId !== 'string' || !appId.trim() || typeof appSecret !== 'string' || !appSecret.trim()) {
      throw new TypeError('缺少飞书 APP_ID 或 APP_SECRET');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl 必须为函数');
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) throw new RangeError('maxRetries 必须在 0–5 之间');
    this.appId = appId;
    this.appSecret = appSecret;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = checkTimeout(timeoutMs);
    this.maxRetries = maxRetries;
    this.token = null;
    this.tokenExpiresAt = 0;
    this.tokenPromise = null;
  }

  async getTenantToken() {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = (async () => {
      const issuedAt = Date.now();
      const result = await this._request(TOKEN_PATH, {
        method: 'POST', body: { app_id: this.appId, app_secret: this.appSecret },
      });
      if (typeof result.tenant_access_token !== 'string' || !result.tenant_access_token ||
          !Number.isFinite(result.expire) || result.expire <= 0) {
        throw new FeishuApiError('飞书 token 响应缺少有效 tenant_access_token/expire', { path: TOKEN_PATH });
      }
      this.token = result.tenant_access_token;
      const lifetime = result.expire * 1000;
      this.tokenExpiresAt = issuedAt + lifetime - Math.min(60_000, lifetime * 0.1);
      return this.token;
    })();
    try { return await this.tokenPromise; }
    finally { this.tokenPromise = null; }
  }

  async request(path, { method = 'GET', body, ...options } = {}) {
    // Validate before retrieving credentials. Callers cannot redirect token-bearing requests.
    apiUrl(path, options.query);
    if (options.signal?.aborted) throw options.signal.reason || new Error('请求已取消');
    const token = await waitForShared(this.getTenantToken(), options.signal);
    options.signal?.throwIfAborted();
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return this._request(path, { ...options, method, body, headers });
  }

  async _request(path, { method = 'GET', body, headers, query, signal, timeoutMs = this.timeoutMs } = {}) {
    const url = apiUrl(path, query);
    checkTimeout(timeoutMs);
    const requestHeaders = new Headers(headers);
    requestHeaders.set('Content-Type', 'application/json; charset=utf-8');
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const { response, payload } = await this._fetchJson(url, {
        method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body),
      }, timeoutMs, signal);
      const code = payload?.code;
      const limited = response.status === 429 || RATE_LIMIT_CODES.has(code);
      if (limited && attempt < this.maxRetries) {
        const retryAfter = response.headers?.get('retry-after');
        const seconds = retryAfter == null ? NaN : Number(retryAfter);
        const parsedDate = retryAfter == null ? NaN : Date.parse(retryAfter);
        const delay = Number.isFinite(seconds) ? seconds * 1000 :
          Number.isFinite(parsedDate) ? parsedDate - Date.now() : 250 * 2 ** attempt;
        await wait(Math.max(0, Math.min(5000, delay)), signal);
        continue;
      }
      if (!response.ok || code !== 0) {
        const apiMessage = typeof payload?.msg === 'string' ? payload.msg.slice(0, 400) : '响应缺少合法 API 状态';
        // Never include request body, token or app secret in errors.
        throw new FeishuApiError(`飞书 API ${url.pathname} 失败（HTTP ${response.status}, code ${code ?? 'unknown'}）：${apiMessage}${limited ? '；限流重试次数已耗尽' : ''}`, {
          status: response.status, code, path: url.pathname,
          requestId: response.headers?.get('x-request-id') || undefined,
        });
      }
      return payload;
    }
  }

  async _fetchJson(url, options, timeoutMs, signal) {
    const controller = new AbortController();
    let timer;
    let abort;
    const deadline = new Promise((_, reject) => {
      abort = () => {
        controller.abort();
        reject(new FeishuApiError('飞书请求已取消', { code: 'ABORTED', path: url.pathname }));
      };
      timer = setTimeout(() => {
        controller.abort();
        reject(new FeishuApiError(`飞书 API 请求超时（${timeoutMs}ms）`, { code: 'TIMEOUT', path: url.pathname }));
      }, timeoutMs);
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
    const operation = (async () => {
      try {
        const response = await this.fetchImpl(url.toString(), { ...options, signal: controller.signal, redirect: 'error' });
        let payload;
        try { payload = await response.json(); }
        catch {
          if (response.status === 429) return { response, payload: null };
          throw new FeishuApiError(`飞书 API 返回非 JSON 响应（HTTP ${response.status}）`, { status: response.status, path: url.pathname });
        }
        return { response, payload };
      } catch (error) {
        if (error instanceof FeishuApiError) throw error;
        throw new FeishuApiError('无法连接飞书 API，请检查网络或稍后重试。', { code: 'NETWORK_ERROR', path: url.pathname });
      }
    })();
    try { return await Promise.race([operation, deadline]); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
}

const ID_TYPES = { user_id_type: 'open_id', department_id_type: 'open_department_id' };
const DEPARTMENT_ID_RE = /^od-[A-Za-z0-9_-]{1,128}$/;
const GLOBAL_REMINDER_CODES = new Set([230006, 99991672]);

function departmentLabel(department) {
  if (!department || typeof department !== 'object') return '';
  if (typeof department.name === 'string' && department.name.trim()) return department.name.trim();
  const i18n = department.i18n_name;
  if (!i18n || typeof i18n !== 'object') return '';
  for (const key of ['zh_cn', 'zh_hk', 'zh_tw', 'en_us']) {
    if (typeof i18n[key] === 'string' && i18n[key].trim()) return i18n[key].trim();
  }
  return '';
}

function withDepartment(user, openDepartmentId) {
  if (typeof openDepartmentId !== 'string' || !openDepartmentId.trim()) return user;
  const dept = openDepartmentId.trim();
  const current = Array.isArray(user.department_ids)
    ? user.department_ids.filter(id => typeof id === 'string' && id.trim())
    : [];
  if (current.includes(dept)) return user;
  return { ...user, department_ids: [...current, dept] };
}

async function readDepartmentNameFallback(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return new Map();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (raw.length > 1_000_000) return new Map();
    const payload = JSON.parse(raw);
    const entries = payload?.departments;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return new Map();
    const map = new Map();
    for (const [id, name] of Object.entries(entries)) {
      if (!DEPARTMENT_ID_RE.test(id) || typeof name !== 'string' || !name.trim()) continue;
      map.set(id, name.trim().slice(0, 80));
    }
    return map;
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('department_name_fallback_read_failed', error.code || error.name);
    return new Map();
  }
}

function reminderFailure(error) {
  const code = error?.code ?? 'SEND_FAILED';
  let message = '未能送达飞书机器人消息，请检查应用是否启用机器人能力、im:message:send_as_bot 权限及成员可见范围。';
  if (code === 230006) message = '应用未开启机器人能力。请到飞书开发者后台为该应用添加「机器人」能力，创建版本并发布后再试。';
  else if (code === 230013) message = '该成员不在机器人可用范围内。请在应用发布的可用范围中包含需要催办的同事。';
  else if (code === 99991672) message = '应用缺少「以应用身份发消息」权限，请在飞书开放平台开通 im:message:send_as_bot 并发布版本。';
  return { code, message, global: GLOBAL_REMINDER_CODES.has(code) };
}
const SCAN_CONCURRENCY = 8;
const USER_BATCH_SIZE = 50;

export class FeishuDirectory {
  constructor(client, { signal, cache = null, departmentNamesFile = null } = {}) {
    if (typeof client?.request !== 'function') throw new TypeError('client 必须实现 request');
    if (cache != null && (typeof cache.get !== 'function' || typeof cache.set !== 'function')) {
      throw new TypeError('cache 必须实现 get/set');
    }
    if (departmentNamesFile != null && (typeof departmentNamesFile !== 'string' || !departmentNamesFile.trim())) {
      throw new TypeError('departmentNamesFile 必须为非空路径或 null');
    }
    this.client = client;
    this.signal = signal;
    this.cache = cache;
    this.departmentNamesFile = departmentNamesFile ? departmentNamesFile.trim() : null;
    this.scopeNote = SCOPE_NOTE;
  }

  withSignal(signal) {
    return new FeishuDirectory(this.client, {
      signal,
      cache: this.cache,
      departmentNamesFile: this.departmentNamesFile,
    });
  }

  async clearCache() {
    if (typeof this.cache?.clear === 'function') await this.cache.clear();
  }

  async *_pages(path, query = {}) {
    const tokens = new Set();
    let pageToken;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      this.signal?.throwIfAborted();
      const result = await this.client.request(path, { signal: this.signal, query: { ...ID_TYPES, page_size: 50, ...query, page_token: pageToken } });
      this.signal?.throwIfAborted();
      const data = result?.data;
      if (!data || typeof data !== 'object' || typeof data.has_more !== 'boolean') {
        throw new DirectoryError('飞书分页响应格式未知，无法确认查询完整性。');
      }
      yield data;
      if (!data.has_more) return;
      const next = data.page_token;
      if (typeof next !== 'string' || !next.trim() || tokens.has(next)) {
        throw new DirectoryError('飞书分页 token 缺失或重复，已停止查询，未返回部分结果。');
      }
      tokens.add(next);
      pageToken = next;
    }
    throw new DirectoryError(`飞书分页超过 ${MAX_PAGES} 页上限，未返回部分结果。`);
  }

  async _items(path, query) {
    const items = [];
    for await (const data of this._pages(path, query)) {
      if (data.items !== undefined && !Array.isArray(data.items)) throw new DirectoryError('飞书分页 items 不是数组');
      for (const item of data.items || []) {
        items.push(item);
        assertScanLimit(items.length);
      }
    }
    return items;
  }

  async listDepartmentUsers(openDepartmentId) {
    const users = await this._items('/contact/v3/users/find_by_department', { department_id: departmentId(openDepartmentId) });
    for (const user of users) userId(user);
    return users;
  }

  async listDescendantDepartments(id) {
    const departments = await this._items(`/contact/v3/departments/${encodeURIComponent(departmentId(id))}/children`, { fetch_child: true });
    for (const department of departments) departmentId(department);
    return departments;
  }

  async getUser(openId) {
    this.signal?.throwIfAborted();
    if (typeof openId !== 'string' || !openId.trim()) throw new TypeError('open_id 不能为空');
    const result = await this.client.request(`/contact/v3/users/${encodeURIComponent(openId.trim())}`, { signal: this.signal, query: ID_TYPES });
    this.signal?.throwIfAborted();
    const user = result?.data?.user;
    if (userId(user) !== openId.trim()) throw new DirectoryError('飞书返回的 open_id 与请求不一致');
    return user;
  }

  async getUsers(openIds) {
    const ids = [...new Set((openIds || []).map(id => {
      if (typeof id !== 'string' || !id.trim()) throw new DirectoryError('通讯录用户 ID 无效，无法保证完整扫描。');
      return id.trim();
    }))];
    const users = [];
    for (let offset = 0; offset < ids.length; offset += USER_BATCH_SIZE) {
      this.signal?.throwIfAborted();
      const chunk = ids.slice(offset, offset + USER_BATCH_SIZE);
      const result = await this.client.request('/contact/v3/users/batch', {
        signal: this.signal,
        query: { ...ID_TYPES, user_ids: chunk },
      });
      this.signal?.throwIfAborted();
      const items = result?.data?.items;
      if (!Array.isArray(items)) throw new DirectoryError('飞书批量用户响应格式未知，无法保证完整扫描。');
      const byId = new Map();
      for (const item of items) byId.set(userId(item), item);
      for (const id of chunk) {
        const user = byId.get(id);
        if (!user) throw new DirectoryError('批量获取用户时缺少返回项，无法保证完整扫描。');
        users.push(user);
      }
    }
    return users;
  }

  async listGroupMemberIds(groupId, memberType) {
    if (typeof groupId !== 'string' || !groupId.trim()) throw new DirectoryError('通讯录用户组 ID 无效，无法保证完整扫描。');
    if (memberType !== 'user' && memberType !== 'department') throw new TypeError('memberType 必须为 user 或 department');
    // 官方文档：member_type=department 时 member_id_type 仍用 open_id（表示 open_department_id），
    // 传入 open_department_id 会返回 99992402 field validation failed。
    const ids = [];
    for await (const data of this._pages(`/contact/v3/group/${encodeURIComponent(groupId.trim())}/member/simplelist`, {
      member_type: memberType,
      member_id_type: 'open_id',
    })) {
      if (data.memberlist !== undefined && !Array.isArray(data.memberlist)) {
        throw new DirectoryError('飞书用户组成员列表格式未知，无法保证完整扫描。');
      }
      for (const member of data.memberlist || []) {
        const id = member?.member_id;
        if (typeof id !== 'string' || !id.trim()) throw new DirectoryError('用户组成员缺少有效 ID，无法保证完整扫描。');
        ids.push(id.trim());
        assertScanLimit(ids.length);
      }
    }
    return ids;
  }

  async listAllUsers() {
    this.signal?.throwIfAborted();
    if (this.cache) {
      const cached = await this.cache.get();
      this.signal?.throwIfAborted();
      if (cached) return cached;
    }

    const directUsers = new Set();
    const roots = new Set();
    const groups = new Set();
    let scopeCount = 0;
    // Official scopes: root children + direct users for all-staff access; selected
    // departments (without descendants), standalone users and groups otherwise.
    // Missing arrays can mean missing field permission, not an empty scope.
    for await (const data of this._pages('/contact/v3/scopes', { page_size: 100 })) {
      const known = new Set(['user_ids', 'department_ids', 'group_ids', 'has_more', 'page_token']);
      if (Object.keys(data).some(key => !known.has(key)) ||
          !['user_ids', 'department_ids', 'group_ids'].every(key => Array.isArray(data[key]))) {
        throw new DirectoryError('通讯录授权范围未知或字段缺失，无法保证完整扫描；请检查通讯录范围及 contact:user.employee_id:readonly 权限。');
      }
      for (const [key, target] of [['user_ids', directUsers], ['department_ids', roots], ['group_ids', groups]]) {
        for (const id of data[key]) {
          if (typeof id !== 'string' || !id.trim()) throw new DirectoryError('通讯录授权范围包含无效 ID，无法保证完整扫描。');
          target.add(id.trim());
          assertScanLimit(++scopeCount);
        }
      }
    }
    await mapPool(groups, SCAN_CONCURRENCY, async groupId => {
      this.signal?.throwIfAborted();
      const [userIds, departmentIds] = await Promise.all([
        this.listGroupMemberIds(groupId, 'user'),
        this.listGroupMemberIds(groupId, 'department'),
      ]);
      for (const id of userIds) {
        directUsers.add(id);
        assertScanLimit(directUsers.size + roots.size + groups.size);
      }
      for (const id of departmentIds) {
        roots.add(id);
        assertScanLimit(directUsers.size + roots.size + groups.size);
      }
    });
    const departments = new Set(roots);
    await mapPool(roots, SCAN_CONCURRENCY, async id => {
      this.signal?.throwIfAborted();
      for (const department of await this.listDescendantDepartments(id)) {
        this.signal?.throwIfAborted();
        departments.add(departmentId(department));
        assertScanLimit(departments.size);
      }
    });
    const users = new Map();
    let scanned = 0;
    // 用户字段权限未开通时，飞书不返回 department_ids。按查询部门把归属记到成员上。
    const add = (user, openDepartmentId) => {
      this.signal?.throwIfAborted();
      assertScanLimit(++scanned);
      const id = userId(user);
      const existing = users.get(id);
      users.set(id, withDepartment(existing || user, openDepartmentId));
    };
    for (const user of await this.getUsers([...directUsers])) add(user);
    await mapPool(departments, SCAN_CONCURRENCY, async id => {
      this.signal?.throwIfAborted();
      for (const user of await this.listDepartmentUsers(id)) add(user, id);
    });
    this.signal?.throwIfAborted();
    const result = [...users.values()];
    if (this.cache) {
      try { return await this.cache.set(result); }
      catch (error) {
        console.error('directory_cache_set_failed', error.code || error.name);
      }
    }
    return result;
  }

  async getDepartmentNameMap() {
    this.signal?.throwIfAborted();
    const map = new Map();
    let departments = [];
    try {
      departments = await this.listDescendantDepartments('0');
    } catch (error) {
      const fallback = await readDepartmentNameFallback(this.departmentNamesFile);
      if (fallback.size) return fallback;
      throw error;
    }
    for (const department of departments) {
      const id = departmentId(department);
      const name = departmentLabel(department);
      if (name) map.set(id, name);
    }
    if (departments.some(department => !map.has(departmentId(department)))) {
      const fallback = await readDepartmentNameFallback(this.departmentNamesFile);
      for (const [id, name] of fallback) if (!map.has(id)) map.set(id, name);
    }
    return map;
  }
}

export function buildReminderCard({ title, version = 'v1.0', deadlineAt = '', summary = '', ackUrl }) {
  if (typeof title !== 'string' || !title.trim()) throw new TypeError('催办卡片标题不能为空');
  if (typeof ackUrl !== 'string' || !/^https?:\/\//.test(ackUrl)) throw new TypeError('催办卡片确认链接无效');
  const excerpt = typeof summary === 'string' && summary.trim()
    ? summary.trim().slice(0, 180) + (summary.trim().length > 180 ? '…' : '')
    : '请点击下方按钮阅读重要文件内容并完成实名确认。';
  const elements = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**文件版本**：${version}${deadlineAt ? `　|　**截止时间**：${deadlineAt}` : ''}\n${excerpt}`,
      },
    },
    {
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '前往阅读并实名确认' },
          type: 'primary',
          url: ackUrl,
        },
      ],
    },
    {
      tag: 'note',
      elements: [{ tag: 'plain_text', content: '来自飞书运营助手 · 确认记录将与本人飞书身份绑定' }],
    },
  ];
  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: `待确认提醒：${title.trim().slice(0, 80)}` },
    },
    elements,
  };
}

export async function sendFeishuReminderCards(client, {
  recipients,
  card,
  batchId = '',
  signal,
  concurrency = 5,
} = {}) {
  if (typeof client?.request !== 'function') throw new TypeError('client 必须实现 request');
  if (!Array.isArray(recipients)) throw new TypeError('recipients 必须为数组');
  const content = JSON.stringify(card);
  let sentCount = 0;
  const failures = [];
  let globalFailure = null;
  await mapPool(recipients, concurrency, async (recipient, index) => {
    signal?.throwIfAborted();
    const openId = recipient?.openId;
    if (typeof openId !== 'string' || !openId.trim()) return;
    if (globalFailure) {
      failures.push({ openId, name: recipient?.name || openId, code: globalFailure.code, message: globalFailure.message });
      return;
    }
    const uuid = batchId ? `${batchId}-${index}`.slice(0, 50) : undefined;
    try {
      await client.request('/im/v1/messages', {
        method: 'POST',
        signal,
        query: { receive_id_type: 'open_id' },
        body: {
          receive_id: openId.trim(),
          msg_type: 'interactive',
          content,
          ...(uuid ? { uuid } : {}),
        },
      });
      sentCount += 1;
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      const failure = reminderFailure(error);
      if (failure.global) globalFailure = failure;
      failures.push({
        openId,
        name: recipient?.name || openId,
        code: failure.code,
        message: failure.message,
      });
    }
  });
  return {
    total: recipients.length,
    sentCount,
    failedCount: failures.length,
    failures,
  };
}

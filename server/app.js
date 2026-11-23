import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FeishuClient, FeishuDirectory } from './feishu.js';
import { createDemoDirectory, demoContacts, demoDepartments } from './demo.js';
import { DirectoryError, resolveEmployeeNumbers, resolveSelection } from './directory.js';
import { createDirectoryCache } from './directory-cache.js';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const DEFAULT_CACHE_PATH = fileURLToPath(new URL('../data/directory-cache.json', import.meta.url));
const SESSION_COOKIE = 'feishu_helper_session';
const LIMITS = Object.freeze({ employeeNumbers: 1000, users: 1000, departments: 100 });
const defaults = {
  production: false, mode: 'demo', appOrigin: 'http://localhost:5173', appId: '', appSecret: '', tenantKey: '',
  allowedOpenIds: [], trustProxy: 0, host: '127.0.0.1', port: 3000, sessionTtlMs: 3_600_000, maxSessions: 5000,
  maxConcurrentQueries: 4, requestTimeoutMs: 10_000, queryTimeoutMs: 110_000,
  directoryCacheTtlMs: 7 * 24 * 60 * 60 * 1000, directoryCachePath: DEFAULT_CACHE_PATH,
};

function validateConfig(input) {
  const config = { ...defaults, ...input };
  if (!['demo', 'feishu'].includes(config.mode)) throw new Error('APP_MODE 必须为 demo 或 feishu');
  if (config.production && config.mode !== 'feishu') throw new Error('生产环境必须显式设置 APP_MODE=feishu，禁止使用演示模式');
  let origin;
  try { origin = new URL(config.appOrigin); } catch { throw new Error('APP_ORIGIN 必须是完整有效的来源地址'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('APP_ORIGIN 只能包含协议、主机及端口');
  if (config.production && origin.protocol !== 'https:') throw new Error('生产环境 APP_ORIGIN 必须使用 HTTPS');
  config.appOrigin = origin.origin;
  if (config.mode === 'feishu' && ['appId', 'appSecret'].some(key => typeof config[key] !== 'string' || !config[key].trim())) throw new Error('飞书模式必须配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
  if (typeof config.tenantKey !== 'string') throw new Error('FEISHU_TENANT_KEY 必须是字符串');
  if (![0, 1].includes(config.trustProxy)) throw new Error('TRUST_PROXY 只能为 0 或 1');
  if (!Array.isArray(config.allowedOpenIds) || config.allowedOpenIds.some(id => typeof id !== 'string' || !/^ou[_-][A-Za-z0-9_-]+$/.test(id))) throw new Error('ALLOWED_OPEN_IDS 必须是逗号分隔的 open_id');
  for (const key of ['sessionTtlMs', 'maxSessions', 'maxConcurrentQueries', 'requestTimeoutMs', 'queryTimeoutMs', 'port', 'directoryCacheTtlMs']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`${key} 必须为正整数`);
  }
  if (config.directoryCachePath !== null && (typeof config.directoryCachePath !== 'string' || !config.directoryCachePath.trim())) {
    throw new Error('directoryCachePath 必须为非空路径，或显式设为 null 仅使用内存缓存');
  }
  if (typeof config.directoryCachePath === 'string') config.directoryCachePath = config.directoryCachePath.trim();
  if (config.port > 65535 || config.requestTimeoutMs > 60_000 || config.sessionTtlMs > 3_600_000 || config.maxSessions > 5000 || config.maxConcurrentQueries > 16 || config.queryTimeoutMs > 110_000) throw new Error('服务安全限制配置超出允许范围');
  if (config.directoryCacheTtlMs < 60_000 || config.directoryCacheTtlMs > 30 * 24 * 60 * 60 * 1000) throw new Error('directoryCacheTtlMs 必须在 1 分钟到 30 天之间');
  return config;
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  if (env.TRUST_PROXY !== undefined && !['0', '1'].includes(env.TRUST_PROXY)) throw new Error('TRUST_PROXY 只能为 0 或 1');
  if (production && env.APP_MODE !== 'feishu') throw new Error('生产环境必须显式设置 APP_MODE=feishu');
  if (production && !env.APP_ORIGIN) throw new Error('生产环境必须配置 APP_ORIGIN');
  const cacheHours = env.DIRECTORY_CACHE_TTL_HOURS === undefined ? undefined : Number(env.DIRECTORY_CACHE_TTL_HOURS);
  if (cacheHours !== undefined && (!Number.isFinite(cacheHours) || cacheHours <= 0)) throw new Error('DIRECTORY_CACHE_TTL_HOURS 必须为正数');
  let directoryCachePath = defaults.directoryCachePath;
  if (env.DIRECTORY_CACHE_PATH !== undefined) {
    directoryCachePath = env.DIRECTORY_CACHE_PATH.trim() === '' ? null : env.DIRECTORY_CACHE_PATH.trim();
  }
  return validateConfig({
    production, mode: env.APP_MODE || 'demo', appOrigin: env.APP_ORIGIN || defaults.appOrigin,
    appId: env.FEISHU_APP_ID || '', appSecret: env.FEISHU_APP_SECRET || '', tenantKey: env.FEISHU_TENANT_KEY || '',
    allowedOpenIds: (env.ALLOWED_OPEN_IDS || '').split(',').map(id => id.trim()).filter(Boolean),
    trustProxy: env.TRUST_PROXY === undefined ? 0 : Number(env.TRUST_PROXY),
    host: env.HOST || '127.0.0.1', port: env.PORT === undefined ? 3000 : Number(env.PORT),
    directoryCacheTtlMs: cacheHours === undefined ? defaults.directoryCacheTtlMs : Math.round(cacheHours * 3_600_000),
    directoryCachePath,
  });
}

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => new HttpError(status, code, message);
const errorBody = (code, message) => ({ error: { code, message } });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function sessionId(req) {
  const values = (req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${SESSION_COOKIE}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(SESSION_COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}
function objectBody(req) {
  if (!req.is('application/json')) throw fail(415, 'JSON_REQUIRED', '请使用 JSON 格式提交请求。');
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw fail(400, 'INVALID_INPUT', '请求参数格式不正确。');
  return req.body;
}
function strings(value, limit, pattern, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || value.length > limit || (!allowEmpty && !value.length) || value.some(item => typeof item !== 'string' || !pattern.test(item))) {
    throw fail(400, 'INVALID_INPUT', `${label}格式不正确或超过 ${limit} 项上限。`);
  }
  return value;
}

export function createApp({ config: suppliedConfig = loadConfig(), directory, client, fetchImpl = globalThis.fetch } = {}) {
  const config = validateConfig(suppliedConfig);
  const app = express();
  const apiClient = client || (config.mode === 'feishu' ? new FeishuClient({ appId: config.appId, appSecret: config.appSecret, fetchImpl }) : null);
  let provider = directory;
  if (!provider) {
    if (config.mode === 'demo') provider = createDemoDirectory();
    else {
      const directoryCache = createDirectoryCache({
        filePath: config.directoryCachePath,
        ttlMs: config.directoryCacheTtlMs,
        appId: config.appId,
      });
      provider = new FeishuDirectory(apiClient, { cache: directoryCache });
      setImmediate(() => {
        provider.listAllUsers().then(users => {
          console.log(`directory_cache_warmed count=${users.length} ttl_hours=${Math.round(config.directoryCacheTtlMs / 3_600_000)}`);
        }).catch(error => {
          console.error('directory_cache_warm_failed', error?.code || error?.name || 'Error', error?.message || '');
        });
      });
    }
  }
  const sessions = new Map();
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'strict', path: '/' };
  let runningQueries = 0;
  let runningLogins = 0;
  let ticket = null;
  let ticketPromise = null;
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy === 1 ? 1 : false);
  app.use(helmet({
    strictTransportSecurity: config.production ? undefined : false,
    contentSecurityPolicy: { directives: {
      // 官方 h5-js-sdk 用 new Function("return this") 取全局对象，缺少 unsafe-eval 时 onload 后无 window.h5sdk
      defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-eval'", 'https://lf-scm-cn.feishucdn.com'],
      styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"],
      objectSrc: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"],
      upgradeInsecureRequests: config.production ? [] : null,
    } },
  }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const now = Date.now();
    for (const [key, session] of sessions) if (session.expiresAt <= now) sessions.delete(key);
    const id = sessionId(req);
    req.appSession = id ? sessions.get(hash(id)) : null;
    next();
  });
  const limitHandler = (_req, res) => res.status(429).json(errorBody('RATE_LIMITED', '请求过于频繁，请稍后重试。'));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false, handler: limitHandler }));
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== config.appOrigin) return next(fail(403, 'ORIGIN_REJECTED', '请求来源不受信任，请从应用页面重试。'));
    next();
  });
  app.use('/api', express.json({ limit: '64kb', strict: true }));

  function requireAuth(req, _res, next) {
    if (config.mode === 'feishu' && !req.appSession) return next(fail(401, 'AUTH_REQUIRED', '请先在飞书客户端完成登录。'));
    next();
  }
  async function query(req, res, work) {
    if (runningQueries >= config.maxConcurrentQueries) throw fail(429, 'BUSY', '正在处理的查询较多，请稍后重试。');
    runningQueries += 1;
    const controller = new AbortController();
    const disconnect = () => controller.abort(fail(499, 'CLIENT_DISCONNECTED', '客户端已断开，查询已取消。'));
    const timer = setTimeout(() => controller.abort(fail(504, 'QUERY_TIMEOUT', '查询超过时间上限，已停止扫描；请缩小通讯录范围后重试。')), config.queryTimeoutMs);
    req.once('aborted', disconnect);
    res.once('close', disconnect);
    if (req.aborted || res.destroyed) disconnect();
    try {
      controller.signal.throwIfAborted();
      // A fresh provider carries the signal; never mutate a shared directory instance.
      const scoped = provider.withSignal ? provider.withSignal(controller.signal) : provider;
      const result = await work(scoped);
      controller.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      req.off('aborted', disconnect);
      res.off('close', disconnect);
      // Only release after the underlying work has actually stopped.
      runningQueries -= 1;
    }
  }
  async function authenticate(work) {
    if (runningLogins >= 4) throw fail(429, 'AUTH_BUSY', '正在处理的登录较多，请稍后重试。');
    runningLogins += 1;
    try { return await work(); } finally { runningLogins -= 1; }
  }
  async function authJson(url, options) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(fail(504, 'AUTH_TIMEOUT', '飞书认证服务响应超时，请重试。')); }, config.requestTimeoutMs);
    });
    const operation = (async () => {
      try {
        const response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
        const body = await response.json();
        if (!response.ok || body?.code !== 0) throw fail(401, 'AUTH_FAILED', '飞书认证失败或授权已过期，请重新登录。');
        return body;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw fail(502, 'AUTH_UNAVAILABLE', '暂时无法连接飞书认证服务，请稍后重试。');
      }
    })();
    try { return await Promise.race([operation, timeout]); } finally { clearTimeout(timer); }
  }

  app.get('/api/bootstrap', (req, res) => {
    const demo = config.mode === 'demo';
    res.json({ mode: config.mode, appId: config.appId, authenticated: demo || Boolean(req.appSession),
      user: demo ? { name: '演示用户', openId: 'ou_demo' } : req.appSession?.user || null,
      ...(demo ? { demoContacts, demoDepartments } : {}), limits: LIMITS,
    });
  });
  app.post('/api/auth/feishu', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, handler: limitHandler }), async (req, res) => {
    if (config.mode !== 'feishu') throw fail(400, 'DEMO_MODE', '演示模式无需飞书登录。');
    const { code } = objectBody(req);
    if (typeof code !== 'string' || !code.trim() || code.length > 2048 || /[\s\x00-\x1f]/.test(code)) throw fail(400, 'INVALID_INPUT', '授权码格式不正确。');
    if (sessions.size >= config.maxSessions && !req.appSession) throw fail(503, 'SESSION_LIMIT', '当前会话数量已达上限，请稍后重试。');
    const user = await authenticate(async () => {
      // Official v3 migration target; validate the full requestAccess flow in the tenant before launch.
      const token = await authJson('https://accounts.feishu.cn/oauth/v3/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.appId, client_secret: config.appSecret, code }),
      });
      if (typeof token.access_token !== 'string' || !token.access_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw fail(502, 'AUTH_INVALID_RESPONSE', '飞书认证服务返回的数据不完整，请重试。');
      const info = await authJson('https://open.feishu.cn/open-apis/authen/v1/user_info', {
        method: 'GET', headers: { Authorization: `Bearer ${token.access_token}` },
      });
      const identity = info.data;
      if (!identity || typeof identity.open_id !== 'string' || !/^ou[_-][A-Za-z0-9_-]+$/.test(identity.open_id)) throw fail(403, 'AUTH_REJECTED', '无法确认当前飞书账号身份，请重新登录。');
      if (config.allowedOpenIds.length && !config.allowedOpenIds.includes(identity.open_id)) throw fail(403, 'USER_REJECTED', '当前账号未被授予本应用的使用权限。');
      return { name: typeof identity.name === 'string' ? identity.name.slice(0, 200) : '飞书用户', openId: identity.open_id };
    });
    const old = sessionId(req);
    // Recheck after awaited network requests to enforce the cap under concurrent logins.
    if (sessions.size >= config.maxSessions && !(old && sessions.has(hash(old)))) throw fail(503, 'SESSION_LIMIT', '当前会话数量已达上限，请稍后重试。');
    if (old) sessions.delete(hash(old));
    const id = crypto.randomBytes(32).toString('hex');
    sessions.set(hash(id), { user, expiresAt: Date.now() + config.sessionTtlMs });
    res.cookie(SESSION_COOKIE, id, { ...cookieOptions, maxAge: config.sessionTtlMs });
    res.json({ authenticated: true, user });
  });
  app.post('/api/auth/logout', (req, res) => {
    const id = sessionId(req);
    if (id) sessions.delete(hash(id));
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.json({ authenticated: false });
  });
  app.get('/api/feishu/js-config', requireAuth, async (req, res) => {
    if (config.mode !== 'feishu') throw fail(400, 'DEMO_MODE', '演示模式不调用飞书 SDK。');
    const raw = req.query.url;
    let url;
    try { if (typeof raw !== 'string' || raw.length > 8192) throw new Error(); url = new URL(raw); } catch { throw fail(400, 'INVALID_URL', '网页鉴权地址格式不正确。'); }
    if (url.origin !== config.appOrigin || url.username || url.password || url.hash) throw fail(403, 'URL_REJECTED', '只能为当前应用来源的无 hash 地址生成签名。');
    if (!ticket || ticket.expiresAt <= Date.now()) {
      if (!ticketPromise) {
        ticketPromise = (async () => {
          const started = Date.now();
          const result = await apiClient.request('/jssdk/ticket/get', { method: 'POST', body: {} });
          if (typeof result?.data?.ticket !== 'string' || !result.data.ticket || !Number.isFinite(result.data.expire_in) || result.data.expire_in <= 0) throw fail(502, 'TICKET_INVALID', '飞书鉴权凭证暂时不可用，请稍后重试。');
          const ttl = result.data.expire_in * 1000;
          ticket = { value: result.data.ticket, expiresAt: started + ttl - Math.min(60_000, ttl * 0.1) };
        })().finally(() => { ticketPromise = null; });
      }
      await ticketPromise;
    }
    const timestamp = Date.now();
    const nonceStr = crypto.randomBytes(16).toString('hex');
    // Sign the exact original URL; do not normalize percent escapes, query order or path.
    const signature = crypto.createHash('sha1').update(`jsapi_ticket=${ticket.value}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${raw}`, 'utf8').digest('hex');
    res.json({ appId: config.appId, timestamp, nonceStr, signature });
  });
  app.post('/api/resolve/employee-numbers', requireAuth, async (req, res) => {
    const { numbers } = objectBody(req);
    strings(numbers, LIMITS.employeeNumbers, /^[^\s\x00-\x1f\x7f]{1,128}$/u, '工号', { allowEmpty: false });
    res.json(await query(req, res, scoped => resolveEmployeeNumbers(scoped, numbers)));
  });
  app.post('/api/resolve/selection', requireAuth, async (req, res) => {
    const { userIds = [], departmentIds = [], includeChildren = true } = objectBody(req);
    strings(userIds, LIMITS.users, /^ou[_-][A-Za-z0-9_-]{1,128}$/, '成员 ID');
    strings(departmentIds, LIMITS.departments, /^(?:od-[A-Za-z0-9_-]{1,128}|0)$/, '部门 ID');
    if ((!userIds.length && !departmentIds.length) || typeof includeChildren !== 'boolean') throw fail(400, 'INVALID_INPUT', '请选择成员或部门，并使用布尔值指定是否包含子部门。');
    res.json(await query(req, res, scoped => resolveSelection(scoped, { userIds, departmentIds, includeChildren })));
  });
  app.use('/api', (_req, res) => res.status(404).json(errorBody('NOT_FOUND', '接口不存在。')));
  app.use((req, res, next) => {
    if (req.path.split('/').some(segment => segment.startsWith('.'))) return res.status(404).json(errorBody('NOT_FOUND', '页面不存在。'));
    next();
  });
  app.use(express.static(DIST, { dotfiles: 'deny', index: false, redirect: false, fallthrough: true }));
  app.get('/{*route}', (req, res, next) => {
    if (!req.accepts('html')) return res.status(404).json(errorBody('NOT_FOUND', '页面不存在。'));
    res.sendFile(path.join(DIST, 'index.html'), error => { if (error) next(error); });
  });
  app.use((error, _req, res, _next) => {
    if (res.destroyed) return;
    if (res.headersSent) return res.end();
    if (error instanceof HttpError) return res.status(error.status).json(errorBody(error.code, error.message));
    if (error.type === 'entity.too.large') return res.status(413).json(errorBody('BODY_TOO_LARGE', '请求内容超过 64KB 上限。'));
    if (error.type === 'entity.parse.failed') return res.status(400).json(errorBody('INVALID_JSON', '请求 JSON 格式不正确。'));
    if (error.code === 'ENOENT') return res.status(404).json(errorBody('NOT_FOUND', '页面尚未构建，请先构建应用。'));
    if (error instanceof DirectoryError) return res.status(422).json(errorBody('DIRECTORY_INCOMPLETE', error.message));
    if (error instanceof RangeError) return res.status(422).json(errorBody('DIRECTORY_LIMIT', '通讯录查询超出安全处理上限，请缩小范围后重试。'));
    if (error?.name === 'FeishuApiError') {
      console.error('feishu_api_error', { code: error.code, status: error.status, path: error.path, message: error.message });
      return res.status(502).json(errorBody('FEISHU_API_ERROR', '飞书通讯录接口调用失败，请检查应用权限、用户组权限或稍后重试。'));
    }
    console.error('unhandled_query_error', error?.name || 'Error', error?.message || 'unknown');
    return res.status(502).json(errorBody('SERVICE_UNAVAILABLE', '查询暂未完成，请检查通讯录授权范围与字段权限，或稍后重试。'));
  });
  return app;
}

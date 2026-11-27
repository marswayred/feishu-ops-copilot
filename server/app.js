import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FeishuClient,
  FeishuDirectory,
  buildReminderCard,
  sendFeishuReminderCards,
} from './feishu.js';
import { createDemoDirectory, demoContacts, demoDepartments, demoPersonas } from './demo.js';
import {
  DirectoryError,
  resolveEmployeeNumbers,
  resolveSelection,
  resolveTaskAudience,
  resolveProjectMembers,
  normalizeDirectoryMember,
} from './directory.js';
import { createDirectoryCache } from './directory-cache.js';
import { createStore } from './store.js';
import { reconcileTask, buildReconcileCsv } from './reconcile.js';
import {
  API_SCOPES,
  generateApiToken,
  hashApiToken,
  normalizeScopes,
  tokenDisplayPrefix,
  tokenHasScope,
  tokenIsUsable,
} from './api-tokens.js';
import {
  PROJECT_MEMBERS_MAX,
  PROJECT_NAME_MAX,
  formatProject,
  formatProjectSummary,
  makeProjectKey,
} from './projects.js';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const DEFAULT_CACHE_PATH = fileURLToPath(new URL('../data/directory-cache.json', import.meta.url));
const DEFAULT_DB_PATH = fileURLToPath(new URL('../data/ops-helper.sqlite', import.meta.url));
const SESSION_COOKIE = 'feishu_helper_session';
const LIMITS = Object.freeze({ employeeNumbers: 1000, users: 1000, departments: 100 });
const OPEN_ID_RE = /^ou[_-][A-Za-z0-9_-]{1,128}$/;
const DEPT_ID_RE = /^(?:od-[A-Za-z0-9_-]{1,128}|0)$/;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,79}$/i;
const VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;
const SHA256_RE = /^[a-f0-9]{64}$/i;
const SAFE_RETURN_TO_RE = /^\/(?:ack\/[A-Za-z0-9_-]{3,80}|ops(?:\/[A-Za-z0-9_/-]{1,80})?|my\/acks)?$/;

const defaults = {
  production: false,
  mode: 'demo',
  appOrigin: 'http://localhost:5173',
  appId: '',
  appSecret: '',
  tenantKey: '',
  allowedOpenIds: [],
  adminOpenIds: [],
  adminEmployeeNos: [],
  trustProxy: 0,
  host: '127.0.0.1',
  port: 3000,
  sessionTtlMs: 3_600_000,
  maxSessions: 5000,
  maxConcurrentQueries: 4,
  requestTimeoutMs: 10_000,
  queryTimeoutMs: 110_000,
  remindCooldownMs: 60_000,
  directoryCacheTtlMs: 7 * 24 * 60 * 60 * 1000,
  directoryCachePath: DEFAULT_CACHE_PATH,
  dbPath: ':memory:',
};

function parseCsvEnv(raw) {
  return (raw || '').split(',').map(item => item.trim()).filter(Boolean);
}

function validateConfig(input) {
  const config = { ...defaults, ...input };
  if (!['demo', 'feishu'].includes(config.mode)) throw new Error('APP_MODE 必须为 demo 或 feishu');
  if (config.production && config.mode !== 'feishu') throw new Error('生产环境必须显式设置 APP_MODE=feishu，禁止使用演示模式');
  let origin;
  try { origin = new URL(config.appOrigin); } catch { throw new Error('APP_ORIGIN 必须是完整有效的来源地址'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('APP_ORIGIN 只能包含协议、主机及端口');
  }
  if (config.production && origin.protocol !== 'https:') throw new Error('生产环境 APP_ORIGIN 必须使用 HTTPS');
  config.appOrigin = origin.origin;
  if (config.mode === 'feishu' && ['appId', 'appSecret'].some(key => typeof config[key] !== 'string' || !config[key].trim())) {
    throw new Error('飞书模式必须配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
  }
  if (typeof config.tenantKey !== 'string') throw new Error('FEISHU_TENANT_KEY 必须是字符串');
  if (![0, 1].includes(config.trustProxy)) throw new Error('TRUST_PROXY 只能为 0 或 1');
  if (!Array.isArray(config.allowedOpenIds) || config.allowedOpenIds.some(id => typeof id !== 'string' || !OPEN_ID_RE.test(id))) {
    throw new Error('ALLOWED_OPEN_IDS 必须是逗号分隔的 open_id');
  }
  if (!Array.isArray(config.adminOpenIds) || config.adminOpenIds.some(id => typeof id !== 'string' || !OPEN_ID_RE.test(id))) {
    throw new Error('ADMIN_OPEN_IDS 必须是逗号分隔的 open_id');
  }
  if (!Array.isArray(config.adminEmployeeNos) || config.adminEmployeeNos.some(no => typeof no !== 'string' || !/^[^\s\x00-\x1f\x7f]{1,64}$/.test(no))) {
    throw new Error('ADMIN_EMPLOYEE_NOS 格式不正确');
  }
  for (const key of ['sessionTtlMs', 'maxSessions', 'maxConcurrentQueries', 'requestTimeoutMs', 'queryTimeoutMs', 'port', 'directoryCacheTtlMs']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`${key} 必须为正整数`);
  }
  if (!Number.isSafeInteger(config.remindCooldownMs) || config.remindCooldownMs < 0 || config.remindCooldownMs > 86_400_000) {
    throw new Error('remindCooldownMs 必须在 0 到 86400000 之间');
  }
  if (config.directoryCachePath !== null && (typeof config.directoryCachePath !== 'string' || !config.directoryCachePath.trim())) {
    throw new Error('directoryCachePath 必须为非空路径，或显式设为 null 仅使用内存缓存');
  }
  if (typeof config.directoryCachePath === 'string') config.directoryCachePath = config.directoryCachePath.trim();
  if (typeof config.dbPath !== 'string' || !config.dbPath.trim()) {
    throw new Error('DB_PATH 必须为非空路径或 :memory:');
  }
  config.dbPath = config.dbPath.trim();
  if (config.port > 65535 || config.requestTimeoutMs > 60_000 || config.sessionTtlMs > 3_600_000 || config.maxSessions > 5000 || config.maxConcurrentQueries > 16 || config.queryTimeoutMs > 110_000) {
    throw new Error('服务安全限制配置超出允许范围');
  }
  if (config.directoryCacheTtlMs < 60_000 || config.directoryCacheTtlMs > 30 * 24 * 60 * 60 * 1000) {
    throw new Error('directoryCacheTtlMs 必须在 1 分钟到 30 天之间');
  }
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
  const dbPath = env.DB_PATH === undefined ? DEFAULT_DB_PATH : env.DB_PATH.trim();
  return validateConfig({
    production,
    mode: env.APP_MODE || 'demo',
    appOrigin: env.APP_ORIGIN || defaults.appOrigin,
    appId: env.FEISHU_APP_ID || '',
    appSecret: env.FEISHU_APP_SECRET || '',
    tenantKey: env.FEISHU_TENANT_KEY || '',
    allowedOpenIds: parseCsvEnv(env.ALLOWED_OPEN_IDS),
    adminOpenIds: parseCsvEnv(env.ADMIN_OPEN_IDS),
    adminEmployeeNos: parseCsvEnv(env.ADMIN_EMPLOYEE_NOS),
    trustProxy: env.TRUST_PROXY === undefined ? 0 : Number(env.TRUST_PROXY),
    host: env.HOST || '127.0.0.1',
    port: env.PORT === undefined ? 3000 : Number(env.PORT),
    directoryCacheTtlMs: cacheHours === undefined ? defaults.directoryCacheTtlMs : Math.round(cacheHours * 3_600_000),
    directoryCachePath,
    dbPath,
  });
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
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

function validateDocUrl(raw, production) {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw !== 'string' || raw.length > 2048) throw fail(400, 'INVALID_INPUT', '文件链接长度不能超过 2048 个字符。');
  let parsed;
  try { parsed = new URL(raw.trim()); } catch { throw fail(400, 'INVALID_INPUT', '文件链接必须是完整的有效网址。'); }
  const allowedProtocols = production ? ['https:'] : ['https:', 'http:'];
  if (!allowedProtocols.includes(parsed.protocol) || parsed.username || parsed.password) {
    throw fail(400, 'INVALID_INPUT', production ? '生产环境文件链接必须使用 HTTPS。' : '文件链接仅支持 HTTP/HTTPS 协议。');
  }
  return parsed.toString();
}

function makeFeishuAppLink(appId, appOrigin, routePath) {
  if (!appId) return '';
  const target = new URL(routePath, appOrigin).toString();
  return `https://applink.feishu.cn/client/web_app/open?appId=${encodeURIComponent(appId)}&lk_target_url=${encodeURIComponent(target)}`;
}

export function createApp({
  config: suppliedConfig = loadConfig(),
  directory,
  client,
  store: suppliedStore,
  fetchImpl = globalThis.fetch,
} = {}) {
  const config = validateConfig(suppliedConfig);
  const app = express();
  const store = suppliedStore || createStore({ dbPath: config.dbPath });
  if (config.mode === 'demo') store.seedDemoTaskIfEmpty();
  app.locals.store = store;
  app.locals.close = () => store.close();

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
      const departmentNamesFile = config.directoryCachePath
        ? path.join(path.dirname(path.resolve(config.directoryCachePath)), 'department-names.json')
        : null;
      provider = new FeishuDirectory(apiClient, { cache: directoryCache, departmentNamesFile });
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
  const oauthStates = new Map();
  // SameSite=Lax preserves session cookies across email-client link clicks and OAuth redirects while still blocking cross-site POSTs.
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/' };
  let runningQueries = 0;
  let runningLogins = 0;
  let ticket = null;
  let ticketPromise = null;

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy === 1 ? 1 : false);
  app.use(helmet({
    strictTransportSecurity: config.production ? undefined : false,
    contentSecurityPolicy: {
      directives: {
        // 官方 h5-js-sdk 用 new Function("return this") 取全局对象，缺少 unsafe-eval 时 onload 后无 window.h5sdk
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-eval'", 'https://lf-scm-cn.feishucdn.com'],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.production ? [] : null,
      },
    },
  }));

  function isRbacStrict() {
    return config.adminOpenIds.length > 0 || config.adminEmployeeNos.length > 0 || store.hasAnyGrants();
  }

  function resolveUserWithRole(baseUser) {
    if (!baseUser) return null;
    if (config.mode === 'demo') {
      const role = baseUser.role || 'admin';
      return {
        ...baseUser,
        role,
        canManageOps: role === 'admin' || role === 'operator',
      };
    }
    const isEnvAdmin = config.adminOpenIds.includes(baseUser.openId) ||
      Boolean(baseUser.employeeNo && config.adminEmployeeNos.includes(baseUser.employeeNo));
    if (isEnvAdmin) {
      return { ...baseUser, role: 'admin', canManageOps: true };
    }
    const grant = store.getGrant(baseUser.openId);
    if (grant) {
      return { ...baseUser, role: grant.role, canManageOps: true };
    }
    if (isRbacStrict()) {
      return { ...baseUser, role: 'employee', canManageOps: false };
    }
    // Initial bootstrap before any admin is bound: allow workbench setup while surfacing rbacStrict=false.
    return { ...baseUser, role: 'operator', canManageOps: true };
  }

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const now = Date.now();
    for (const [key, session] of sessions) if (session.expiresAt <= now) sessions.delete(key);
    for (const [key, state] of oauthStates) if (state.expiresAt <= now) oauthStates.delete(key);
    const id = sessionId(req);
    const rawSession = id ? sessions.get(hash(id)) : null;
    req.appSession = rawSession
      ? { ...rawSession, user: resolveUserWithRole(rawSession.user) }
      : null;
    if (config.mode === 'demo' && !req.appSession) {
      req.demoUser = resolveUserWithRole(demoPersonas[0]);
    }
    next();
  });

  const limitHandler = (_req, res) => res.status(429).json(errorBody('RATE_LIMITED', '请求过于频繁，请稍后重试。'));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false, handler: limitHandler }));
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== config.appOrigin) {
      return next(fail(403, 'ORIGIN_REJECTED', '请求来源不受信任，请从应用页面重试。'));
    }
    next();
  });
  app.use('/api', express.json({ limit: '64kb', strict: true }));

  function currentUser(req) {
    if (req.appSession?.user) return req.appSession.user;
    if (config.mode === 'demo') return req.demoUser || resolveUserWithRole(demoPersonas[0]);
    return null;
  }

  function currentAuthChannel(req) {
    if (req.appSession?.authChannel) return req.appSession.authChannel;
    return config.mode === 'demo' ? 'demo' : 'feishu_client';
  }

  function requireAuth(req, _res, next) {
    if (!currentUser(req)) return next(fail(401, 'AUTH_REQUIRED', '请先使用飞书账号完成登录。'));
    next();
  }

  function requireOperator(req, _res, next) {
    const user = currentUser(req);
    if (!user) return next(fail(401, 'AUTH_REQUIRED', '请先使用飞书账号完成登录。'));
    if (!user.canManageOps) {
      return next(fail(403, 'OPERATOR_REQUIRED', '当前账号为普通员工身份，仅可访问文件阅读确认页，无运营后台管理权限。'));
    }
    next();
  }

  function requireAdmin(req, _res, next) {
    const user = currentUser(req);
    if (!user) return next(fail(401, 'AUTH_REQUIRED', '请先使用飞书账号完成登录。'));
    if (user.role !== 'admin') {
      return next(fail(403, 'ADMIN_REQUIRED', '仅管理员可执行该操作。'));
    }
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
      const scoped = provider.withSignal ? provider.withSignal(controller.signal) : provider;
      const result = await work(scoped, controller.signal);
      controller.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      req.off('aborted', disconnect);
      res.off('close', disconnect);
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
        if (!response.ok || body?.code !== 0) {
          const reason = typeof body?.msg === 'string' ? body.msg.slice(0, 200) : '';
          console.error('feishu_auth_failed', body?.code ?? response.status, reason);
          throw fail(401, 'AUTH_FAILED', '飞书认证失败或授权已过期，请重新登录。');
        }
        return body;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw fail(502, 'AUTH_UNAVAILABLE', '暂时无法连接飞书认证服务，请稍后重试。');
      }
    })();
    try { return await Promise.race([operation, timeout]); } finally { clearTimeout(timer); }
  }

  async function exchangeCodeForUser(code, redirectUri = '') {
    const params = {
      grant_type: 'authorization_code',
      client_id: config.appId,
      client_secret: config.appSecret,
      code,
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    };
    const token = await authJson('https://accounts.feishu.cn/oauth/v3/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    if (typeof token.access_token !== 'string' || !token.access_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
      throw fail(502, 'AUTH_INVALID_RESPONSE', '飞书认证服务返回的数据不完整，请重试。');
    }
    const info = await authJson('https://open.feishu.cn/open-apis/authen/v1/user_info', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const identity = info.data;
    if (!identity || typeof identity.open_id !== 'string' || !OPEN_ID_RE.test(identity.open_id)) {
      throw fail(403, 'AUTH_REJECTED', '无法确认当前飞书账号身份，请重新登录。');
    }
    if (config.allowedOpenIds.length && !config.allowedOpenIds.includes(identity.open_id)) {
      throw fail(403, 'USER_REJECTED', '当前账号未被授予本应用的使用权限。');
    }
    return {
      openId: identity.open_id,
      name: typeof identity.name === 'string' && identity.name.trim() ? identity.name.trim().slice(0, 200) : '飞书用户',
      employeeNo: typeof identity.employee_no === 'string' ? identity.employee_no.trim().slice(0, 64) : '',
      email: typeof identity.enterprise_email === 'string' ? identity.enterprise_email.trim().slice(0, 254) : '',
      departmentNames: '',
    };
  }

  function establishSession(req, res, baseUser, authChannel) {
    const old = sessionId(req);
    if (sessions.size >= config.maxSessions && !(old && sessions.has(hash(old)))) {
      throw fail(503, 'SESSION_LIMIT', '当前会话数量已达上限，请稍后重试。');
    }
    if (old) sessions.delete(hash(old));
    const id = crypto.randomBytes(32).toString('hex');
    sessions.set(hash(id), {
      user: baseUser,
      authChannel,
      expiresAt: Date.now() + config.sessionTtlMs,
    });
    res.cookie(SESSION_COOKIE, id, { ...cookieOptions, maxAge: config.sessionTtlMs });
    return resolveUserWithRole(baseUser);
  }

  app.get('/api/bootstrap', (req, res) => {
    const demo = config.mode === 'demo';
    const user = currentUser(req);
    res.json({
      mode: config.mode,
      appId: config.appId,
      appOrigin: config.appOrigin,
      authenticated: Boolean(user),
      rbacStrict: demo ? true : isRbacStrict(),
      user,
      ...(demo ? { demoContacts, demoDepartments, demoPersonas } : {}),
      limits: LIMITS,
    });
  });

  app.post('/api/demo/persona', (req, res) => {
    if (config.mode !== 'demo') throw fail(400, 'DEMO_ONLY', '仅演示模式支持切换体验角色。');
    const { openId } = objectBody(req);
    const persona = demoPersonas.find(item => item.openId === openId);
    if (!persona) throw fail(400, 'INVALID_PERSONA', '所选演示角色不存在。');
    const user = establishSession(req, res, persona, 'demo');
    res.json({ authenticated: true, user });
  });

  app.post('/api/auth/feishu', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, handler: limitHandler }), async (req, res) => {
    if (config.mode !== 'feishu') throw fail(400, 'DEMO_MODE', '演示模式无需飞书登录。');
    const { code } = objectBody(req);
    if (typeof code !== 'string' || !code.trim() || code.length > 2048 || /[\s\x00-\x1f]/.test(code)) {
      throw fail(400, 'INVALID_INPUT', '授权码格式不正确。');
    }
    if (sessions.size >= config.maxSessions && !req.appSession) {
      throw fail(503, 'SESSION_LIMIT', '当前会话数量已达上限，请稍后重试。');
    }
    const baseUser = await authenticate(() => exchangeCodeForUser(code.trim()));
    const user = establishSession(req, res, baseUser, 'feishu_client');
    res.json({ authenticated: true, user });
  });

  app.get('/api/auth/oauth/start', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, handler: limitHandler }), (req, res) => {
    if (config.mode !== 'feishu') throw fail(400, 'DEMO_MODE', '演示模式无需飞书网页授权跳转，可直接在页面顶部切换体验身份。');
    const rawReturnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo.trim() : '/';
    const returnTo = SAFE_RETURN_TO_RE.test(rawReturnTo) ? rawReturnTo : '/';
    if (oauthStates.size >= 2000) {
      const oldestKey = oauthStates.keys().next().value;
      if (oldestKey) oauthStates.delete(oldestKey);
    }
    const state = crypto.randomBytes(24).toString('hex');
    oauthStates.set(hash(state), { returnTo, expiresAt: Date.now() + 10 * 60_000 });
    const redirectUri = `${config.appOrigin}/api/auth/oauth/callback`;
    const authorizeUrl = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
    authorizeUrl.searchParams.set('client_id', config.appId);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);
    res.redirect(302, authorizeUrl.toString());
  });

  app.get('/api/auth/oauth/callback', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, handler: limitHandler }), async (req, res) => {
    if (config.mode !== 'feishu') throw fail(400, 'DEMO_MODE', '演示模式不处理飞书 OAuth 回调。');
    const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
    const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';
    if (!code || code.length > 2048 || /[\s\x00-\x1f]/.test(code) || !/^[a-f0-9]{48}$/.test(state)) {
      throw fail(400, 'OAUTH_INVALID_CALLBACK', '飞书网页登录回调参数无效或已取消，请返回确认链接重试。');
    }
    const stored = oauthStates.get(hash(state));
    oauthStates.delete(hash(state));
    if (!stored || stored.expiresAt <= Date.now()) {
      throw fail(400, 'OAUTH_STATE_EXPIRED', '登录请求已过期，请返回原页面重新点击飞书登录。');
    }
    const redirectUri = `${config.appOrigin}/api/auth/oauth/callback`;
    const baseUser = await authenticate(() => exchangeCodeForUser(code, redirectUri));
    establishSession(req, res, baseUser, 'web_oauth');
    res.redirect(302, stored.returnTo || '/');
  });

  app.post('/api/auth/logout', (req, res) => {
    const id = sessionId(req);
    if (id) sessions.delete(hash(id));
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.json({ authenticated: false });
  });

  app.get('/api/feishu/js-config', requireOperator, async (req, res) => {
    if (config.mode !== 'feishu') throw fail(400, 'DEMO_MODE', '演示模式不调用飞书 SDK。');
    const raw = req.query.url;
    let url;
    try {
      if (typeof raw !== 'string' || raw.length > 8192) throw new Error();
      url = new URL(raw);
    } catch {
      throw fail(400, 'INVALID_URL', '网页鉴权地址格式不正确。');
    }
    if (url.origin !== config.appOrigin || url.username || url.password || url.hash) {
      throw fail(403, 'URL_REJECTED', '只能为当前应用来源的无 hash 地址生成签名。');
    }
    if (!ticket || ticket.expiresAt <= Date.now()) {
      if (!ticketPromise) {
        ticketPromise = (async () => {
          const started = Date.now();
          const result = await apiClient.request('/jssdk/ticket/get', { method: 'POST', body: {} });
          if (typeof result?.data?.ticket !== 'string' || !result.data.ticket || !Number.isFinite(result.data.expire_in) || result.data.expire_in <= 0) {
            throw fail(502, 'TICKET_INVALID', '飞书鉴权凭证暂时不可用，请稍后重试。');
          }
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

  // ─── 模块一：通讯录企业邮箱提取（仅运营管理员） ─────────────────────────────
  app.post('/api/resolve/employee-numbers', requireOperator, async (req, res) => {
    const { numbers } = objectBody(req);
    strings(numbers, LIMITS.employeeNumbers, /^[^\s\x00-\x1f\x7f]{1,128}$/u, '工号', { allowEmpty: false });
    res.json(await query(req, res, scoped => resolveEmployeeNumbers(scoped, numbers)));
  });

  app.post('/api/resolve/selection', requireOperator, async (req, res) => {
    const { userIds = [], departmentIds = [], includeChildren = true } = objectBody(req);
    strings(userIds, LIMITS.users, OPEN_ID_RE, '成员 ID');
    strings(departmentIds, LIMITS.departments, DEPT_ID_RE, '部门 ID');
    if ((!userIds.length && !departmentIds.length) || typeof includeChildren !== 'boolean') {
      throw fail(400, 'INVALID_INPUT', '请选择成员或部门，并使用布尔值指定是否包含子部门。');
    }
    res.json(await query(req, res, scoped => resolveSelection(scoped, { userIds, departmentIds, includeChildren })));
  });

  app.post('/api/ops/directory/refresh', requireOperator, async (req, res) => {
    if (typeof provider.clearCache === 'function') await provider.clearCache();
    const count = await query(req, res, async scoped => {
      const users = await scoped.listAllUsers();
      return Array.isArray(users) ? users.length : 0;
    });
    res.json({ refreshed: true, userCount: count });
  });

  app.post('/api/ops/directory/people', requireOperator, async (req, res) => {
    const body = objectBody(req);
    const queryText = typeof body.query === 'string' ? body.query.trim().slice(0, 80).toLocaleLowerCase() : '';
    const people = await query(req, res, async scoped => {
      const deptMap = typeof scoped.getDepartmentNameMap === 'function' ? await scoped.getDepartmentNameMap() : new Map();
      const users = await scoped.listAllUsers();
      if (!Array.isArray(users)) throw new DirectoryError('通讯录 provider 未返回用户数组，查询未完成。');
      const active = [];
      for (const user of users) {
        const member = normalizeDirectoryMember(user, deptMap);
        if (member.inactive) continue;
        active.push({
          openId: member.openId,
          name: member.name,
          employeeNo: member.employeeNo,
          departmentNames: member.departmentNames,
        });
      }
      active.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.employeeNo.localeCompare(b.employeeNo, 'zh-CN'));
      const matched = queryText
        ? active.filter(person => `${person.name} ${person.employeeNo} ${person.departmentNames}`.toLocaleLowerCase().includes(queryText))
        : active;
      return matched.slice(0, 40);
    });
    res.json({ people });
  });

  // ─── 运营权限同步管理（RBAC） ──────────────────────────────────────────────
  app.get('/api/ops/admins', requireOperator, (_req, res) => {
    res.json({
      rbacStrict: isRbacStrict(),
      envAdminOpenIds: config.adminOpenIds,
      envAdminEmployeeNos: config.adminEmployeeNos,
      grants: store.listGrants(),
    });
  });

  app.post('/api/ops/admins', requireOperator, async (req, res) => {
    const actor = currentUser(req);
    const body = objectBody(req);
    const openId = typeof body.openId === 'string' && body.openId.trim() ? body.openId.trim() : actor.openId;
    if (!OPEN_ID_RE.test(openId) && config.mode !== 'demo') {
      throw fail(400, 'INVALID_INPUT', '成员 open_id 格式不正确。');
    }
    const role = body.role === 'admin' ? 'admin' : 'operator';
    let name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    let employeeNo = typeof body.employeeNo === 'string' ? body.employeeNo.trim().slice(0, 64) : '';
    if (!name && openId === actor.openId) {
      name = actor.name;
      employeeNo = actor.employeeNo || '';
    }
    store.upsertGrant({
      openId,
      name: name || openId,
      employeeNo,
      role,
      grantedBy: actor.name || actor.openId,
    });
    res.json({ rbacStrict: isRbacStrict(), grants: store.listGrants() });
  });

  app.delete('/api/ops/admins/:openId', requireOperator, (req, res) => {
    const targetOpenId = req.params.openId;
    const grants = store.listGrants();
    if (grants.length === 1 && grants[0].openId === targetOpenId && !config.adminOpenIds.length && !config.adminEmployeeNos.length) {
      throw fail(400, 'LAST_ADMIN', '不能移除唯一一位运营管理员，否则所有人都将失去后台管理权限。');
    }
    store.deleteGrant(targetOpenId);
    res.json({ rbacStrict: isRbacStrict(), grants: store.listGrants() });
  });

  // ─── 项目清单（管理员） ────────────────────────────────────────────────────
  function parseProjectPayload(req) {
    const body = objectBody(req);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > PROJECT_NAME_MAX) {
      throw fail(400, 'INVALID_INPUT', `项目名称需为 1–${PROJECT_NAME_MAX} 字。`);
    }
    const ownerOpenId = typeof body.ownerOpenId === 'string' ? body.ownerOpenId.trim() : '';
    if (!ownerOpenId || (!OPEN_ID_RE.test(ownerOpenId) && config.mode !== 'demo')) {
      throw fail(400, 'INVALID_INPUT', '请选择项目负责人。');
    }
    const userIds = Array.isArray(body.userIds) ? strings(body.userIds, PROJECT_MEMBERS_MAX, OPEN_ID_RE, '成员 ID') : [];
    const departmentIds = Array.isArray(body.departmentIds) ? strings(body.departmentIds, LIMITS.departments, DEPT_ID_RE, '部门 ID') : [];
    const numbers = Array.isArray(body.numbers)
      ? strings(body.numbers, PROJECT_MEMBERS_MAX, /^[^\s\x00-\x1f\x7f]{1,128}$/u, '工号')
      : [];
    const departmentLabels = Array.isArray(body.departmentLabels)
      ? body.departmentLabels
        .filter(item => item && typeof item.id === 'string' && DEPT_ID_RE.test(item.id) && typeof item.name === 'string')
        .slice(0, LIMITS.departments)
        .map(item => ({ id: item.id, name: item.name.trim().slice(0, 120) }))
      : [];
    return {
      name,
      ownerOpenId,
      ownerLabel: { name: typeof body.ownerName === 'string' ? body.ownerName.trim().slice(0, 120) : '', employeeNo: typeof body.ownerEmployeeNo === 'string' ? body.ownerEmployeeNo.trim().slice(0, 64) : '' },
      userIds,
      departmentIds,
      numbers,
      departmentLabels,
      includeChildren: body.includeChildren !== false,
    };
  }

  async function resolveProjectInput(req, res, payload) {
    return query(req, res, async scoped => {
      const deptMap = typeof scoped.getDepartmentNameMap === 'function' ? await scoped.getDepartmentNameMap() : new Map();
      const owner = await scoped.getUser(payload.ownerOpenId);
      if (!owner) throw fail(422, 'OWNER_NOT_FOUND', '未能在通讯录中找到所选项目负责人。');
      const ownerMember = normalizeDirectoryMember(owner, deptMap);
      if (ownerMember.inactive) throw fail(422, 'OWNER_INACTIVE', '所选项目负责人已离职或账号被冻结，请重新选择。');
      const resolved = await resolveProjectMembers(scoped, { ...payload, ownerOpenId: payload.ownerOpenId });
      if (resolved.members.length > PROJECT_MEMBERS_MAX) {
        throw fail(422, 'TOO_MANY_MEMBERS', `项目成员最多 ${PROJECT_MEMBERS_MAX} 人，请缩小选择范围。`);
      }
      return { owner: ownerMember, members: resolved.members, issues: resolved.issues };
    });
  }

  app.get('/api/ops/projects', requireOperator, (_req, res) => {
    res.json({ projects: store.listProjects().map(formatProjectSummary) });
  });

  app.get('/api/ops/projects/:id', requireOperator, (req, res) => {
    const project = store.getProjectByKey(req.params.id);
    if (!project) throw fail(404, 'PROJECT_NOT_FOUND', '未找到该项目。');
    res.json({ project: formatProject(project, store.listProjectMembers(project.id)) });
  });

  app.post('/api/ops/projects', requireAdmin, async (req, res) => {
    const payload = parseProjectPayload(req);
    const resolved = await resolveProjectInput(req, res, payload);
    const actor = currentUser(req);
    const projectId = store.createProject({
      projectKey: makeProjectKey(),
      name: payload.name,
      owner: resolved.owner,
      members: resolved.members,
      createdBy: actor,
    });
    const project = store.getProject(projectId);
    res.status(201).json({
      project: formatProject(project, store.listProjectMembers(projectId)),
      issues: resolved.issues,
    });
  });

  app.put('/api/ops/projects/:id', requireAdmin, async (req, res) => {
    const project = store.getProjectByKey(req.params.id);
    if (!project) throw fail(404, 'PROJECT_NOT_FOUND', '未找到该项目。');
    const payload = parseProjectPayload(req);
    const resolved = await resolveProjectInput(req, res, payload);
    store.updateProject({
      projectId: project.id,
      name: payload.name,
      owner: resolved.owner,
      members: resolved.members,
    });
    const updated = store.getProject(project.id);
    res.json({
      project: formatProject(updated, store.listProjectMembers(project.id)),
      issues: resolved.issues,
    });
  });

  app.delete('/api/ops/projects/:id', requireAdmin, (req, res) => {
    const project = store.getProjectByKey(req.params.id);
    if (!project) throw fail(404, 'PROJECT_NOT_FOUND', '未找到该项目。');
    store.deleteProject(project.id);
    res.json({ deleted: true, id: project.projectKey });
  });

  app.post('/api/ops/directory/departments', requireOperator, async (req, res) => {
    const departments = await query(req, res, async scoped => {
      const deptMap = typeof scoped.getDepartmentNameMap === 'function' ? await scoped.getDepartmentNameMap() : new Map();
      if (!deptMap.size) return [];
      return [...deptMap.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    });
    res.json({ departments });
  });

  // ─── API 令牌（管理员） ────────────────────────────────────────────────────
  function formatTokenSummary(token) {
    return {
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      scopes: token.scopes,
      expiresAt: token.expiresAt,
      createdAt: token.createdAt,
      createdByName: token.createdByName,
      lastUsedAt: token.lastUsedAt,
      revokedAt: token.revokedAt,
      expired: Boolean(token.expiresAt) && Date.parse(token.expiresAt) <= Date.now(),
      usable: tokenIsUsable(token),
    };
  }

  app.get('/api/ops/tokens', requireAdmin, (_req, res) => {
    res.json({ scopes: API_SCOPES, tokens: store.listApiTokens().map(formatTokenSummary) });
  });

  app.post('/api/ops/tokens', requireAdmin, (req, res) => {
    const body = objectBody(req);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) throw fail(400, 'INVALID_INPUT', '令牌名称需为 1–80 字。');
    const scopes = normalizeScopes(body.scopes);
    if (!scopes.length) throw fail(400, 'INVALID_INPUT', '请至少选择一个权限范围。');
    let expiresAt = '';
    if (typeof body.expiresAt === 'string' && body.expiresAt.trim()) {
      const raw = body.expiresAt.trim();
      if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?$/.test(raw)) throw fail(400, 'INVALID_INPUT', '到期时间格式不正确（示例：2027-01-31）。');
      const parsed = Date.parse(raw.replace(' ', 'T'));
      if (!Number.isFinite(parsed) || parsed <= Date.now()) throw fail(400, 'INVALID_INPUT', '到期时间必须晚于当前时间。');
      expiresAt = new Date(parsed).toISOString();
    }
    const token = generateApiToken();
    const actor = currentUser(req);
    const id = store.createApiToken({
      name,
      prefix: tokenDisplayPrefix(token),
      tokenHash: hashApiToken(token),
      scopes,
      expiresAt,
      createdBy: actor,
    });
    const record = store.listApiTokens().find(item => item.id === id);
    res.status(201).json({ token, summary: formatTokenSummary(record) });
  });

  app.post('/api/ops/tokens/:id/revoke', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw fail(404, 'TOKEN_NOT_FOUND', '未找到该令牌。');
    if (!store.revokeApiToken(id)) throw fail(404, 'TOKEN_NOT_FOUND', '未找到该令牌。');
    res.json({ tokens: store.listApiTokens().map(formatTokenSummary) });
  });

  app.delete('/api/ops/tokens/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw fail(404, 'TOKEN_NOT_FOUND', '未找到该令牌。');
    if (!store.deleteApiToken(id)) throw fail(404, 'TOKEN_NOT_FOUND', '未找到该令牌。');
    res.json({ tokens: store.listApiTokens().map(formatTokenSummary) });
  });

  // ─── 对外只读 API（Bearer 令牌） ───────────────────────────────────────────
  // 独立于会话鉴权，供其他系统查询清单；不经过浏览器 CSRF 校验。
  app.get('/api/v1/projects', (req, res) => {
    const token = requireApiToken(req, 'projects:read');
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const cursor = typeof req.query.cursor === 'string' ? Number(req.query.cursor) : 0;
    const updatedSince = typeof req.query.updatedSince === 'string' ? Date.parse(req.query.updatedSince) : NaN;
    let projects = store.listProjects();
    if (Number.isFinite(updatedSince)) {
      projects = projects.filter(project => Date.parse(project.updatedAt) > updatedSince);
    }
    const start = Number.isSafeInteger(cursor) && cursor > 0 ? cursor : 0;
    const page = projects.slice(start, start + limit);
    const nextCursor = start + page.length < projects.length ? start + page.length : null;
    res.set('Cache-Control', 'no-store');
    res.json({
      data: page.map(formatProjectSummary),
      page: { limit, nextCursor, total: projects.length },
      serverTime: new Date().toISOString(),
      token: { name: token.name, scopes: token.scopes },
    });
  });

  app.get('/api/v1/projects/:id', (req, res) => {
    requireApiToken(req, 'projects:read');
    const project = store.getProjectByKey(req.params.id);
    if (!project) throw fail(404, 'PROJECT_NOT_FOUND', '未找到该项目。');
    res.set('Cache-Control', 'no-store');
    res.json({ data: formatProject(project, store.listProjectMembers(project.id)) });
  });

  function requireApiToken(req, scope) {
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+(\S+)$/i);
    if (!match) throw fail(401, 'TOKEN_REQUIRED', '请在 Authorization 头中提供 Bearer 令牌。');
    const record = store.getApiTokenByHash(hashApiToken(match[1]));
    if (!record || !tokenIsUsable(record)) throw fail(401, 'TOKEN_INVALID', '令牌无效、已停用或已过期。');
    if (!tokenHasScope(record, scope)) throw fail(403, 'SCOPE_REQUIRED', `该令牌缺少 ${scope} 权限范围。`);
    store.touchApiToken(record.id);
    return record;
  }

  // ─── 模块二：重要文件分发任务与全员通讯录对账（运营管理员） ─────────────────
  function formatTaskSummary(task) {
    const ackPath = `/ack/${task.slug}`;
    return {
      ...task,
      ackPath,
      ackUrl: `${config.appOrigin}${ackPath}`,
      feishuAppLink: makeFeishuAppLink(config.appId, config.appOrigin, ackPath),
    };
  }

  function parseTaskScope(rawScope) {
    if (!rawScope || typeof rawScope !== 'object' || Array.isArray(rawScope)) {
      throw fail(400, 'INVALID_INPUT', '请指定任务受众范围。');
    }
    if (rawScope.type === 'all') {
      return { type: 'all' };
    }
    if (rawScope.type === 'numbers') {
      const numbers = strings(rawScope.numbers, LIMITS.employeeNumbers, /^[^\s\x00-\x1f\x7f]{1,128}$/u, '工号', { allowEmpty: false });
      return { type: 'numbers', numbers };
    }
    if (rawScope.type === 'selection') {
      const userIds = strings(rawScope.userIds || [], LIMITS.users, OPEN_ID_RE, '成员 ID');
      const departmentIds = strings(rawScope.departmentIds || [], LIMITS.departments, DEPT_ID_RE, '部门 ID');
      const includeChildren = rawScope.includeChildren !== false;
      if (!userIds.length && !departmentIds.length) {
        throw fail(400, 'INVALID_INPUT', '指定范围模式至少需选择一位成员或一个部门。');
      }
      const departmentLabels = Array.isArray(rawScope.departmentLabels)
        ? rawScope.departmentLabels
          .filter(d => d && typeof d.id === 'string' && DEPT_ID_RE.test(d.id) && typeof d.name === 'string')
          .slice(0, LIMITS.departments)
          .map(d => ({ id: d.id, name: d.name.trim().slice(0, 120) }))
        : [];
      const userLabels = Array.isArray(rawScope.userLabels)
        ? rawScope.userLabels
          .filter(u => u && typeof u.id === 'string' && OPEN_ID_RE.test(u.id) && typeof u.name === 'string')
          .slice(0, LIMITS.users)
          .map(u => ({ id: u.id, name: u.name.trim().slice(0, 120) }))
        : [];
      return { type: 'selection', userIds, departmentIds, includeChildren: Boolean(includeChildren), departmentLabels, userLabels };
    }
    throw fail(400, 'INVALID_INPUT', '不支持的受众范围类型。');
  }

  app.get('/api/ops/tasks', requireOperator, (_req, res) => {
    const tasks = store.listTasks().map(formatTaskSummary);
    res.json({ tasks });
  });

  app.post('/api/ops/tasks', requireOperator, async (req, res) => {
    const body = objectBody(req);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
    if (!title || title.length > 160) throw fail(400, 'INVALID_INPUT', '请填写 1–160 字的任务标题。');
    if (!summary || summary.length > 8000) throw fail(400, 'INVALID_INPUT', '请填写 1–8000 字的必读说明或确认要求。');

    const docUrl = validateDocUrl(body.docUrl, config.production);
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim().slice(0, 200) : '';
    const fileSha256 = typeof body.fileSha256 === 'string' ? body.fileSha256.trim().toLowerCase() : '';
    if (fileSha256 && !SHA256_RE.test(fileSha256)) {
      throw fail(400, 'INVALID_INPUT', '文件 SHA-256 校验值必须为 64 位十六进制字符串，或留空。');
    }
    const version = typeof body.version === 'string' && body.version.trim() ? body.version.trim() : 'v1.0';
    if (!VERSION_RE.test(version)) {
      throw fail(400, 'INVALID_INPUT', '版本号仅允许字母、数字、点、下划线和连字符（如 v1.0）。');
    }
    const deadlineAt = typeof body.deadlineAt === 'string' ? body.deadlineAt.trim().slice(0, 32) : '';
    if (deadlineAt && !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?$/.test(deadlineAt)) {
      throw fail(400, 'INVALID_INPUT', '截止日期格式不正确（示例：2026-12-01）。');
    }
    const allowOutOfScope = Boolean(body.allowOutOfScope);
    const scope = parseTaskScope(body.scope);

    let customSlug;
    if (typeof body.slug === 'string' && body.slug.trim()) {
      customSlug = body.slug.trim().toLowerCase();
      if (!SLUG_RE.test(customSlug)) throw fail(400, 'INVALID_INPUT', '自定义短链标识需为 3–80 位字母、数字或连字符。');
      if (store.getTaskBySlug(customSlug)) throw fail(409, 'SLUG_TAKEN', '该短链标识已被占用，请更换或留空自动生成。');
    }

    const audience = await query(req, res, scoped => resolveTaskAudience(scoped, scope));
    if (audience.activeTargets.length === 0) {
      throw fail(422, 'EMPTY_AUDIENCE', '所选受众范围内未找到任何在职员工，请核对工号或部门选择范围后再创建任务。');
    }

    const actor = currentUser(req);
    const created = store.createTask({
      ...(customSlug ? { slug: customSlug } : {}),
      title,
      summary,
      docUrl,
      fileName,
      fileSha256,
      version,
      scope,
      allowOutOfScope,
      deadlineAt,
      createdBy: actor,
      targets: audience.activeTargets,
    });

    res.status(201).json({
      task: formatTaskSummary(created),
      snapshotStats: {
        activeTargets: audience.activeTargets.length,
        inactiveExcluded: audience.inactiveExcluded.length,
        issues: audience.issues,
      },
    });
  });

  async function loadTaskAndReconcile(req, res, slug) {
    if (!SLUG_RE.test(slug)) throw fail(404, 'TASK_NOT_FOUND', '未找到对应的文件分发任务。');
    const task = store.getTaskBySlug(slug);
    if (!task) throw fail(404, 'TASK_NOT_FOUND', '未找到对应的文件分发任务。');
    const targets = store.listTargets(task.id);
    const acks = store.listAcks(task.id, task.version);
    const liveAudience = task.status === 'active'
      ? await query(req, res, scoped => resolveTaskAudience(scoped, task.scope))
      : null;
    const report = reconcileTask({ task, targets, acks, liveAudience });
    return { task, report };
  }

  app.get('/api/ops/tasks/:slug', requireOperator, async (req, res) => {
    const { task, report } = await loadTaskAndReconcile(req, res, req.params.slug);
    res.json({
      task: formatTaskSummary(task),
      report,
      reminderLogs: store.listReminderLogs(task.id),
    });
  });

  app.get('/api/ops/tasks/:slug/export.csv', requireOperator, async (req, res) => {
    const { task, report } = await loadTaskAndReconcile(req, res, req.params.slug);
    const csv = buildReconcileCsv(task, report);
    const safeFilename = `${task.slug}-${task.version}-reconcile.csv`.replace(/[^A-Za-z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.send(csv);
  });

  app.post('/api/ops/tasks/:slug/include-joiners', requireOperator, async (req, res) => {
    const { task, report } = await loadTaskAndReconcile(req, res, req.params.slug);
    if (task.status !== 'active') throw fail(400, 'TASK_CLOSED', '已归档任务不可变更目标受众快照。');
    const body = objectBody(req);
    const filterIds = Array.isArray(body.openIds) && body.openIds.length
      ? new Set(strings(body.openIds, LIMITS.users, OPEN_ID_RE, '成员 ID'))
      : null;
    const toInclude = filterIds
      ? report.joinedAfter.filter(item => filterIds.has(item.openId))
      : report.joinedAfter;
    const addedCount = store.includeNewJoiners(task.id, toInclude);
    const refreshed = await loadTaskAndReconcile(req, res, req.params.slug);
    res.json({
      addedCount,
      task: formatTaskSummary(refreshed.task),
      report: refreshed.report,
    });
  });

  app.delete('/api/ops/tasks/:slug', requireOperator, (req, res) => {
    const slug = req.params.slug;
    if (!SLUG_RE.test(slug)) throw fail(404, 'TASK_NOT_FOUND', '未找到对应的文件分发任务。');
    const task = store.getTaskBySlug(slug);
    if (!task) throw fail(404, 'TASK_NOT_FOUND', '未找到对应的文件分发任务。');
    store.deleteTask(task.id);
    res.json({ deleted: true, slug });
  });

  app.post('/api/ops/tasks/:slug/status', requireOperator, async (req, res) => {
    const slug = req.params.slug;
    if (!SLUG_RE.test(slug)) throw fail(404, 'TASK_NOT_FOUND', '未找到对应的文件分发任务。');
    const task = store.getTaskBySlug(slug);
    if (!task) throw fail(404, 'TASK_NOT_FOUND', '未找到对应的文件分发任务。');
    const { status } = objectBody(req);
    if (!['active', 'closed'].includes(status)) throw fail(400, 'INVALID_INPUT', '任务状态只能为 active 或 closed。');
    store.setTaskStatus(task.id, status);
    const updated = await loadTaskAndReconcile(req, res, slug);
    res.json({
      task: formatTaskSummary(updated.task),
      report: updated.report,
    });
  });

  app.post('/api/ops/tasks/:slug/version', requireOperator, async (req, res) => {
    const slug = req.params.slug;
    if (!SLUG_RE.test(slug)) throw fail(404, 'TASK_NOT_FOUND', '未找到对应的文件分发任务。');
    const task = store.getTaskBySlug(slug);
    if (!task) throw fail(404, 'TASK_NOT_FOUND', '未找到对应的文件分发任务。');
    const body = objectBody(req);
    const version = typeof body.version === 'string' ? body.version.trim() : '';
    if (!VERSION_RE.test(version) || version === task.version) {
      throw fail(400, 'INVALID_INPUT', '请输入不同于当前版本的新版本号（例如 v2.0）。');
    }
    const summary = typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim().slice(0, 8000) : task.summary;
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim().slice(0, 200) : task.fileName;
    const fileSha256 = typeof body.fileSha256 === 'string' ? body.fileSha256.trim().toLowerCase() : task.fileSha256;
    if (fileSha256 && !SHA256_RE.test(fileSha256)) {
      throw fail(400, 'INVALID_INPUT', '文件 SHA-256 校验值必须为 64 位十六进制字符串，或留空。');
    }
    const docUrl = body.docUrl === undefined ? task.docUrl : validateDocUrl(body.docUrl, config.production);
    store.bumpTaskVersion(task.id, { version, summary, fileName, fileSha256, docUrl });
    const updated = await loadTaskAndReconcile(req, res, slug);
    res.json({
      task: formatTaskSummary(updated.task),
      report: updated.report,
    });
  });

  app.post('/api/ops/tasks/:slug/remind', requireOperator, async (req, res) => {
    const { task, report } = await loadTaskAndReconcile(req, res, req.params.slug);
    if (task.status !== 'active') throw fail(400, 'TASK_CLOSED', '该分发任务已截止归档，无法发送催办卡片。');
    if (task.lastRemindedAt && config.remindCooldownMs > 0) {
      const elapsed = Date.now() - Date.parse(task.lastRemindedAt);
      if (Number.isFinite(elapsed) && elapsed < config.remindCooldownMs) {
        const waitSec = Math.ceil((config.remindCooldownMs - elapsed) / 1000);
        throw fail(429, 'REMIND_COOLDOWN', `刚刚已发送过飞书催办卡片，请等待 ${waitSec} 秒后再试，避免重复打扰同事。`);
      }
    }
    const body = objectBody(req);
    const selectedIds = Array.isArray(body.openIds) && body.openIds.length
      ? new Set(strings(body.openIds, LIMITS.users, OPEN_ID_RE, '成员 ID'))
      : null;
    const recipients = selectedIds
      ? report.pending.filter(person => selectedIds.has(person.openId))
      : report.pending;
    if (!recipients.length) {
      throw fail(400, 'NO_PENDING_TARGETS', '当前没有待确认的在职成员，无需发送催办。');
    }

    const summaryTask = formatTaskSummary(task);
    const card = buildReminderCard({
      title: task.title,
      version: task.version,
      deadlineAt: task.deadlineAt,
      summary: task.summary,
      ackUrl: summaryTask.ackUrl,
    });

    let delivery;
    if (config.mode === 'demo') {
      delivery = {
        total: recipients.length,
        sentCount: recipients.length,
        failedCount: 0,
        failures: [],
        simulated: true,
      };
    } else {
      const batchId = `${task.id}-${Date.now().toString(36)}`;
      delivery = await query(req, res, (_scoped, signal) => sendFeishuReminderCards(apiClient, {
        recipients,
        card,
        batchId,
        signal,
      }));
    }

    const actor = currentUser(req);
    const remindedAt = store.recordReminder({
      taskId: task.id,
      triggeredBy: actor.name || actor.openId,
      totalTargets: delivery.total,
      sentCount: delivery.sentCount,
      failedCount: delivery.failedCount,
    });

    res.json({
      remindedAt,
      delivery,
      reminderLogs: store.listReminderLogs(task.id),
    });
  });

  // ─── 全体员工端：邮件链接确认单据页与个人回执记录 ─────────────────────────
  async function resolveEmployeeContext(req, res, task, user) {
    const targets = store.listTargets(task.id);
    const snapshotMatch = targets.find(item => item.openId === user.openId) || null;
    if (snapshotMatch) {
      return {
        inTargetScope: true,
        enrichedUser: {
          ...user,
          name: user.name || snapshotMatch.name,
          employeeNo: user.employeeNo || snapshotMatch.employeeNo,
          email: user.email || snapshotMatch.email,
          departmentNames: user.departmentNames || snapshotMatch.departmentNames,
        },
      };
    }
    // Check live directory in case user joined after task snapshot (e.g. scope=all or selection).
    try {
      const liveMember = await query(req, res, async scoped => {
        const deptMap = typeof scoped.getDepartmentNameMap === 'function' ? await scoped.getDepartmentNameMap() : new Map();
        const found = await scoped.getUser(user.openId).catch(() => null);
        return found ? normalizeDirectoryMember(found, deptMap) : null;
      });
      const inAllScope = Boolean(liveMember && !liveMember.inactive && task.scope.type === 'all');
      return {
        inTargetScope: inAllScope,
        enrichedUser: liveMember
          ? {
              ...user,
              name: liveMember.name || user.name,
              employeeNo: liveMember.employeeNo || user.employeeNo || '',
              email: liveMember.email || user.email || '',
              departmentNames: liveMember.departmentNames || user.departmentNames || '',
            }
          : user,
      };
    } catch {
      return { inTargetScope: false, enrichedUser: user };
    }
  }

  app.get('/api/ack/:slug', async (req, res) => {
    const slug = req.params.slug;
    if (!SLUG_RE.test(slug)) throw fail(404, 'TASK_NOT_FOUND', '确认链接无效或分发任务不存在。');
    const task = store.getTaskBySlug(slug);
    if (!task) throw fail(404, 'TASK_NOT_FOUND', '确认链接无效或分发任务不存在。');
    const summaryTask = formatTaskSummary(task);
    const user = currentUser(req);
    if (!user) {
      return res.json({
        authenticated: false,
        feishuAppLink: summaryTask.feishuAppLink,
        oauthStartUrl: `/api/auth/oauth/start?returnTo=${encodeURIComponent(`/ack/${task.slug}`)}`,
        task: {
          slug: task.slug,
          title: task.title,
          version: task.version,
          deadlineAt: task.deadlineAt,
          status: task.status,
          createdByName: task.createdByName,
        },
      });
    }

    const existingAck = store.getAck(task.id, task.version, user.openId);
    const { inTargetScope, enrichedUser } = await resolveEmployeeContext(req, res, task, user);
    const eligible = inTargetScope || task.allowOutOfScope || Boolean(existingAck);

    return res.json({
      authenticated: true,
      feishuAppLink: summaryTask.feishuAppLink,
      user: enrichedUser,
      inTargetScope,
      eligible,
      ack: existingAck,
      task: {
        slug: task.slug,
        title: task.title,
        summary: eligible ? task.summary : '',
        docUrl: eligible ? task.docUrl : '',
        fileName: eligible ? task.fileName : '',
        fileSha256: eligible ? task.fileSha256 : '',
        version: task.version,
        deadlineAt: task.deadlineAt,
        status: task.status,
        allowOutOfScope: task.allowOutOfScope,
        createdByName: task.createdByName,
        createdAt: task.createdAt,
      },
    });
  });

  app.post('/api/ack/:slug/confirm', requireAuth, async (req, res) => {
    const slug = req.params.slug;
    if (!SLUG_RE.test(slug)) throw fail(404, 'TASK_NOT_FOUND', '确认链接无效或分发任务不存在。');
    const task = store.getTaskBySlug(slug);
    if (!task) throw fail(404, 'TASK_NOT_FOUND', '确认链接无效或分发任务不存在。');
    objectBody(req);

    const user = currentUser(req);
    const existingAck = store.getAck(task.id, task.version, user.openId);
    if (existingAck) {
      return res.json({ alreadyConfirmed: true, ack: existingAck });
    }
    if (task.status !== 'active') {
      throw fail(400, 'TASK_CLOSED', '该文件的确认收集已截止归档，如有疑问请联系任务发起人。');
    }

    const { inTargetScope, enrichedUser } = await resolveEmployeeContext(req, res, task, user);
    if (!inTargetScope && !task.allowOutOfScope) {
      throw fail(403, 'NOT_IN_SCOPE', '当前任务仅面向指定部门或成员开放确认，你的账号不在本次应确认名单内。');
    }
    // If scope=all and user joined after snapshot, automatically add them into task_targets so denominator stays accurate.
    if (inTargetScope && !store.isUserInTargetSnapshot(task.id, enrichedUser.openId)) {
      store.includeNewJoiners(task.id, [enrichedUser]);
    }

    const result = store.confirmTask({
      taskId: task.id,
      version: task.version,
      user: enrichedUser,
      inTargetScope,
      authChannel: currentAuthChannel(req),
    });
    return res.json(result);
  });

  app.get('/api/my/acks', requireAuth, (req, res) => {
    const user = currentUser(req);
    res.json({ acks: store.listUserAcks(user.openId) });
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
      return res.status(502).json(errorBody('FEISHU_API_ERROR', '飞书接口调用失败，请检查应用通讯录权限、机器人消息权限或稍后重试。'));
    }
    console.error('unhandled_query_error', error?.name || 'Error', error?.message || 'unknown');
    return res.status(502).json(errorBody('SERVICE_UNAVAILABLE', '请求暂未完成，请检查通讯录授权范围与字段权限，或稍后重试。'));
  });
  return app;
}

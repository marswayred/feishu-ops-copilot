import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.js';

const ORIGIN = 'http://localhost:5173';
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

async function startServer(t, options = {}) {
  const app = createApp(options);
  const http = app.listen(0, '127.0.0.1');
  await once(http, 'listening');
  t.after(async () => {
    app.locals.close?.();
    http.closeAllConnections();
    await new Promise(resolve => http.close(resolve));
  });
  const base = `http://127.0.0.1:${http.address().port}`;
  const request = (route, { method = 'GET', body, cookie, origin = ORIGIN, redirect = 'manual', headers = {} } = {}) => fetch(base + route, {
    method,
    redirect,
    headers: {
      ...(method !== 'GET' ? { Origin: origin } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { app, base, request };
}

test('web OAuth 2.0 flow redirects with CSRF state, rejects open redirects and establishes SameSite=Lax session', async t => {
  const tokenCalls = [];
  const fetchImpl = async (url, options) => {
    tokenCalls.push({ url, options });
    if (url === 'https://accounts.feishu.cn/oauth/v3/token') {
      return json({ code: 0, access_token: 'WEB_USER_TOKEN', expires_in: 7200 });
    }
    if (url === 'https://open.feishu.cn/open-apis/authen/v1/user_info') {
      return json({
        code: 0,
        data: { open_id: 'ou_emp_web', name: '李明', employee_no: 'E2001', enterprise_email: 'li.ming@example.com' },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const directory = {
    listAllUsers: async () => [{ open_id: 'ou_emp_web', name: '李明', employee_no: 'E2001', enterprise_email: 'li.ming@example.com' }],
    getUser: async () => ({ open_id: 'ou_emp_web', name: '李明', employee_no: 'E2001', enterprise_email: 'li.ming@example.com' }),
    listDepartmentUsers: async () => [],
    listDescendantDepartments: async () => [],
  };
  const { request } = await startServer(t, {
    config: {
      mode: 'feishu',
      appOrigin: ORIGIN,
      appId: 'cli_unified',
      appSecret: 'secret_val',
      adminOpenIds: ['ou_admin_boss'],
      directoryCachePath: null,
    },
    directory,
    fetchImpl,
  });

  // Malicious external returnTo falls back safely to '/'
  const evilStart = await request('/api/auth/oauth/start?returnTo=//evil.example/steal');
  assert.equal(evilStart.status, 302);

  // Valid ack returnTo preserves target path
  const start = await request('/api/auth/oauth/start?returnTo=%2Fack%2Fpolicy-2026');
  assert.equal(start.status, 302);
  const authUrl = new URL(start.headers.get('location'));
  assert.equal(authUrl.origin, 'https://accounts.feishu.cn');
  assert.equal(authUrl.searchParams.get('client_id'), 'cli_unified');
  assert.equal(authUrl.searchParams.get('redirect_uri'), `${ORIGIN}/api/auth/oauth/callback`);
  const state = authUrl.searchParams.get('state');
  assert.match(state, /^[a-f0-9]{48}$/);

  const callback = await request(`/api/auth/oauth/callback?code=web_auth_code&state=${state}`);
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/ack/policy-2026');
  const setCookie = callback.headers.get('set-cookie');
  assert.match(setCookie, /SameSite=Lax/);
  assert.equal(tokenCalls[0].options.body.get('redirect_uri'), `${ORIGIN}/api/auth/oauth/callback`);

  // Replaying same state is rejected
  const replay = await request(`/api/auth/oauth/callback?code=web_auth_code&state=${state}`);
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error.code, 'OAUTH_STATE_EXPIRED');

  // Logged-in employee has role='employee' and cannot access operator endpoints
  const empCookie = setCookie.split(';')[0];
  const boot = await (await request('/api/bootstrap', { cookie: empCookie })).json();
  assert.equal(boot.authenticated, true);
  assert.equal(boot.user.role, 'employee');
  assert.equal(boot.user.canManageOps, false);
  assert.equal((await request('/api/ops/tasks', { cookie: empCookie })).status, 403);
  assert.equal((await request('/api/resolve/employee-numbers', { method: 'POST', cookie: empCookie, body: { numbers: ['E2001'] } })).status, 403);
});

test('end-to-end task lifecycle: snapshot, employee confirm, live joiner/resigned reconciliation, CSV export and bot reminder', async t => {
  let currentUsers = [
    { open_id: 'ou_admin', name: '王管理员', employee_no: 'E001', enterprise_email: 'admin@example.com', department_ids: ['od-ops'] },
    { open_id: 'ou_alice', name: '张晓', employee_no: 'E002', enterprise_email: 'alice@example.com', department_ids: ['od-rd'] },
    { open_id: 'ou_bob', name: '周博', employee_no: 'E003', enterprise_email: '=cmd@example.com', department_ids: ['od-rd'] },
    { open_id: 'ou_leaver', name: '陈离职', employee_no: 'E004', enterprise_email: 'leave@example.com', department_ids: ['od-ops'] },
  ];
  const deptMap = new Map([['od-ops', '运营部'], ['od-rd', '研发部']]);
  const sentMessages = [];
  const client = {
    async request(path, options) {
      if (path === '/im/v1/messages') {
        sentMessages.push({ query: options.query, body: options.body });
        return { code: 0, data: { message_id: `om_${sentMessages.length}` } };
      }
      throw new Error(`Unexpected client path: ${path}`);
    },
  };
  const directory = {
    getDepartmentNameMap: async () => deptMap,
    listAllUsers: async () => structuredClone(currentUsers),
    getUser: async id => structuredClone(currentUsers.find(u => u.open_id === id) || null),
    listDepartmentUsers: async id => structuredClone(currentUsers.filter(u => u.department_ids.includes(id))),
    listDescendantDepartments: async () => [],
  };

  let loginIdentity = { open_id: 'ou_admin', name: '王管理员', employee_no: 'E001' };
  const fetchImpl = async url => {
    if (url.includes('/token')) return json({ code: 0, access_token: 'tok', expires_in: 7200 });
    return json({ code: 0, data: loginIdentity });
  };

  const { request } = await startServer(t, {
    config: {
      mode: 'feishu',
      appOrigin: ORIGIN,
      appId: 'cli_ops',
      appSecret: 'secret',
      adminEmployeeNos: ['E001'],
      remindCooldownMs: 5000,
      directoryCachePath: null,
    },
    client,
    directory,
    fetchImpl,
  });

  // 1. Admin logs in (matched by ADMIN_EMPLOYEE_NOS='E001')
  const adminLogin = await request('/api/auth/feishu', { method: 'POST', body: { code: 'admin_code' } });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

  // 2. Admin creates an all-staff task -> snapshots 4 active users
  const createRes = await request('/api/ops/tasks', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      slug: 'sec-handbook-2026',
      title: '信息安全手册确认',
      summary: '请阅读并确认遵守信息安全手册。',
      fileName: 'security.pdf',
      version: 'v1.0',
      deadlineAt: '2026-12-31',
      scope: { type: 'all' },
    },
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.equal(created.snapshotStats.activeTargets, 4);
  assert.equal(created.task.ackUrl, `${ORIGIN}/ack/sec-handbook-2026`);

  // 3. Unauthenticated GET /api/ack/:slug returns public metadata without leaking summary or member list
  const anonAck = await (await request('/api/ack/sec-handbook-2026')).json();
  assert.equal(anonAck.authenticated, false);
  assert.equal(anonAck.task.title, '信息安全手册确认');
  assert.equal(anonAck.task.summary, undefined);

  // 4. Employee Alice logs in and confirms receipt idempotently
  loginIdentity = { open_id: 'ou_alice', name: '张晓', employee_no: 'E002', enterprise_email: 'alice@example.com' };
  const aliceLogin = await request('/api/auth/feishu', { method: 'POST', body: { code: 'alice_code' } });
  const aliceCookie = aliceLogin.headers.get('set-cookie').split(';')[0];

  const confirm1 = await (await request('/api/ack/sec-handbook-2026/confirm', { method: 'POST', cookie: aliceCookie, body: {} })).json();
  assert.equal(confirm1.alreadyConfirmed, false);
  assert.match(confirm1.ack.receiptNo, /^ACK-\d{8}-[A-F0-9]{6}$/);

  const confirm2 = await (await request('/api/ack/sec-handbook-2026/confirm', { method: 'POST', cookie: aliceCookie, body: {} })).json();
  assert.equal(confirm2.alreadyConfirmed, true);
  assert.equal(confirm2.ack.receiptNo, confirm1.ack.receiptNo);

  const myAcks = await (await request('/api/my/acks', { cookie: aliceCookie })).json();
  assert.equal(myAcks.acks.length, 1);
  assert.equal(myAcks.acks[0].slug, 'sec-handbook-2026');

  // 5. Simulate live org changes: ou_leaver resigns, and ou_newbie joins after task creation!
  currentUsers = [
    currentUsers[0],
    currentUsers[1],
    currentUsers[2],
    { ...currentUsers[3], status: { is_resigned: true } },
    { open_id: 'ou_newbie', name: '新同事', employee_no: 'E005', enterprise_email: 'newbie@example.com', department_ids: ['od-rd'] },
  ];

  // 6. Admin inspects reconciliation: 3 active targets (1 confirmed, 2 pending), 1 inactive excluded, 1 joinedAfter!
  const detail1 = await (await request('/api/ops/tasks/sec-handbook-2026', { cookie: adminCookie })).json();
  assert.equal(detail1.report.stats.activeTargetCount, 3);
  assert.equal(detail1.report.stats.confirmedCount, 1);
  assert.equal(detail1.report.stats.pendingCount, 2);
  assert.equal(detail1.report.stats.inactiveCount, 1);
  assert.equal(detail1.report.stats.joinedAfterCount, 1);
  assert.equal(detail1.report.pendingEmailText, 'admin@example.com =cmd@example.com');

  // 7. Admin incorporates new joiner into task snapshot -> activeTargetCount becomes 4, pending becomes 3
  const incRes = await (await request('/api/ops/tasks/sec-handbook-2026/include-joiners', {
    method: 'POST',
    cookie: adminCookie,
    body: {},
  })).json();
  assert.equal(incRes.addedCount, 1);
  assert.equal(incRes.report.stats.activeTargetCount, 4);
  assert.equal(incRes.report.stats.pendingCount, 3);
  assert.equal(incRes.report.stats.joinedAfterCount, 0);

  // 8. Admin triggers Feishu bot interactive card reminders -> sends to 3 pending recipients, enforces cooldown
  const remind1 = await request('/api/ops/tasks/sec-handbook-2026/remind', {
    method: 'POST',
    cookie: adminCookie,
    body: {},
  });
  assert.equal(remind1.status, 200);
  const remindBody = await remind1.json();
  assert.equal(remindBody.delivery.sentCount, 3);
  assert.equal(sentMessages.length, 3);
  assert.equal(sentMessages[0].query.receive_id_type, 'open_id');
  assert.equal(sentMessages[0].body.msg_type, 'interactive');
  assert.match(sentMessages[0].body.content, /sec-handbook-2026/);

  const remindCooldown = await request('/api/ops/tasks/sec-handbook-2026/remind', {
    method: 'POST',
    cookie: adminCookie,
    body: {},
  });
  assert.equal(remindCooldown.status, 429);
  assert.equal((await remindCooldown.json()).error.code, 'REMIND_COOLDOWN');

  // 9. CSV export neutralizes spreadsheet formula cells starting with '='
  const csvRes = await request('/api/ops/tasks/sec-handbook-2026/export.csv', { cookie: adminCookie });
  assert.equal(csvRes.status, 200);
  const csvText = await csvRes.text();
  assert.ok(csvText.includes("'=cmd@example.com"));

  // 10. Version bump to v2.0 resets active version progress while keeping snapshot
  const bumpRes = await (await request('/api/ops/tasks/sec-handbook-2026/version', {
    method: 'POST',
    cookie: adminCookie,
    body: { version: 'v2.0', summary: '第二版修订条款' },
  })).json();
  assert.equal(bumpRes.task.version, 'v2.0');
  assert.equal(bumpRes.report.stats.confirmedCount, 0);
  assert.equal(bumpRes.report.stats.pendingCount, 4);

  loginIdentity = { open_id: 'ou_alice', name: '张晓', employee_no: 'E002' };
  const employeeLogin = await request('/api/auth/feishu', { method: 'POST', body: { code: 'employee_code' } });
  const employeeCookie = employeeLogin.headers.get('set-cookie').split(';')[0];
  const denied = await request('/api/ops/tasks/sec-handbook-2026', { method: 'DELETE', cookie: employeeCookie });
  assert.equal(denied.status, 403);

  const removed = await request('/api/ops/tasks/sec-handbook-2026', { method: 'DELETE', cookie: adminCookie });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).deleted, true);
  assert.equal((await request('/api/ops/tasks/sec-handbook-2026', { cookie: adminCookie })).status, 404);
  assert.equal((await request('/api/ack/sec-handbook-2026')).status, 404);
  const remaining = await (await request('/api/ops/tasks', { cookie: adminCookie })).json();
  assert.equal(remaining.tasks.some(task => task.slug === 'sec-handbook-2026'), false);
});

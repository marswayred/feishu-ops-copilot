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
  const request = (route, { method = 'GET', body, cookie, origin = ORIGIN, headers = {} } = {}) => fetch(base + route, {
    method,
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

const users = [
  { open_id: 'ou_admin', name: '王管理员', employee_no: 'E001', enterprise_email: 'admin@example.com', department_ids: ['od-ops'] },
  { open_id: 'ou_alice', name: '张晓', employee_no: 'E002', enterprise_email: 'alice@example.com', department_ids: ['od-rd'] },
  { open_id: 'ou_bob', name: '周博', employee_no: 'E003', enterprise_email: 'bob@example.com', department_ids: ['od-rd'] },
  { open_id: 'ou_carol', name: '陈悦', employee_no: 'E004', enterprise_email: 'carol@example.com', department_ids: ['od-rd'] },
  { open_id: 'ou_leaver', name: '离职者', employee_no: 'E009', enterprise_email: 'gone@example.com', department_ids: ['od-ops'], status: { is_resigned: true } },
];

const deptMap = new Map([['od-ops', '运营部'], ['od-rd', '研发部'], ['od-rd-fe', '前端组']]);

function makeDirectory() {
  return {
    getDepartmentNameMap: async () => new Map(deptMap),
    listAllUsers: async () => structuredClone(users),
    getUser: async id => structuredClone(users.find(user => user.open_id === id) || null),
    listDepartmentUsers: async id => structuredClone(users.filter(user => user.department_ids.includes(id))),
    listDescendantDepartments: async id => (id === 'od-rd' ? [{ open_department_id: 'od-rd-fe', name: '前端组' }] : []),
  };
}

async function setup(t, extra = {}) {
  let identity = { open_id: 'ou_admin', name: '王管理员', employee_no: 'E001' };
  const fetchImpl = async url => {
    if (url.includes('/token')) return json({ code: 0, access_token: 'tok', expires_in: 7200 });
    return json({ code: 0, data: identity });
  };
  const ctx = await startServer(t, {
    config: {
      mode: 'feishu',
      appOrigin: ORIGIN,
      appId: 'cli_projects',
      appSecret: 'secret',
      adminEmployeeNos: ['E001', 'E002'],
      directoryCachePath: null,
      ...extra,
    },
    directory: makeDirectory(),
    fetchImpl,
  });
  const adminLogin = await ctx.request('/api/auth/feishu', { method: 'POST', body: { code: 'admin' } });
  const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
  const asEmployee = async (openId, name, employeeNo) => {
    identity = { open_id: openId, name, employee_no: employeeNo };
    const res = await ctx.request('/api/auth/feishu', { method: 'POST', body: { code: `${openId}-code` } });
    return res.headers.get('set-cookie').split(';')[0];
  };
  return { ...ctx, adminCookie, asEmployee };
}

test('projects: admin CRUD with owner, people, department expansion and number import', async t => {
  const { request, adminCookie } = await setup(t);

  const created = await request('/api/ops/projects', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: '星火计划',
      ownerOpenId: 'ou_alice',
      ownerName: '张晓',
      ownerEmployeeNo: 'E002',
      userIds: ['ou_bob', 'ou_leila'],
      departmentIds: ['od-rd'],
      departmentLabels: [{ id: 'od-rd', name: '研发部' }],
      numbers: ['E004', 'E009', 'E999'],
      includeChildren: true,
    },
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  const project = createdBody.project;
  assert.equal(project.name, '星火计划');
  assert.equal(project.owner.openId, 'ou_alice');
  // 负责人不重复计入成员；离职、未找到的人员记入 issues
  assert.deepEqual(project.members.map(m => m.employeeNo).sort(), ['E003', 'E004']);
  assert.equal(project.memberCount, 2);
  assert.ok(createdBody.issues.length >= 2);

  const listed = await (await request('/api/ops/projects', { cookie: adminCookie })).json();
  assert.equal(listed.projects.length, 1);
  assert.equal(listed.projects[0].memberCount, 2);

  const detail = await (await request(`/api/ops/projects/${project.id}`, { cookie: adminCookie })).json();
  assert.equal(detail.project.members.length, 2);
  assert.equal(detail.project.members[0].departmentNames.length > 0, true);

  const updated = await request(`/api/ops/projects/${project.id}`, {
    method: 'PUT',
    cookie: adminCookie,
    body: { name: '星火计划二期', ownerOpenId: 'ou_admin', userIds: ['ou_carol'] },
  });
  assert.equal(updated.status, 200);
  const updatedBody = await updated.json();
  assert.equal(updatedBody.project.name, '星火计划二期');
  assert.deepEqual(updatedBody.project.members.map(m => m.openId), ['ou_carol']);

  const removed = await request(`/api/ops/projects/${project.id}`, { method: 'DELETE', cookie: adminCookie });
  assert.equal(removed.status, 200);
  assert.equal((await request(`/api/ops/projects/${project.id}`, { cookie: adminCookie })).status, 404);
});

test('projects: operator can read list but cannot create, edit or delete', async t => {
  const { request, adminCookie, asEmployee } = await setup(t);
  const created = await (await request('/api/ops/projects', {
    method: 'POST',
    cookie: adminCookie,
    body: { name: '只读项目', ownerOpenId: 'ou_alice', userIds: ['ou_bob'] },
  })).json();
  const operatorCookie = await asEmployee('ou_leila', '普通运营', 'E500');
  // 未授权账号既不是管理员也不是运营协作者
  assert.equal((await request('/api/ops/projects', { cookie: operatorCookie })).status, 403);

  await request('/api/ops/admins', { method: 'POST', cookie: adminCookie, body: { openId: 'ou_leila', name: '普通运营', role: 'operator' } });

  const list = await request('/api/ops/projects', { cookie: operatorCookie });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).projects.length, 1);
  assert.equal((await request(`/api/ops/projects/${created.project.id}`, { cookie: operatorCookie })).status, 200);
  assert.equal((await request('/api/ops/projects', {
    method: 'POST', cookie: operatorCookie, body: { name: 'x', ownerOpenId: 'ou_bob' },
  })).status, 403);
  assert.equal((await request(`/api/ops/projects/${created.project.id}`, {
    method: 'PUT', cookie: operatorCookie, body: { name: 'y', ownerOpenId: 'ou_bob' },
  })).status, 403);
  assert.equal((await request(`/api/ops/projects/${created.project.id}`, { method: 'DELETE', cookie: operatorCookie })).status, 403);
});

test('projects: invalid owner is rejected and departments endpoint returns names', async t => {
  const { request, adminCookie } = await setup(t);
  const badOwner = await request('/api/ops/projects', {
    method: 'POST', cookie: adminCookie, body: { name: '无负责人项目', ownerOpenId: 'ou_missing' },
  });
  assert.equal(badOwner.status, 422);
  assert.equal((await badOwner.json()).error.code, 'OWNER_NOT_FOUND');

  const badName = await request('/api/ops/projects', {
    method: 'POST', cookie: adminCookie, body: { name: '  ', ownerOpenId: 'ou_alice' },
  });
  assert.equal(badName.status, 400);

  const departments = await (await request('/api/ops/directory/departments', { method: 'POST', cookie: adminCookie })).json();
  assert.deepEqual(departments.departments.map(d => d.name).sort(), ['前端组', '研发部', '运营部']);
});

test('api tokens: creation returns plaintext once, list hides it, scopes are enforced', async t => {
  const { request, adminCookie } = await setup(t);
  const createdProject = await (await request('/api/ops/projects', {
    method: 'POST', cookie: adminCookie, body: { name: '令牌项目', ownerOpenId: 'ou_alice', userIds: ['ou_bob'] },
  })).json();

  const withoutScope = await request('/api/ops/tokens', {
    method: 'POST', cookie: adminCookie, body: { name: '空范围', scopes: ['nonsense:read'] },
  });
  assert.equal(withoutScope.status, 400);

  const created = await request('/api/ops/tokens', {
    method: 'POST', cookie: adminCookie, body: { name: '人事系统', scopes: ['projects:read'], expiresAt: '2099-01-31' },
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.match(createdBody.token, /^opsk_[A-Za-z0-9_-]{10,}$/);
  assert.equal(createdBody.summary.name, '人事系统');
  assert.deepEqual(createdBody.summary.scopes, ['projects:read']);

  const listed = await (await request('/api/ops/tokens', { cookie: adminCookie })).json();
  assert.equal(listed.tokens.length, 1);
  assert.equal(JSON.stringify(listed).includes(createdBody.token), false);
  assert.deepEqual(listed.scopes, ['projects:read', 'projects:write', 'directory:read', 'tasks:read']);

  // 对外只读 API 使用 Bearer，不需要浏览器会话
  assert.equal((await request('/api/v1/projects')).status, 401);
  assert.equal((await request('/api/v1/projects', { headers: { Authorization: 'Bearer opsk_wrong' } })).status, 401);
  const viaToken = await request('/api/v1/projects', { headers: { Authorization: `Bearer ${createdBody.token}` } });
  assert.equal(viaToken.status, 200);
  const viaTokenBody = await viaToken.json();
  assert.equal(viaTokenBody.data.length, 1);
  assert.equal(viaTokenBody.data[0].name, '令牌项目');
  assert.equal(viaTokenBody.page.total, 1);

  const single = await request(`/api/v1/projects/${createdProject.project.id}`, { headers: { Authorization: `Bearer ${createdBody.token}` } });
  assert.equal(single.status, 200);
  assert.equal((await single.json()).data.memberCount, 1);

  // 只读令牌不能写；写接口不对外开放
  assert.equal((await request(`/api/v1/projects/${createdProject.project.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${createdBody.token}` }, body: { name: 'x' },
  })).status, 404);

  const refreshed = await (await request('/api/ops/tokens', { cookie: adminCookie })).json();
  assert.ok(refreshed.tokens[0].lastUsedAt);

  const id = createdBody.summary.id;
  const revoked = await request(`/api/ops/tokens/${id}/revoke`, { method: 'POST', cookie: adminCookie, body: {} });
  assert.equal(revoked.status, 200);
  assert.equal((await request('/api/v1/projects', { headers: { Authorization: `Bearer ${createdBody.token}` } })).status, 401);
});

test('api tokens: expired tokens are rejected and only admins can manage tokens', async t => {
  const { request, adminCookie, asEmployee } = await setup(t);
  const expired = await request('/api/ops/tokens', {
    method: 'POST', cookie: adminCookie, body: { name: '过去', scopes: ['projects:read'], expiresAt: '2001-01-01' },
  });
  assert.equal(expired.status, 400);

  const created = await (await request('/api/ops/tokens', {
    method: 'POST', cookie: adminCookie, body: { name: '临时', scopes: ['projects:read'] },
  })).json();

  const operatorCookie = await asEmployee('ou_bob', '周博', 'E003');
  assert.equal((await request('/api/ops/tokens', { cookie: operatorCookie })).status, 403);
  assert.equal((await request('/api/ops/tokens', { method: 'POST', cookie: operatorCookie, body: { name: 'x', scopes: ['projects:read'] } })).status, 403);

  const removed = await request(`/api/ops/tokens/${created.summary.id}`, { method: 'DELETE', cookie: adminCookie });
  assert.equal(removed.status, 200);
  assert.equal((await request('/api/v1/projects', { headers: { Authorization: `Bearer ${created.token}` } })).status, 401);
});

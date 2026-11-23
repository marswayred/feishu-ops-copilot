import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { DirectoryError } from '../server/directory.js';

async function start(t, options) {
  let app;
  const server = createServer((req, res) => app(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  app = createApp({ ...options, config: { mode: 'demo', ...options.config, appOrigin: origin } });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return (path, body, extra = {}) => fetch(origin + path, { method: 'POST', ...extra, headers: { Origin: origin, 'Content-Type': 'application/json', ...extra.headers }, body: JSON.stringify(body) });
}

function blockingDirectory() {
  let entered, stopped;
  const began = new Promise(resolve => { entered = resolve; });
  const ended = new Promise(resolve => { stopped = resolve; });
  let calls = 0;
  return {
    began, ended,
    withSignal(signal) {
      return { signal, async listAllUsers() {
        calls += 1;
        if (calls > 1) return [];
        entered();
        return new Promise((resolve, reject) => {
          const abort = () => { stopped(signal.reason); reject(signal.reason); };
          if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
        });
      } };
    },
  };
}

test('whole-query deadline aborts underlying scan and frees capacity only after it stops', async t => {
  const directory = blockingDirectory();
  const post = await start(t, { directory, config: { maxConcurrentQueries: 1, queryTimeoutMs: 30 } });
  const response = await post('/api/resolve/employee-numbers', { numbers: ['E1001'] });
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, 'QUERY_TIMEOUT');
  assert.equal((await directory.ended).code, 'QUERY_TIMEOUT');
  const next = await post('/api/resolve/employee-numbers', { numbers: ['E1001'] });
  assert.equal(next.status, 200);
});

test('disconnect aborts scan and does not strand concurrency slot', async t => {
  const directory = blockingDirectory();
  const post = await start(t, { directory, config: { maxConcurrentQueries: 1 } });
  const controller = new AbortController();
  const pending = post('/api/resolve/employee-numbers', { numbers: ['E1001'] }, { signal: controller.signal });
  await directory.began;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal((await directory.ended).code, 'CLIENT_DISCONNECTED');
  const next = await post('/api/resolve/employee-numbers', { numbers: ['E1001'] });
  assert.equal(next.status, 200);
});

test('safe directory errors expose a useful reason but raw upstream errors stay hidden', async t => {
  let safe = true;
  const post = await start(t, { directory: { async listAllUsers() { throw safe ? new DirectoryError('通讯录授权范围未知或字段缺失。') : new Error('SECRET upstream data'); } } });
  const first = await post('/api/resolve/employee-numbers', { numbers: ['E1001'] });
  assert.equal(first.status, 422);
  assert.equal((await first.json()).error.message, '通讯录授权范围未知或字段缺失。');
  safe = false;
  const second = await post('/api/resolve/employee-numbers', { numbers: ['E1001'] });
  assert.equal(second.status, 502);
  assert.doesNotMatch(await second.text(), /SECRET/);
});

test('full scan capacity does not block the separate login capacity', async t => {
  const directory = blockingDirectory();
  const config = { mode: 'feishu', appId: 'cli_test', appSecret: 'test-secret', tenantKey: 'tenant-test', maxConcurrentQueries: 1, directoryCachePath: null };
  const fetchImpl = async url => new Response(JSON.stringify(url.includes('/token')
    ? { code: 0, access_token: 'user-token', expires_in: 7200 }
    : { code: 0, data: { tenant_key: 'tenant-test', open_id: 'ou_test', name: '测试' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const post = await start(t, { directory, config, fetchImpl });
  const auth = await post('/api/auth/feishu', { code: 'first' });
  const cookie = auth.headers.get('set-cookie').split(';')[0];
  const controller = new AbortController();
  const pending = post('/api/resolve/employee-numbers', { numbers: ['E1001'] }, { signal: controller.signal, headers: { Cookie: cookie } });
  await directory.began;
  const blocked = await post('/api/resolve/employee-numbers', { numbers: ['E1001'] }, { headers: { Cookie: cookie } });
  assert.equal(blocked.status, 429);
  const secondAuth = await post('/api/auth/feishu', { code: 'second' });
  assert.equal(secondAuth.status, 200);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await directory.ended;
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmployeeNumbers, resolveSelection, resolveTaskAudience, MAX_SCAN, DirectoryError } from '../server/directory.js';
import { createDemoDirectory, demoContacts, demoDepartments } from '../server/demo.js';

const person = (id, number, email, extra = {}) => ({ open_id: id, name: id, employee_no: number, enterprise_email: email, ...extra });
const provider = users => ({ listAllUsers: async () => users });

test('employee numbers preserve leading zero, trim, de-duplicate and retain input order', async () => {
  const users = [person('a', '001', ' First@Example.com '), person('b', '2', 'second@example.com')];
  const result = await resolveEmployeeNumbers(provider(users), [' 2 ', '001', '2', ' ', '001']);
  assert.deepEqual(result.emails, ['second@example.com', 'First@Example.com']);
  assert.equal(result.text, 'second@example.com First@Example.com');
  assert.deepEqual(result.matched.map(user => user.employeeNo), ['2', '001']);
  assert.deepEqual(result.stats, { requested: 2, people: 2, emails: 2, issues: 0 });
  assert.match(result.scopeNote, /授权/);
});

test('never use user_id as employee_no or email as enterprise_email', async () => {
  const result = await resolveEmployeeNumbers(provider([
    person('a', '001', '', { user_id: '007', email: 'private@example.com' }),
    { open_id: 'b', user_id: '008', email: 'other@example.com' },
  ]), ['007', '008', '001']);
  assert.deepEqual(result.issues.map(issue => issue.reason), ['not_found', 'not_found', 'missing_email']);
  assert.deepEqual(result.emails, []);
  assert.equal(result.stats.people, 1);
});

test('ambiguous employee number never guesses even if only one candidate has email', async () => {
  const result = await resolveEmployeeNumbers(provider([
    person('a', '01', 'a@example.com'), person('b', '01', ''),
  ]), ['01']);
  assert.deepEqual(result.emails, []);
  assert.equal(result.issues[0].reason, 'ambiguous');
  assert.equal(result.stats.people, 0);
});

test('duplicate directory entries of one person do not become ambiguous', async () => {
  const user = person('a', '01', 'a@example.com');
  const result = await resolveEmployeeNumbers(provider([user, user]), ['01']);
  assert.equal(result.matched.length, 1);
  assert.equal(result.issues.length, 0);
});

test('emails deduplicate case-insensitively while retaining first spelling and all matched people', async () => {
  const result = await resolveEmployeeNumbers(provider([
    person('a', '1', 'Alice@Example.com'), person('b', '2', 'alice@example.COM'),
  ]), ['1', '2']);
  assert.deepEqual(result.emails, ['Alice@Example.com']);
  assert.equal(result.matched.length, 2);
  assert.equal(result.stats.people, 2);
});

test('missing, malformed and unsafe mailbox text is not output', async () => {
  const values = ['', 'bad', 'x@example', 'a@example..com', 'a..b@example.com', 'Name <a@example.com>', 'a@example.com\r\nBcc: b@example.com', 'a@-example.com'];
  const result = await resolveEmployeeNumbers(provider(values.map((email, index) => person(`u${index}`, `${index}`, email))), values.map((_, index) => `${index}`));
  assert.equal(result.emails.length, 0);
  assert.equal(result.issues[0].reason, 'missing_email');
  assert.ok(result.issues.slice(1).every(issue => issue.reason === 'invalid_email'));
  assert.equal(result.stats.people, values.length);
});

test('frozen, resigned and exited members never emit emails and are separated in task audience', async () => {
  const users = [
    person('a', '1', 'a@example.com', { status: { is_frozen: true } }),
    person('b', '2', 'b@example.com', { status: { is_resigned: true } }),
    person('c', '3', 'c@example.com', { status: { is_exited: true } }),
    person('d', '4', 'd@example.com', { is_frozen: true }),
    person('e', '5', 'e@example.com', { status: { is_activated: false } }),
  ];
  const result = await resolveEmployeeNumbers(provider(users), ['1', '2', '3', '4', '5']);
  assert.deepEqual(result.emails, ['e@example.com']);
  assert.deepEqual(result.issues.map(issue => issue.reason), ['disabled', 'resigned', 'resigned', 'disabled']);
  assert.equal(result.stats.people, 5);

  const audience = await resolveTaskAudience(provider(users), { type: 'all' });
  assert.deepEqual(audience.activeTargets.map(u => u.openId), ['e']);
  assert.equal(audience.inactiveExcluded.length, 4);
});

test('recursive selection includes department itself and descendants and deduplicates overlap', async () => {
  const a = person('a', '1', 'a@example.com');
  const b = person('b', '2', 'b@example.com');
  const c = person('c', '3', 'c@example.com');
  const calls = [];
  const directory = {
    getUser: async () => a,
    listDescendantDepartments: async id => id === 'parent' ? [{ open_department_id: 'child' }, { open_department_id: 'grandchild' }] : [{ open_department_id: 'grandchild' }],
    listDepartmentUsers: async id => { calls.push(id); return { parent: [a], child: [a, b], grandchild: [c] }[id]; },
  };
  const result = await resolveSelection(directory, { userIds: ['a', ' a '], departmentIds: ['parent', 'child'] });
  assert.deepEqual(calls, ['parent', 'child', 'grandchild']);
  assert.deepEqual(result.emails, ['a@example.com', 'b@example.com', 'c@example.com']);
  assert.deepEqual(result.stats, { requested: 3, people: 3, emails: 3, issues: 0 });
});

test('scan limits and malformed provider data fail rather than return partial results', async () => {
  const user = person('a', '1', 'a@example.com');
  await assert.rejects(resolveEmployeeNumbers(provider(Array(MAX_SCAN + 1).fill(user)), ['1']), /25000/);
  await assert.rejects(resolveSelection({ listDepartmentUsers: async () => Array(MAX_SCAN + 1).fill(user) }, { departmentIds: ['d'], includeChildren: false }), /25000/);
  await assert.rejects(resolveEmployeeNumbers(provider([{ employee_no: '1' }]), ['1']), /open_id/);
  await assert.rejects(resolveEmployeeNumbers(provider(null), ['1']), /用户数组/);
  await assert.rejects(resolveSelection({ listDescendantDepartments: async () => [{}] }, { departmentIds: ['d'] }), /open_department_id/);
});

test('demo provides product/engineering/ops hierarchy and isolated clones', async () => {
  assert.equal(demoContacts.length, 8);
  assert.deepEqual(demoDepartments.map(department => department.name), ['产品研发', '产品组', '工程组', '综合运营']);
  const directory = createDemoDirectory();
  const result = await resolveEmployeeNumbers(directory, ['E1001', 'E1002', 'E1003', 'E1004']);
  assert.equal(result.text, 'lin.xiao@example.com chen.yu@example.com xu.yan@example.com');
  assert.equal(result.stats.people, 4);
  assert.equal(result.issues[0].reason, 'missing_email');
  const selected = await resolveSelection(directory, { departmentIds: ['od-demo-rd'] });
  assert.equal(selected.stats.people, 4);
  assert.equal(selected.emails.length, 3);
  const copy = await directory.listAllUsers();
  copy[0].name = 'mutated';
  assert.equal((await directory.getUser(demoContacts[0].open_id)).name, '林晓');
});

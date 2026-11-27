import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function makeSlug() {
  return `doc-${crypto.randomBytes(5).toString('hex')}`;
}

function makeReceiptNo(isoTime) {
  const datePart = isoTime.slice(0, 10).replaceAll('-', '');
  const randPart = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `ACK-${datePart}-${randPart}`;
}

function mapTaskRow(row) {
  if (!row) return null;
  let scope = { type: row.scope_type };
  try { scope = JSON.parse(row.scope_json); } catch { /* fallback */ }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    docUrl: row.doc_url,
    fileName: row.file_name,
    fileSha256: row.file_sha256,
    version: row.version,
    scopeType: row.scope_type,
    scope,
    allowOutOfScope: Boolean(row.allow_out_of_scope),
    deadlineAt: row.deadline_at || '',
    status: row.status,
    createdByOpenId: row.created_by_open_id,
    createdByName: row.created_by_name,
    lastRemindedAt: row.last_reminded_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at || '',
  };
}

function mapProjectRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectKey: row.project_key,
    name: row.name,
    ownerOpenId: row.owner_open_id,
    ownerName: row.owner_name,
    ownerEmployeeNo: row.owner_employee_no || '',
    createdByOpenId: row.created_by_open_id || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memberCount: row.member_count === undefined ? undefined : Number(row.member_count),
  };
}

function mapProjectMemberRow(row) {
  return {
    openId: row.open_id,
    name: row.name,
    employeeNo: row.employee_no || '',
    departmentNames: row.department_names || '',
    source: row.source,
    addedAt: row.added_at,
  };
}

function mapApiTokenRow(row) {
  if (!row) return null;
  let scopes = [];
  try { scopes = JSON.parse(row.scopes_json); } catch { scopes = []; }
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: Array.isArray(scopes) ? scopes : [],
    expiresAt: row.expires_at || '',
    createdByOpenId: row.created_by_open_id || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || '',
    revokedAt: row.revoked_at || '',
  };
}

export function createStore({ dbPath = ':memory:' } = {}) {
  if (typeof dbPath !== 'string' || !dbPath.trim()) {
    throw new TypeError('dbPath 必须为非空字符串或 :memory:');
  }
  const resolved = dbPath.trim() === ':memory:' ? ':memory:' : path.resolve(dbPath.trim());
  if (resolved !== ':memory:') {
    fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(resolved);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS role_grants (
      open_id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      employee_no TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
      granted_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      doc_url TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      file_sha256 TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT 'v1.0',
      scope_type TEXT NOT NULL CHECK (scope_type IN ('all', 'selection', 'numbers')),
      scope_json TEXT NOT NULL,
      allow_out_of_scope INTEGER NOT NULL DEFAULT 0,
      deadline_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
      created_by_open_id TEXT NOT NULL,
      created_by_name TEXT NOT NULL,
      last_reminded_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS task_targets (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      open_id TEXT NOT NULL,
      name TEXT NOT NULL,
      employee_no TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      department_names TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'initial' CHECK (source IN ('initial', 'joined_after')),
      added_at TEXT NOT NULL,
      PRIMARY KEY (task_id, open_id)
    );

    CREATE TABLE IF NOT EXISTS task_acks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no TEXT NOT NULL UNIQUE,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      open_id TEXT NOT NULL,
      name TEXT NOT NULL,
      employee_no TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      department_names TEXT NOT NULL DEFAULT '',
      in_target_scope INTEGER NOT NULL DEFAULT 1,
      auth_channel TEXT NOT NULL DEFAULT 'feishu',
      confirmed_at TEXT NOT NULL,
      UNIQUE (task_id, version, open_id)
    );

    CREATE INDEX IF NOT EXISTS idx_task_acks_task_version ON task_acks(task_id, version);
    CREATE INDEX IF NOT EXISTS idx_task_acks_open_id ON task_acks(open_id);

    CREATE TABLE IF NOT EXISTS reminder_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      triggered_by TEXT NOT NULL,
      total_targets INTEGER NOT NULL,
      sent_count INTEGER NOT NULL,
      failed_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      owner_open_id TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      owner_employee_no TEXT NOT NULL DEFAULT '',
      created_by_open_id TEXT NOT NULL DEFAULT '',
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      open_id TEXT NOT NULL,
      name TEXT NOT NULL,
      employee_no TEXT NOT NULL DEFAULT '',
      department_names TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'project' CHECK (source IN ('project', 'department', 'numbers')),
      added_at TEXT NOT NULL,
      PRIMARY KEY (project_id, open_id)
    );

    CREATE INDEX IF NOT EXISTS idx_project_members_open_id ON project_members(open_id);

    CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scopes_json TEXT NOT NULL,
      expires_at TEXT NOT NULL DEFAULT '',
      created_by_open_id TEXT NOT NULL DEFAULT '',
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL DEFAULT '',
      revoked_at TEXT NOT NULL DEFAULT ''
    );
  `);

  const stmts = {
    countGrants: db.prepare('SELECT COUNT(*) AS count FROM role_grants'),
    listGrants: db.prepare('SELECT open_id, name, employee_no, role, granted_by, created_at FROM role_grants ORDER BY created_at ASC'),
    getGrant: db.prepare('SELECT open_id, name, employee_no, role FROM role_grants WHERE open_id = ?'),
    upsertGrant: db.prepare(`
      INSERT INTO role_grants (open_id, name, employee_no, role, granted_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(open_id) DO UPDATE SET
        name = excluded.name,
        employee_no = excluded.employee_no,
        role = excluded.role,
        granted_by = excluded.granted_by
    `),
    deleteGrant: db.prepare('DELETE FROM role_grants WHERE open_id = ?'),

    countTasks: db.prepare('SELECT COUNT(*) AS count FROM tasks'),
    insertTask: db.prepare(`
      INSERT INTO tasks (
        slug, title, summary, doc_url, file_name, file_sha256, version,
        scope_type, scope_json, allow_out_of_scope, deadline_at, status,
        created_by_open_id, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `),
    insertTarget: db.prepare(`
      INSERT OR IGNORE INTO task_targets (
        task_id, open_id, name, employee_no, email, department_names, source, added_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listTasks: db.prepare(`
      SELECT
        t.*,
        (SELECT COUNT(*) FROM task_targets tt WHERE tt.task_id = t.id) AS snapshot_count,
        (SELECT COUNT(*) FROM task_acks ta
          WHERE ta.task_id = t.id AND ta.version = t.version
            AND EXISTS (SELECT 1 FROM task_targets tt2 WHERE tt2.task_id = t.id AND tt2.open_id = ta.open_id)
        ) AS confirmed_in_scope_count,
        (SELECT COUNT(*) FROM task_acks ta WHERE ta.task_id = t.id AND ta.version = t.version) AS total_ack_count
      FROM tasks t
      ORDER BY t.id DESC
    `),
    getTaskBySlug: db.prepare('SELECT * FROM tasks WHERE slug = ?'),
    listTargets: db.prepare('SELECT * FROM task_targets WHERE task_id = ? ORDER BY employee_no ASC, name ASC'),
    getTarget: db.prepare('SELECT * FROM task_targets WHERE task_id = ? AND open_id = ?'),
    listAcksForVersion: db.prepare('SELECT * FROM task_acks WHERE task_id = ? AND version = ? ORDER BY confirmed_at DESC'),
    getAck: db.prepare('SELECT * FROM task_acks WHERE task_id = ? AND version = ? AND open_id = ?'),
    insertAck: db.prepare(`
      INSERT INTO task_acks (
        receipt_no, task_id, version, open_id, name, employee_no, email,
        department_names, in_target_scope, auth_channel, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listUserAcks: db.prepare(`
      SELECT
        ta.receipt_no, ta.version, ta.confirmed_at, ta.auth_channel,
        t.slug, t.title, t.file_name, t.doc_url, t.status
      FROM task_acks ta
      JOIN tasks t ON t.id = ta.task_id
      WHERE ta.open_id = ?
      ORDER BY ta.confirmed_at DESC
    `),
    updateTaskStatus: db.prepare('UPDATE tasks SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?'),
    deleteTask: db.prepare('DELETE FROM tasks WHERE id = ?'),
    updateTaskVersion: db.prepare('UPDATE tasks SET version = ?, summary = ?, file_name = ?, file_sha256 = ?, doc_url = ?, updated_at = ? WHERE id = ?'),
    updateRemindedAt: db.prepare('UPDATE tasks SET last_reminded_at = ?, updated_at = ? WHERE id = ?'),
    insertReminderLog: db.prepare(`
      INSERT INTO reminder_logs (task_id, triggered_by, total_targets, sent_count, failed_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    listReminderLogs: db.prepare('SELECT * FROM reminder_logs WHERE task_id = ? ORDER BY id DESC LIMIT 10'),

    countProjects: db.prepare('SELECT COUNT(*) AS count FROM projects'),
    insertProject: db.prepare(`
      INSERT INTO projects (
        project_key, name, owner_open_id, owner_name, owner_employee_no,
        created_by_open_id, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateProject: db.prepare(`
      UPDATE projects SET name = ?, owner_open_id = ?, owner_name = ?, owner_employee_no = ?, updated_at = ?
      WHERE id = ?
    `),
    deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),
    getProject: db.prepare('SELECT * FROM projects WHERE id = ?'),
    getProjectByKey: db.prepare('SELECT * FROM projects WHERE project_key = ?'),
    listProjects: db.prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS member_count
      FROM projects p
      ORDER BY p.updated_at DESC, p.id DESC
    `),
    insertProjectMember: db.prepare(`
      INSERT OR REPLACE INTO project_members (
        project_id, open_id, name, employee_no, department_names, source, added_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    deleteProjectMember: db.prepare('DELETE FROM project_members WHERE project_id = ? AND open_id = ?'),
    listProjectMembers: db.prepare('SELECT * FROM project_members WHERE project_id = ? ORDER BY employee_no ASC, name ASC'),
    clearProjectMembers: db.prepare('DELETE FROM project_members WHERE project_id = ?'),

    insertApiToken: db.prepare(`
      INSERT INTO api_tokens (name, prefix, token_hash, scopes_json, expires_at, created_by_open_id, created_by_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listApiTokens: db.prepare('SELECT * FROM api_tokens ORDER BY id DESC'),
    getApiTokenByHash: db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?'),
    revokeApiToken: db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ?'),
    deleteApiToken: db.prepare('DELETE FROM api_tokens WHERE id = ?'),
    touchApiToken: db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?'),
  };

  function withTransaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = work();
      db.exec('COMMIT');
      return out;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    }
  }

  return {
    dbPath: resolved,
    close() {
      db.close();
    },

    hasAnyGrants() {
      return Number(stmts.countGrants.get().count) > 0;
    },

    listGrants() {
      return stmts.listGrants.all().map(row => ({
        openId: row.open_id,
        name: row.name,
        employeeNo: row.employee_no,
        role: row.role,
        grantedBy: row.granted_by,
        createdAt: row.created_at,
      }));
    },

    getGrant(openId) {
      const row = stmts.getGrant.get(openId);
      return row ? { openId: row.open_id, name: row.name, employeeNo: row.employee_no, role: row.role } : null;
    },

    upsertGrant({ openId, name = '', employeeNo = '', role = 'operator', grantedBy = '' }) {
      const now = new Date().toISOString();
      stmts.upsertGrant.run(openId, name, employeeNo, role, grantedBy, now);
    },

    deleteGrant(openId) {
      return stmts.deleteGrant.run(openId).changes > 0;
    },

    createTask({
      slug = makeSlug(),
      title,
      summary,
      docUrl = '',
      fileName = '',
      fileSha256 = '',
      version = 'v1.0',
      scope,
      allowOutOfScope = false,
      deadlineAt = '',
      createdBy,
      targets = [],
      createdAt = new Date().toISOString(),
    }) {
      return withTransaction(() => {
        const info = stmts.insertTask.run(
          slug,
          title,
          summary,
          docUrl,
          fileName,
          fileSha256,
          version,
          scope.type,
          JSON.stringify(scope),
          allowOutOfScope ? 1 : 0,
          deadlineAt,
          createdBy.openId,
          createdBy.name || createdBy.openId,
          createdAt,
          createdAt,
        );
        const taskId = Number(info.lastInsertRowid);
        for (const target of targets) {
          stmts.insertTarget.run(
            taskId,
            target.openId,
            target.name || target.openId,
            target.employeeNo || '',
            target.email || '',
            target.departmentNames || '',
            'initial',
            createdAt,
          );
        }
        return mapTaskRow(stmts.getTaskBySlug.get(slug));
      });
    },

    listTasks() {
      return stmts.listTasks.all().map(row => ({
        ...mapTaskRow(row),
        snapshotCount: Number(row.snapshot_count),
        confirmedInScopeCount: Number(row.confirmed_in_scope_count),
        totalAckCount: Number(row.total_ack_count),
      }));
    },

    getTaskBySlug(slug) {
      return mapTaskRow(stmts.getTaskBySlug.get(slug));
    },

    listTargets(taskId) {
      return stmts.listTargets.all(taskId).map(row => ({
        openId: row.open_id,
        name: row.name,
        employeeNo: row.employee_no,
        email: row.email,
        departmentNames: row.department_names,
        source: row.source,
        addedAt: row.added_at,
      }));
    },

    isUserInTargetSnapshot(taskId, openId) {
      return Boolean(stmts.getTarget.get(taskId, openId));
    },

    includeNewJoiners(taskId, members) {
      const now = new Date().toISOString();
      return withTransaction(() => {
        let added = 0;
        for (const member of members) {
          const res = stmts.insertTarget.run(
            taskId,
            member.openId,
            member.name || member.openId,
            member.employeeNo || '',
            member.email || '',
            member.departmentNames || '',
            'joined_after',
            now,
          );
          added += Number(res.changes);
        }
        return added;
      });
    },

    listAcks(taskId, version) {
      return stmts.listAcksForVersion.all(taskId, version).map(row => ({
        receiptNo: row.receipt_no,
        version: row.version,
        openId: row.open_id,
        name: row.name,
        employeeNo: row.employee_no,
        email: row.email,
        departmentNames: row.department_names,
        inTargetScope: Boolean(row.in_target_scope),
        authChannel: row.auth_channel,
        confirmedAt: row.confirmed_at,
      }));
    },

    getAck(taskId, version, openId) {
      const row = stmts.getAck.get(taskId, version, openId);
      if (!row) return null;
      return {
        receiptNo: row.receipt_no,
        version: row.version,
        openId: row.open_id,
        name: row.name,
        employeeNo: row.employee_no,
        email: row.email,
        departmentNames: row.department_names,
        inTargetScope: Boolean(row.in_target_scope),
        authChannel: row.auth_channel,
        confirmedAt: row.confirmed_at,
      };
    },

    confirmTask({ taskId, version, user, inTargetScope = true, authChannel = 'feishu', confirmedAt = new Date().toISOString() }) {
      return withTransaction(() => {
        const existing = stmts.getAck.get(taskId, version, user.openId);
        if (existing) {
          return {
            alreadyConfirmed: true,
            ack: {
              receiptNo: existing.receipt_no,
              version: existing.version,
              openId: existing.open_id,
              name: existing.name,
              employeeNo: existing.employee_no,
              email: existing.email,
              departmentNames: existing.department_names,
              inTargetScope: Boolean(existing.in_target_scope),
              authChannel: existing.auth_channel,
              confirmedAt: existing.confirmed_at,
            },
          };
        }
        const receiptNo = makeReceiptNo(confirmedAt);
        stmts.insertAck.run(
          receiptNo,
          taskId,
          version,
          user.openId,
          user.name || user.openId,
          user.employeeNo || '',
          user.email || '',
          user.departmentNames || '',
          inTargetScope ? 1 : 0,
          authChannel,
          confirmedAt,
        );
        return {
          alreadyConfirmed: false,
          ack: {
            receiptNo,
            version,
            openId: user.openId,
            name: user.name || user.openId,
            employeeNo: user.employeeNo || '',
            email: user.email || '',
            departmentNames: user.departmentNames || '',
            inTargetScope: Boolean(inTargetScope),
            authChannel,
            confirmedAt,
          },
        };
      });
    },

    listUserAcks(openId) {
      return stmts.listUserAcks.all(openId).map(row => ({
        receiptNo: row.receipt_no,
        version: row.version,
        confirmedAt: row.confirmed_at,
        authChannel: row.auth_channel,
        slug: row.slug,
        title: row.title,
        fileName: row.file_name,
        docUrl: row.doc_url,
        status: row.status,
      }));
    },

    setTaskStatus(taskId, status) {
      const now = new Date().toISOString();
      stmts.updateTaskStatus.run(status, status === 'closed' ? now : '', now, taskId);
    },

    deleteTask(taskId) {
      return withTransaction(() => Number(stmts.deleteTask.run(taskId).changes) > 0);
    },

    bumpTaskVersion(taskId, { version, summary, fileName, fileSha256, docUrl }) {
      const now = new Date().toISOString();
      stmts.updateTaskVersion.run(version, summary, fileName, fileSha256, docUrl, now, taskId);
    },

    recordReminder({ taskId, triggeredBy, totalTargets, sentCount, failedCount }) {
      const now = new Date().toISOString();
      withTransaction(() => {
        stmts.updateRemindedAt.run(now, now, taskId);
        stmts.insertReminderLog.run(taskId, triggeredBy, totalTargets, sentCount, failedCount, now);
      });
      return now;
    },

    listReminderLogs(taskId) {
      return stmts.listReminderLogs.all(taskId).map(row => ({
        id: row.id,
        triggeredBy: row.triggered_by,
        totalTargets: row.total_targets,
        sentCount: row.sent_count,
        failedCount: row.failed_count,
        createdAt: row.created_at,
      }));
    },

    // ─── 项目清单 ────────────────────────────────────────────────────────────
    listProjects() {
      return stmts.listProjects.all().map(row => mapProjectRow(row));
    },

    getProject(id) {
      return mapProjectRow(stmts.getProject.get(id));
    },

    getProjectByKey(projectKey) {
      return mapProjectRow(stmts.getProjectByKey.get(projectKey));
    },

    listProjectMembers(projectId) {
      return stmts.listProjectMembers.all(projectId).map(mapProjectMemberRow);
    },

    createProject({ projectKey, name, owner, members = [], createdBy, createdAt = new Date().toISOString() }) {
      return withTransaction(() => {
        const info = stmts.insertProject.run(
          projectKey,
          name,
          owner.openId,
          owner.name || owner.openId,
          owner.employeeNo || '',
          createdBy?.openId || '',
          createdBy?.name || createdBy?.openId || '',
          createdAt,
          createdAt,
        );
        const projectId = Number(info.lastInsertRowid);
        for (const member of members) {
          stmts.insertProjectMember.run(
            projectId,
            member.openId,
            member.name || member.openId,
            member.employeeNo || '',
            member.departmentNames || '',
            member.source || 'project',
            createdAt,
          );
        }
        return projectId;
      });
    },

    updateProject({ projectId, name, owner, members = [], updatedAt = new Date().toISOString() }) {
      return withTransaction(() => {
        const changed = Number(stmts.updateProject.run(
          name,
          owner.openId,
          owner.name || owner.openId,
          owner.employeeNo || '',
          updatedAt,
          projectId,
        ).changes);
        if (!changed) return false;
        stmts.clearProjectMembers.run(projectId);
        for (const member of members) {
          stmts.insertProjectMember.run(
            projectId,
            member.openId,
            member.name || member.openId,
            member.employeeNo || '',
            member.departmentNames || '',
            member.source || 'project',
            updatedAt,
          );
        }
        return true;
      });
    },

    deleteProject(projectId) {
      return withTransaction(() => Number(stmts.deleteProject.run(projectId).changes) > 0);
    },

    // ─── API 令牌 ────────────────────────────────────────────────────────────
    listApiTokens() {
      return stmts.listApiTokens.all().map(mapApiTokenRow);
    },

    getApiTokenByHash(tokenHash) {
      return mapApiTokenRow(stmts.getApiTokenByHash.get(tokenHash));
    },

    createApiToken({ name, prefix, tokenHash, scopes, expiresAt = '', createdBy, createdAt = new Date().toISOString() }) {
      const info = stmts.insertApiToken.run(
        name,
        prefix,
        tokenHash,
        JSON.stringify(scopes),
        expiresAt,
        createdBy?.openId || '',
        createdBy?.name || createdBy?.openId || '',
        createdAt,
      );
      return Number(info.lastInsertRowid);
    },

    revokeApiToken(tokenId, revokedAt = new Date().toISOString()) {
      return Number(stmts.revokeApiToken.run(revokedAt, tokenId).changes) > 0;
    },

    deleteApiToken(tokenId) {
      return Number(stmts.deleteApiToken.run(tokenId).changes) > 0;
    },

    touchApiToken(tokenId, usedAt = new Date().toISOString()) {
      stmts.touchApiToken.run(usedAt, tokenId);
    },

    seedDemoTaskIfEmpty() {
      if (Number(stmts.countTasks.get().count) > 0) return;
      const task = this.createTask({
        slug: 'demo-sec-2026',
        title: '《2026 年度信息安全与数据保密规范》全员知悉确认',
        summary: '请全体同事仔细阅读邮件附件或关联飞书云文档中的《2026 年度信息安全与数据保密规范》，重点关注终端设备加密、内部敏感文档外发审批及钓鱼邮件识别要求。核对无误后请以本人飞书身份点击底部确认按钮留存回执。',
        docUrl: 'https://open.feishu.cn/document/home/index',
        fileName: '2026年度信息安全与数据保密规范_v1.2.pdf',
        fileSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        version: 'v1.2',
        scope: { type: 'all' },
        allowOutOfScope: true,
        deadlineAt: '2026-11-30',
        createdBy: { openId: 'ou-demo-linxiao', name: '林晓' },
        createdAt: '2026-11-20T09:30:00.000Z',
        targets: [
          { openId: 'ou-demo-linxiao', name: '林晓', employeeNo: 'E1001', email: 'lin.xiao@example.com', departmentNames: '产品组' },
          { openId: 'ou-demo-chenyu', name: '陈予', employeeNo: 'E1002', email: 'chen.yu@example.com', departmentNames: '工程组' },
          { openId: 'ou-demo-zhouning', name: '周宁', employeeNo: 'E1003', email: '', departmentNames: '产品组' },
          { openId: 'ou-demo-xuyan', name: '许言', employeeNo: 'E1004', email: 'xu.yan@example.com', departmentNames: '工程组' },
          { openId: 'ou-demo-songzhixia', name: '宋知夏', employeeNo: 'E1005', email: 'song.zhixia@example.com', departmentNames: '综合运营' },
          { openId: 'ou-demo-guxingzhou', name: '顾行舟', employeeNo: 'E1006', email: 'gu.xingzhou@example.com', departmentNames: '综合运营' },
          { openId: 'ou-demo-zhaotingyun', name: '赵停云', employeeNo: 'E1007', email: 'zhao.tingyun@example.com', departmentNames: '综合运营' },
        ],
      });
      this.confirmTask({
        taskId: task.id,
        version: 'v1.2',
        user: { openId: 'ou-demo-linxiao', name: '林晓', employeeNo: 'E1001', email: 'lin.xiao@example.com', departmentNames: '产品组' },
        inTargetScope: true,
        authChannel: 'feishu_client',
        confirmedAt: '2026-11-20T09:42:18.000Z',
      });
      this.confirmTask({
        taskId: task.id,
        version: 'v1.2',
        user: { openId: 'ou-demo-xuyan', name: '许言', employeeNo: 'E1004', email: 'xu.yan@example.com', departmentNames: '工程组' },
        inTargetScope: true,
        authChannel: 'web_oauth',
        confirmedAt: '2026-11-21T14:15:06.000Z',
      });
      this.confirmTask({
        taskId: task.id,
        version: 'v1.2',
        user: { openId: 'ou-demo-songzhixia', name: '宋知夏', employeeNo: 'E1005', email: 'song.zhixia@example.com', departmentNames: '综合运营' },
        inTargetScope: true,
        authChannel: 'web_oauth',
        confirmedAt: '2026-11-22T10:08:51.000Z',
      });
    },
  };
}

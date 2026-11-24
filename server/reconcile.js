import { formatEmails } from './directory.js';

function mergeMemberFields(snapshot, live) {
  return {
    openId: snapshot.openId,
    name: live?.name || snapshot.name || snapshot.openId,
    employeeNo: live?.employeeNo || snapshot.employeeNo || '',
    email: live ? live.email : (snapshot.email || ''),
    emailIssue: live ? live.emailIssue : (snapshot.email ? null : 'missing_email'),
    departmentNames: live?.departmentNames || snapshot.departmentNames || '未分配部门',
    source: snapshot.source || 'initial',
  };
}

export function reconcileTask({ task, targets = [], acks = [], liveAudience = null }) {
  const ackByOpenId = new Map(acks.map(ack => [ack.openId, ack]));
  const targetById = new Map(targets.map(item => [item.openId, item]));
  const liveActiveById = new Map((liveAudience?.activeTargets || []).map(item => [item.openId, item]));
  const liveInactiveById = new Map((liveAudience?.inactiveExcluded || []).map(item => [item.openId, item]));

  const confirmed = [];
  const pending = [];
  const inactive = [];
  const joinedAfter = [];
  const outOfScopeConfirmed = [];

  for (const snapshot of targets) {
    const ack = ackByOpenId.get(snapshot.openId);
    const liveActive = liveActiveById.get(snapshot.openId);
    const liveInactive = liveInactiveById.get(snapshot.openId);
    const merged = mergeMemberFields(snapshot, liveActive || liveInactive || null);

    if (ack) {
      confirmed.push({
        ...merged,
        receiptNo: ack.receiptNo,
        confirmedAt: ack.confirmedAt,
        authChannel: ack.authChannel,
        version: ack.version,
      });
      continue;
    }

    if (liveInactive) {
      inactive.push({
        ...merged,
        inactiveReason: liveInactive.inactive === 'disabled' ? '账号已停用/冻结' : '已离职或退出企业',
      });
      continue;
    }

    pending.push(merged);
  }

  if (liveAudience) {
    for (const member of liveAudience.activeTargets) {
      if (targetById.has(member.openId)) continue;
      if (ackByOpenId.has(member.openId)) continue;
      joinedAfter.push({
        openId: member.openId,
        name: member.name,
        employeeNo: member.employeeNo,
        email: member.email,
        emailIssue: member.emailIssue,
        departmentNames: member.departmentNames || '未分配部门',
      });
    }
  }

  for (const ack of acks) {
    if (targetById.has(ack.openId)) continue;
    const live = liveActiveById.get(ack.openId) || liveInactiveById.get(ack.openId);
    outOfScopeConfirmed.push({
      openId: ack.openId,
      name: live?.name || ack.name || ack.openId,
      employeeNo: live?.employeeNo || ack.employeeNo || '',
      email: live?.email || ack.email || '',
      departmentNames: live?.departmentNames || ack.departmentNames || '范围外成员',
      receiptNo: ack.receiptNo,
      confirmedAt: ack.confirmedAt,
      authChannel: ack.authChannel,
      version: ack.version,
    });
  }

  const deptStats = new Map();
  const accumulateDept = (person, isConfirmed) => {
    const label = person.departmentNames || '未标注部门';
    const current = deptStats.get(label) || { department: label, total: 0, confirmed: 0, pending: 0 };
    current.total += 1;
    if (isConfirmed) current.confirmed += 1;
    else current.pending += 1;
    deptStats.set(label, current);
  };
  for (const item of confirmed) accumulateDept(item, true);
  for (const item of pending) accumulateDept(item, false);

  const departmentBreakdown = [...deptStats.values()]
    .map(item => ({
      ...item,
      ratePercent: item.total > 0 ? Math.round((item.confirmed / item.total) * 1000) / 10 : 100,
    }))
    .sort((a, b) => b.pending - a.pending || a.department.localeCompare(b.department, 'zh-CN'));

  const pendingFormatted = formatEmails(pending.map(item => item.email));
  const pendingMissingEmailCount = pending.filter(item => !item.email).length;
  const activeTargetCount = confirmed.length + pending.length;
  const completionPercent = activeTargetCount > 0
    ? Math.round((confirmed.length / activeTargetCount) * 1000) / 10
    : 100;

  return {
    stats: {
      snapshotTotal: targets.length,
      activeTargetCount,
      confirmedCount: confirmed.length,
      pendingCount: pending.length,
      completionPercent,
      joinedAfterCount: joinedAfter.length,
      inactiveCount: inactive.length,
      outOfScopeCount: outOfScopeConfirmed.length,
      pendingEmailCount: pendingFormatted.emails.length,
      pendingMissingEmailCount,
    },
    pendingEmails: pendingFormatted.emails,
    pendingEmailText: pendingFormatted.text,
    confirmed,
    pending,
    joinedAfter,
    inactive,
    outOfScopeConfirmed,
    departmentBreakdown,
    scopeNote: liveAudience?.scopeNote || '',
  };
}

function escapeCsvCell(value) {
  const raw = String(value ?? '').replace(/\r?\n/g, ' ');
  // Guard against spreadsheet formula execution when opened in Excel/WPS.
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

export function buildReconcileCsv(task, report) {
  const headers = ['状态', '姓名', '工号', '部门', '企业邮箱', '确认版本', '确认时间', '回执编号', '认证方式', '备注'];
  const rows = [];

  for (const item of report.confirmed) {
    rows.push(['已确认', item.name, item.employeeNo, item.departmentNames, item.email, item.version, item.confirmedAt, item.receiptNo, item.authChannel === 'web_oauth' ? '网页飞书登录' : '飞书客户端免登', '']);
  }
  for (const item of report.pending) {
    rows.push(['待确认', item.name, item.employeeNo, item.departmentNames, item.email, task.version, '', '', '', item.email ? '' : '缺少企业邮箱']);
  }
  for (const item of report.joinedAfter) {
    rows.push(['期间新入职', item.name, item.employeeNo, item.departmentNames, item.email, task.version, '', '', '', '任务发布后新入职/转入，尚未纳入快照']);
  }
  for (const item of report.inactive) {
    rows.push(['已剔除(离职/停用)', item.name, item.employeeNo, item.departmentNames, item.email, task.version, '', '', '', item.inactiveReason]);
  }
  for (const item of report.outOfScopeConfirmed) {
    rows.push(['范围外已确认', item.name, item.employeeNo, item.departmentNames, item.email, item.version, item.confirmedAt, item.receiptNo, item.authChannel === 'web_oauth' ? '网页飞书登录' : '飞书客户端免登', '不在原定受众快照内']);
  }

  const lines = [headers, ...rows].map(row => row.map(escapeCsvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

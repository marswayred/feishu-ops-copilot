import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  FilePlus2,
  FileText,
  FolderTree,
  LoaderCircle,
  Lock,
  Mail,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Unlock,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { api, chooseFeishuContacts, copyTextWithFallback } from '../feishu.js';
import { DemoPicker, navigateTabs } from '../components/DemoPicker.jsx';
import { parseNumbers } from './MailView.jsx';

const Icon = ({ icon: Component, ...props }) => <Component size={18} strokeWidth={1.8} aria-hidden="true" {...props} />;

function formatDateTime(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function buildEmailTemplate(task) {
  const lines = [
    `各位同事好：`,
    ``,
    `现正式下发《${task.title}》（版本：${task.version}），请仔细阅读邮件正文或附件内容${task.docUrl ? `（在线文档：${task.docUrl}）` : ''}。`,
    task.deadlineAt ? `确认截止日期：${task.deadlineAt}` : null,
    ``,
    `阅读完毕后，请点击下方专属链接通过飞书实名确认已读：`,
    task.ackUrl,
  ].filter(line => line !== null);
  return lines.join('\n');
}

function scopeLabel(scopeType) {
  if (scopeType === 'all') return '通讯录全员';
  if (scopeType === 'selection') return '指定成员或部门';
  if (scopeType === 'numbers') return '按工号批量导入';
  return scopeType;
}

export function TasksView({
  bootstrap,
  ready,
  mode = 'list',
  activeSlug,
  draftAudience,
  onClearDraftAudience,
  onNavigate,
  onAuthError,
}) {
  const demo = bootstrap?.mode === 'demo';
  const [tasks, setTasks] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');

  // Create form state
  const [title, setTitle] = useState('');
  const [version, setVersion] = useState('v1.0');
  const [deadlineAt, setDeadlineAt] = useState('');
  const [summary, setSummary] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [scopeMode, setScopeMode] = useState('all');
  const [numbersText, setNumbersText] = useState('');
  const [selected, setSelected] = useState({ users: [], departments: [] });
  const [includeChildren, setIncludeChildren] = useState(true);
  const [allowOutOfScope, setAllowOutOfScope] = useState(false);
  const [picker, setPicker] = useState(false);
  const [picking, setPicking] = useState(false);

  // Detail state
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [ledgerTab, setLedgerTab] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState('');
  const [copyFallbackMsg, setCopyFallbackMsg] = useState('');
  const [reminding, setReminding] = useState(false);
  const [includingJoiners, setIncludingJoiners] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [deletingSlug, setDeletingSlug] = useState('');
  const [showBumpForm, setShowBumpForm] = useState(false);
  const [nextVersion, setNextVersion] = useState('');
  const [nextSummary, setNextSummary] = useState('');
  const [nextSha256, setNextSha256] = useState('');
  const [bumping, setBumping] = useState(false);

  const unreadEmailRef = useRef(null);
  const copyTimer = useRef(null);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  useEffect(() => {
    if (draftAudience) {
      setScopeMode(draftAudience.scopeMode || 'all');
      setNumbersText(draftAudience.numbersText || '');
      setSelected(draftAudience.selected || { users: [], departments: [] });
      setIncludeChildren(draftAudience.includeChildren !== false);
      onClearDraftAudience?.();
    }
  }, [draftAudience, onClearDraftAudience]);

  function fail(err) {
    setError(err.message);
    if (err.status === 401) onAuthError?.();
  }

  async function fetchTaskList() {
    if (!ready) return;
    setLoadingList(true);
    setError('');
    try {
      const data = await api('/api/ops/tasks');
      setTasks(data.tasks || []);
    } catch (err) {
      fail(err);
    } finally {
      setLoadingList(false);
    }
  }

  async function fetchTaskDetail(slug) {
    if (!ready || !slug) return;
    setLoadingDetail(true);
    setError('');
    try {
      const data = await api(`/api/ops/tasks/${encodeURIComponent(slug)}`);
      setDetail(data);
    } catch (err) {
      fail(err);
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (!ready) return;
    if (mode === 'detail' && activeSlug) {
      fetchTaskDetail(activeSlug);
    } else if (mode === 'new') {
      setDetail(null);
      setError('');
      setBanner('');
    } else {
      setDetail(null);
      fetchTaskList();
    }
  }, [ready, mode, activeSlug]);

  async function triggerCopy(key, text, ref) {
    setCopyFallbackMsg('');
    const outcome = await copyTextWithFallback(text, ref);
    if (outcome.ok) {
      setCopiedKey(key);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedKey(''), 2400);
    } else {
      setCopyFallbackMsg(outcome.message);
    }
  }

  async function chooseScopeContacts() {
    if (demo) return setPicker(true);
    setPicking(true);
    setError('');
    try {
      const next = await chooseFeishuContacts(selected.users);
      if (next) {
        const departments = [...new Map([...selected.departments, ...next.departments].map(item => [item.id, item])).values()];
        setSelected({ users: [...new Map(next.users.map(item => [item.id, item])).values()], departments });
      }
    } catch (err) {
      fail(err);
    } finally {
      setPicking(false);
    }
  }

  function fillDemoTaskTemplate() {
    setTitle('《2026 第四季度差旅报销与合规审批调整通知》确认');
    setVersion('v1.0');
    setDeadlineAt('2026-12-05');
    setSummary('请仔细阅读随信附带的《第四季度差旅报销标准修订说明》，确认知悉住宿标准调整、机票提前预订要求及电子发票归档规范。');
    setDocUrl('https://open.feishu.cn/document/home/index');
  }

  async function handleCreateTask(event) {
    event.preventDefault();
    if (creating || !ready) return;
    setError('');
    setBanner('');

    let scope;
    if (scopeMode === 'all') {
      scope = { type: 'all' };
    } else if (scopeMode === 'numbers') {
      const numbers = parseNumbers(numbersText);
      if (!numbers.length) {
        setError('请至少输入一个员工工号。');
        return;
      }
      scope = { type: 'numbers', numbers };
    } else {
      if (!selected.users.length && !selected.departments.length) {
        setError('请至少选择一位成员或一个部门。');
        return;
      }
      scope = {
        type: 'selection',
        userIds: selected.users.map(u => u.id),
        departmentIds: selected.departments.map(d => d.id),
        includeChildren,
        departmentLabels: selected.departments,
        userLabels: selected.users,
      };
    }

    setCreating(true);
    try {
      const res = await api('/api/ops/tasks', {
        title,
        version,
        deadlineAt,
        summary,
        docUrl,
        allowOutOfScope,
        scope,
      });
      setTitle('');
      setSummary('');
      setDocUrl('');
      setDeadlineAt('');
      setBanner('任务已创建。');
      onNavigate(`/ops/tasks/${res.task.slug}`);
    } catch (err) {
      fail(err);
    } finally {
      setCreating(false);
    }
  }

  async function handleSendReminders() {
    if (!detail || reminding) return;
    setReminding(true);
    setError('');
    setBanner('');
    try {
      const res = await api(`/api/ops/tasks/${encodeURIComponent(detail.task.slug)}/remind`, {});
      const { sentCount, failedCount, simulated, failures } = res.delivery;
      const reason = [...new Set((failures || []).map(item => item.message).filter(Boolean))].join(' ');
      if (!simulated && sentCount === 0 && failedCount > 0) {
        setError(reason || `飞书催办卡片未送达，失败 ${failedCount} 人。`);
        await fetchTaskDetail(detail.task.slug);
        return;
      }
      setBanner(
        `${simulated ? '【演示模拟】' : ''}已向待确认在职人员发送飞书催办卡片：成功 ${sentCount} 人${failedCount ? `，失败 ${failedCount} 人` : ''}。${reason && failedCount ? reason : ''}`,
      );
      await fetchTaskDetail(detail.task.slug);
    } catch (err) {
      fail(err);
    } finally {
      setReminding(false);
    }
  }

  async function handleIncludeJoiners() {
    if (!detail || includingJoiners) return;
    setIncludingJoiners(true);
    setError('');
    try {
      const res = await api(`/api/ops/tasks/${encodeURIComponent(detail.task.slug)}/include-joiners`, {});
      setDetail(prev => ({ ...prev, task: res.task, report: res.report }));
      setBanner(`已将 ${res.addedCount} 位期间新入职成员纳入本次应确认名单快照。`);
      setLedgerTab('pending');
    } catch (err) {
      fail(err);
    } finally {
      setIncludingJoiners(false);
    }
  }

  async function handleDeleteTask(item) {
    if (!item?.slug || deletingSlug) return;
    const itemTitle = item.title || '这条任务';
    if (!window.confirm(`删除「${itemTitle}」？签收记录会一并删除，且无法恢复。`)) return;
    setDeletingSlug(item.slug);
    setError('');
    try {
      await api(`/api/ops/tasks/${encodeURIComponent(item.slug)}`, undefined, { method: 'DELETE' });
      setTasks(current => current.filter(task => task.slug !== item.slug));
      setDetail(current => current?.task?.slug === item.slug ? null : current);
      setBanner('任务已删除。');
      if (activeSlug === item.slug) onNavigate('/ops/tasks');
    } catch (err) {
      fail(err);
    } finally {
      setDeletingSlug('');
    }
  }

  async function handleToggleStatus() {
    if (!detail || togglingStatus) return;
    const nextStatus = detail.task.status === 'active' ? 'closed' : 'active';
    setTogglingStatus(true);
    setError('');
    try {
      const res = await api(`/api/ops/tasks/${encodeURIComponent(detail.task.slug)}/status`, { status: nextStatus });
      setDetail(prev => ({ ...prev, task: res.task, report: res.report }));
      setBanner(nextStatus === 'closed' ? '任务已截止归档，快照已锁定供审计留存。' : '任务已重新开放收集确认。');
    } catch (err) {
      fail(err);
    } finally {
      setTogglingStatus(false);
    }
  }

  async function handleBumpVersion(event) {
    event.preventDefault();
    if (!detail || bumping) return;
    setBumping(true);
    setError('');
    try {
      const res = await api(`/api/ops/tasks/${encodeURIComponent(detail.task.slug)}/version`, {
        version: nextVersion,
        summary: nextSummary,
        fileName: detail.task.fileName,
        fileSha256: nextSha256,
      });
      setDetail(prev => ({ ...prev, task: res.task, report: res.report }));
      setShowBumpForm(false);
      setLedgerTab('pending');
      setBanner(`已升级至新版本 ${res.task.version}，原版本历史回执已保留归档，现重新统计新版确认进度。`);
    } catch (err) {
      fail(err);
    } finally {
      setBumping(false);
    }
  }

  // ─── 详情对账视图 ────────────────────────────────────────────────────────────
  if (mode === 'detail' && activeSlug) {
    const task = detail?.task;
    const report = detail?.report;
    const stats = report?.stats;
    const q = searchQuery.trim().toLocaleLowerCase();
    const filterPeople = list => (list || []).filter(item =>
      `${item.name} ${item.employeeNo} ${item.email} ${item.departmentNames}`.toLocaleLowerCase().includes(q),
    );

    const beamTotal = stats ? Math.max(1, stats.activeTargetCount) : 1;
    const beamGap = stats && stats.confirmedCount > 0 && stats.pendingCount > 0 ? 6 : 0;
    const confirmedW = stats
      ? Math.round(((1000 - beamGap) * stats.confirmedCount) / beamTotal)
      : 0;
    const pendingW = stats
      ? Math.max(0, 1000 - beamGap - confirmedW) * (stats.pendingCount > 0 ? 1 : 0)
      : 0;

    return (
      <>
        <div className="detail-Backbar">
          <button type="button" className="text-button back-link" onClick={() => { setBanner(''); onNavigate('/ops/tasks'); }}>
            <Icon icon={ArrowLeft} size={15} />
            返回分发任务列表
          </button>
          {task && (
            <div className="detail-top-actions">
              <button
                type="button"
                className="button ghost-button"
                onClick={() => onNavigate(task.ackPath)}
              >
                <Icon icon={ExternalLink} size={15} />
                预览员工确认页
              </button>
              <a
                className="button ghost-button link-button"
                href={`/api/ops/tasks/${encodeURIComponent(task.slug)}/export.csv`}
              >
                <Icon icon={Download} size={15} />
                导出 CSV 台账
              </a>
              <button
                type="button"
                className="button ghost-button"
                disabled={loadingDetail}
                onClick={() => fetchTaskDetail(task.slug)}
              >
                <Icon icon={RefreshCw} size={15} className={loadingDetail ? 'spin' : ''} />
                刷新对账
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="notice error-notice" role="alert">
            <Icon icon={CircleAlert} />
            <span>{error}</span>
            <button type="button" className="icon-button" onClick={() => setError('')} aria-label="关闭错误提示">
              <Icon icon={X} size={16} />
            </button>
          </div>
        )}

        {banner && (
          <div className="notice success-notice" role="status">
            <Icon icon={CheckCheck} />
            <span>{banner}</span>
            <button type="button" className="icon-button" onClick={() => setBanner('')} aria-label="关闭提示">
              <Icon icon={X} size={16} />
            </button>
          </div>
        )}

        {loadingDetail && !detail ? (
          <div className="surface-box optical-surface loading-box">
            <Icon icon={LoaderCircle} size={26} className="spin" />
            <span>正在加载任务与实时通讯录对账结果…</span>
          </div>
        ) : task && report ? (
          <>
            <section
              className="beam-panel"
              aria-label="实时通讯录对账分束总览"
            >
              <div className="beam-metrics beam-metrics--five" role="status">
                <div className="beam-node">
                  <span className="beam-node-value">{stats.activeTargetCount}</span>
                  <span className="beam-node-label">应确认在职基准</span>
                </div>
                <button
                  type="button"
                  className={`beam-node ${ledgerTab === 'confirmed' ? 'beam-node--active' : ''}`}
                  onClick={() => setLedgerTab('confirmed')}
                >
                  <span className="beam-node-value beam-node-value--emerald">
                    {stats.confirmedCount} · {stats.completionPercent}%
                  </span>
                  <span className="beam-node-label">已实名确认</span>
                </button>
                <button
                  type="button"
                  className={`beam-node ${ledgerTab === 'pending' ? 'beam-node--active' : ''}`}
                  onClick={() => setLedgerTab('pending')}
                >
                  <span className={`beam-node-value ${stats.pendingCount > 0 ? 'beam-node-value--amber' : ''}`}>
                    {stats.pendingCount}
                  </span>
                  <span className="beam-node-label">在职待确认</span>
                </button>
                <button
                  type="button"
                  className={`beam-node ${ledgerTab === 'joined' ? 'beam-node--active' : ''}`}
                  onClick={() => setLedgerTab('joined')}
                >
                  <span className={`beam-node-value ${stats.joinedAfterCount > 0 ? 'beam-node-value--cobalt' : ''}`}>
                    {stats.joinedAfterCount}
                  </span>
                  <span className="beam-node-label">期间新入职</span>
                </button>
                <button
                  type="button"
                  className={`beam-node ${ledgerTab === 'excluded' ? 'beam-node--active' : ''}`}
                  onClick={() => setLedgerTab('excluded')}
                >
                  <span className="beam-node-value">{stats.inactiveCount + stats.outOfScopeCount}</span>
                  <span className="beam-node-label">离职剔除 / 范围外</span>
                </button>
              </div>
              <div className="beam-track" aria-hidden="true">
                <svg className="beam-svg" viewBox="0 0 1000 6" preserveAspectRatio="none">
                  <rect className="beam-seg-emerald" x="0" y="0" width={confirmedW} height="6" />
                  <rect className="beam-seg-amber" x={confirmedW + beamGap} y="0" width={pendingW} height="6" />
                </svg>
                <div className="beam-scale">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
            </section>

            <div
              className={`surface-box optical-surface ${
                stats.pendingCount === 0 && stats.activeTargetCount > 0 ? 'optical-surface--emerald' : ''
              } task-detail-surface`}
            >
              <div className="task-detail-header">
                <div>
                  <div className="task-title-row">
                    <h1>{task.title}</h1>
                    <span className="badge version-badge">{task.version}</span>
                    <span className={`badge ${task.status === 'active' ? 'status-active' : 'status-closed'}`}>
                      {task.status === 'active' ? '收集中' : '已截止归档'}
                    </span>
                  </div>
                  <p className="task-meta-line">
                    范围：{scopeLabel(task.scopeType)}
                    {task.deadlineAt ? ` · 截止日期：${task.deadlineAt}` : ''}
                    {` · 创建人：${task.createdByName}`}
                  </p>
                </div>
                <div className="task-lifecycle-actions">
                  {task.status === 'active' && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        setShowBumpForm(v => !v);
                        setNextVersion('');
                        setNextSummary(task.summary);
                        setNextSha256(task.fileSha256);
                      }}
                    >
                      发布新版重签
                    </button>
                  )}
                  <button
                    type="button"
                    className="button secondary"
                    disabled={togglingStatus}
                    onClick={handleToggleStatus}
                  >
                    <Icon icon={task.status === 'active' ? Lock : Unlock} size={15} />
                    {task.status === 'active' ? '截止归档' : '重新开放'}
                  </button>
                  <button
                    type="button"
                    className="button danger-button"
                    disabled={deletingSlug === task.slug}
                    onClick={() => handleDeleteTask(task)}
                  >
                    <Icon icon={Trash2} size={15} />
                    {deletingSlug === task.slug ? '正在删除…' : '删除'}
                  </button>
                </div>
              </div>

              {showBumpForm && (
                <form className="inline-subform" onSubmit={handleBumpVersion}>
                  <div className="section-heading">
                    <h2>升级文件版本并重新发起确认</h2>
                    <button type="button" className="text-button" onClick={() => setShowBumpForm(false)}>取消</button>
                  </div>
                  <div className="form-field">
                    <label className="form-label" htmlFor="bump-version">新版本号</label>
                    <input
                      id="bump-version"
                      className="text-input"
                      required
                      placeholder="例如 v2.0"
                      value={nextVersion}
                      onChange={e => setNextVersion(e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label" htmlFor="bump-summary">新版必读说明</label>
                    <textarea
                      id="bump-summary"
                      rows={3}
                      value={nextSummary}
                      onChange={e => setNextSummary(e.target.value)}
                    />
                  </div>
                  <div className="form-actions-right">
                    <button type="submit" className="button primary" disabled={bumping || !nextVersion.trim()}>
                      {bumping ? '正在发布…' : '确认发布新版本'}
                    </button>
                  </div>
                </form>
              )}

              <div className="link-bar">
                <div className="link-bar-main">
                  <span className="link-bar-label">员工邮件确认链接</span>
                  <code className="ack-url-code">{task.ackUrl}</code>
                </div>
                <div className="link-bar-buttons">
                  <button
                    type="button"
                    className={`button ${copiedKey === 'url' ? 'success-button' : 'secondary'}`}
                    onClick={() => triggerCopy('url', task.ackUrl)}
                  >
                    <Icon icon={copiedKey === 'url' ? Check : Copy} size={15} />
                    {copiedKey === 'url' ? '已复制链接' : '复制确认链接'}
                  </button>
                  <button
                    type="button"
                    className={`button ${copiedKey === 'tpl' ? 'success-button' : 'secondary'}`}
                    onClick={() => triggerCopy('tpl', buildEmailTemplate(task))}
                  >
                    <Icon icon={copiedKey === 'tpl' ? Check : Mail} size={15} />
                    {copiedKey === 'tpl' ? '已复制邮件正文' : '复制邮件通知文案'}
                  </button>
                </div>
              </div>

              {stats.pendingCount > 0 && (
                <div className="remind-grid">
                  <div className="remind-column">
                    <div className="field-heading">
                      <label htmlFor="pending-emails-box">
                        待确认在职人员邮箱集合（{stats.pendingEmailCount} 个可复制）
                      </label>
                      {stats.pendingMissingEmailCount > 0 && (
                        <span className="warn-inline">
                          另有 {stats.pendingMissingEmailCount} 人缺企业邮箱
                        </span>
                      )}
                    </div>
                    <textarea
                      id="pending-emails-box"
                      ref={unreadEmailRef}
                      className="compact-email-output"
                      readOnly
                      value={report.pendingEmailText}
                      placeholder="待确认成员均未配置企业邮箱，请使用右侧飞书卡片催办。"
                      spellCheck={false}
                    />
                    <div className="copy-row">
                      <span>空格分隔 · 自动去重</span>
                      <button
                        type="button"
                        className={`button ${copiedKey === 'pending-emails' ? 'success-button' : 'secondary'}`}
                        disabled={!report.pendingEmails.length}
                        onClick={() => triggerCopy('pending-emails', report.pendingEmailText, unreadEmailRef)}
                      >
                        <Icon icon={copiedKey === 'pending-emails' ? Check : Copy} size={15} />
                        {copiedKey === 'pending-emails' ? '已复制未确认邮箱' : `复制未确认邮箱 (${stats.pendingEmailCount})`}
                      </button>
                    </div>
                  </div>

                  <div className="remind-column remind-bot-column">
                    <div className="field-heading">
                      <label>飞书机器人定向卡片催办</label>
                      {task.lastRemindedAt && (
                        <span className="muted-inline">上次推送：{formatDateTime(task.lastRemindedAt)}</span>
                      )}
                    </div>
                    <p className="bot-desc">
                      直接通过飞书应用机器人向待确认的在职成员定向推送交互式签收卡片（内置防重复冷却保护）。
                    </p>
                    <div className="bot-action-row">
                      <button
                        type="button"
                        className="button primary"
                        disabled={reminding || task.status !== 'active'}
                        onClick={handleSendReminders}
                      >
                        <Icon icon={reminding ? LoaderCircle : Send} size={15} className={reminding ? 'spin' : ''} />
                        {reminding ? '正在推送催办卡片…' : `发送飞书催办卡片 (${stats.pendingCount} 人)`}
                      </button>
                    </div>
                    {detail.reminderLogs?.length > 0 && (
                      <div className="reminder-log-line">
                        最近记录：{formatDateTime(detail.reminderLogs[0].createdAt)} 由 {detail.reminderLogs[0].triggeredBy} 触发，送达 {detail.reminderLogs[0].sentCount}/{detail.reminderLogs[0].totalTargets} 人
                      </div>
                    )}
                  </div>
                </div>
              )}

              {copyFallbackMsg && <p className="copy-error" role="alert">{copyFallbackMsg}</p>}

              <div className="ledger-toolbar">
                <div className="detail-tabs ledger-tabs" role="tablist" onKeyDown={navigateTabs} aria-label="通讯录对账分组">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={ledgerTab === 'pending'}
                    onClick={() => setLedgerTab('pending')}
                  >
                    待确认 <span>{stats.pendingCount}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={ledgerTab === 'confirmed'}
                    onClick={() => setLedgerTab('confirmed')}
                  >
                    已确认 <span>{stats.confirmedCount}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={ledgerTab === 'departments'}
                    onClick={() => setLedgerTab('departments')}
                  >
                    部门进度 <span>{report.departmentBreakdown.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={ledgerTab === 'joined'}
                    onClick={() => setLedgerTab('joined')}
                  >
                    期间新入职 <span>{stats.joinedAfterCount}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={ledgerTab === 'excluded'}
                    onClick={() => setLedgerTab('excluded')}
                  >
                    已剔除 / 范围外 <span>{stats.inactiveCount + stats.outOfScopeCount}</span>
                  </button>
                </div>
                {ledgerTab !== 'departments' && (
                  <div className="ledger-toolbar-right">
                    <div className="ledger-search">
                      <Icon icon={Search} size={15} />
                      <input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="筛选姓名、工号或部门"
                        aria-label="筛选对账人员名单"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="ledger-body">
                {ledgerTab === 'pending' && (
                  filterPeople(report.pending).length ? (
                    <div className="ledger-table-wrap">
                      <table className="ledger-table">
                        <thead>
                          <tr>
                            <th>姓名</th>
                            <th>工号</th>
                            <th>部门</th>
                            <th>企业邮箱</th>
                            <th>状态说明</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filterPeople(report.pending).map(person => (
                            <tr key={person.openId}>
                              <td><strong>{person.name}</strong></td>
                              <td><code>{person.employeeNo || '-'}</code></td>
                              <td>{person.departmentNames}</td>
                              <td>
                                {person.email ? (
                                  <code>{person.email}</code>
                                ) : (
                                  <span className="warn-inline">未配置企业邮箱</span>
                                )}
                              </td>
                              <td>
                                <span className="status-pill pending-text">
                                  {person.source === 'joined_after' ? '新入职补纳入 · 待确认' : '在职待确认'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="details-clear">
                      <Icon icon={CheckCheck} />
                      <span>{searchQuery ? '没有匹配的待确认成员' : '当前目标范围内所有在职成员均已完成确认'}</span>
                    </div>
                  )
                )}

                {ledgerTab === 'confirmed' && (
                  filterPeople(report.confirmed).length ? (
                    <div className="ledger-table-wrap">
                      <table className="ledger-table">
                        <thead>
                          <tr>
                            <th>姓名</th>
                            <th>工号</th>
                            <th>部门</th>
                            <th>确认时间</th>
                            <th>认证方式</th>
                            <th>回执编号</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filterPeople(report.confirmed).map(person => (
                            <tr key={person.openId}>
                              <td><strong>{person.name}</strong></td>
                              <td><code>{person.employeeNo || '-'}</code></td>
                              <td>{person.departmentNames}</td>
                              <td className="tabular">{formatDateTime(person.confirmedAt)}</td>
                              <td>
                                {person.authChannel === 'web_oauth'
                                  ? '邮件外链 · 飞书网页授权'
                                  : person.authChannel === 'demo'
                                    ? '演示环境实名确认'
                                    : '飞书客户端免登'}
                              </td>
                              <td><code>{person.receiptNo}</code></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="no-matches">尚无已确认记录。</p>
                  )
                )}

                {ledgerTab === 'departments' && (
                  report.departmentBreakdown.length ? (
                    <div className="ledger-table-wrap">
                      <table className="ledger-table">
                        <thead>
                          <tr>
                            <th>部门</th>
                            <th>应确认在职</th>
                            <th>已确认</th>
                            <th>待确认</th>
                            <th>部门完成率</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.departmentBreakdown.map(dept => (
                            <tr key={dept.department}>
                              <td><strong>{dept.department}</strong></td>
                              <td className="tabular">{dept.total} 人</td>
                              <td className="tabular">{dept.confirmed} 人</td>
                              <td className="tabular">{dept.pending} 人</td>
                              <td className="tabular">
                                <div className="dept-progress-cell">
                                  <svg className="dept-meter-svg" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
                                    <rect
                                      className="beam-seg-emerald"
                                      x="0"
                                      y="0"
                                      width={Math.max(0, Math.min(100, dept.ratePercent))}
                                      height="6"
                                    />
                                  </svg>
                                  <strong>{dept.ratePercent}%</strong>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="no-matches">暂无部门维度统计数据。</p>
                  )
                )}

                {ledgerTab === 'joined' && (
                  report.joinedAfter.length ? (
                    <>
                      <div className="joiner-callout">
                        <span>
                          以下 <strong>{report.joinedAfter.length}</strong> 位在职成员在任务创建时尚未在快照内（属于发布后新入职或转入目标部门），默认未计入原分母。你可将其纳入本次任务并补发通知：
                        </span>
                        {task.status === 'active' && (
                          <button
                            type="button"
                            className="button primary"
                            disabled={includingJoiners}
                            onClick={handleIncludeJoiners}
                          >
                            <Icon icon={includingJoiners ? LoaderCircle : UserPlus} size={15} className={includingJoiners ? 'spin' : ''} />
                            全部纳入本次任务快照
                          </button>
                        )}
                      </div>
                      <div className="ledger-table-wrap">
                        <table className="ledger-table">
                          <thead>
                            <tr>
                              <th>姓名</th>
                              <th>工号</th>
                              <th>当前部门</th>
                              <th>企业邮箱</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filterPeople(report.joinedAfter).map(person => (
                              <tr key={person.openId}>
                                <td><strong>{person.name}</strong></td>
                                <td><code>{person.employeeNo || '-'}</code></td>
                                <td>{person.departmentNames}</td>
                                <td><code>{person.email || '未配置'}</code></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="details-clear">
                      <Icon icon={CheckCheck} />
                      <span>实时通讯录对比未发现任务发布后的新增入职人员</span>
                    </div>
                  )
                )}

                {ledgerTab === 'excluded' && (
                  report.inactive.length || report.outOfScopeConfirmed.length ? (
                    <div className="ledger-table-wrap">
                      <table className="ledger-table">
                        <thead>
                          <tr>
                            <th>分类</th>
                            <th>姓名</th>
                            <th>工号</th>
                            <th>部门</th>
                            <th>说明</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filterPeople(report.inactive).map(person => (
                            <tr key={`inactive-${person.openId}`}>
                              <td><span className="status-pill muted-text">已自动移出分母</span></td>
                              <td><strong>{person.name}</strong></td>
                              <td><code>{person.employeeNo || '-'}</code></td>
                              <td>{person.departmentNames}</td>
                              <td>{person.inactiveReason}（不发送催办）</td>
                            </tr>
                          ))}
                          {filterPeople(report.outOfScopeConfirmed).map(person => (
                            <tr key={`out-${person.openId}`}>
                              <td><span className="status-pill ok-text">范围外已确认</span></td>
                              <td><strong>{person.name}</strong></td>
                              <td><code>{person.employeeNo || '-'}</code></td>
                              <td>{person.departmentNames}</td>
                              <td>确认于 {formatDateTime(person.confirmedAt)}（回执 <code>{person.receiptNo}</code>）</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="no-matches">没有因离职剔除或范围外确认的记录。</p>
                  )
                )}
              </div>

              {report.scopeNote && <p className="scope-note">{report.scopeNote}</p>}
            </div>
          </>
        ) : null}
      </>
    );
  }

  // ─── 新建分发任务视图 ────────────────────────────────────────────────────────
  if (mode === 'new') {
    const parsedDraftNumbers = parseNumbers(numbersText);

    return (
      <>
        <div className="detail-Backbar">
          <button
            type="button"
            className="text-button back-link"
            onClick={() => {
              setError('');
              setBanner('');
              onNavigate('/ops/tasks');
            }}
          >
            <Icon icon={ArrowLeft} size={15} />
            返回分发任务列表
          </button>
        </div>

        {error && (
          <div className="notice error-notice" role="alert">
            <Icon icon={CircleAlert} />
            <span>{error}</span>
            <button type="button" className="icon-button" onClick={() => setError('')} aria-label="关闭错误提示">
              <Icon icon={X} size={16} />
            </button>
          </div>
        )}

        <form className="surface-box optical-surface create-task-form" onSubmit={handleCreateTask}>
          <div className="section-heading">
            <h2>新建实名确认任务</h2>
            {demo && (
              <button type="button" className="text-button" onClick={fillDemoTaskTemplate}>
                填入制度通知示例
              </button>
            )}
          </div>

          <div className="form-grid-three">
            <div className="span-two">
              <label className="form-label" htmlFor="task-title">任务标题</label>
              <input
                id="task-title"
                className="text-input"
                required
                maxLength={160}
                placeholder="例如：《2026 年度信息安全与保密制度》确认"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="task-version">文件版本号</label>
              <input
                id="task-version"
                className="text-input mono-input"
                required
                maxLength={32}
                placeholder="v1.0"
                value={version}
                onChange={e => setVersion(e.target.value)}
              />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="task-summary">必读说明与确认要求</label>
            <textarea
              id="task-summary"
              rows={4}
              required
              maxLength={8000}
              placeholder="简要说明本次制度或通知的核心要点与签署要求，员工在确认前将完整阅读此段内容。"
              value={summary}
              onChange={e => setSummary(e.target.value)}
            />
          </div>

          <div className="form-grid-two">
            <div>
              <label className="form-label" htmlFor="task-doc-url">在线文档链接（选填）</label>
              <input
                id="task-doc-url"
                className="text-input"
                type="url"
                placeholder="https://..."
                value={docUrl}
                onChange={e => setDocUrl(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="task-deadline">确认截止日期（选填）</label>
              <input
                id="task-deadline"
                className="text-input"
                type="date"
                value={deadlineAt}
                onChange={e => setDeadlineAt(e.target.value)}
              />
            </div>
          </div>

          <div className="audience-section">
            <div className="field-heading">
              <label>应确认受众快照范围</label>
            </div>
            <div className="mode-tabs compact-tabs" role="tablist" onKeyDown={navigateTabs} aria-label="受众范围类型">
              <button
                type="button"
                role="tab"
                aria-selected={scopeMode === 'all'}
                onClick={() => setScopeMode('all')}
              >
                <Icon icon={Users} size={16} />
                通讯录全员
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scopeMode === 'selection'}
                onClick={() => setScopeMode('selection')}
              >
                <Icon icon={FolderTree} size={16} />
                指定成员或部门
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scopeMode === 'numbers'}
                onClick={() => setScopeMode('numbers')}
              >
                <Icon icon={FileText} size={16} />
                按工号批量导入
              </button>
            </div>

            {scopeMode === 'selection' && (
              <div className="scope-subpanel">
                <button
                  type="button"
                  className="choose-button"
                  disabled={picking}
                  onClick={chooseScopeContacts}
                >
                  <Icon icon={picking ? LoaderCircle : Users} size={16} className={picking ? 'spin' : ''} />
                  <span>从通讯录选择</span>
                  <Icon icon={ChevronRight} size={16} />
                </button>
                {(selected.departments.length > 0 || selected.users.length > 0) && (
                  <div className="chips scope-chips">
                    {selected.departments.map(dept => (
                      <span className="chip department-chip" key={dept.id}>
                        <Icon icon={FolderTree} size={13} />
                        <span>{dept.name}</span>
                        <button
                          type="button"
                          onClick={() => setSelected(prev => ({ ...prev, departments: prev.departments.filter(x => x.id !== dept.id) }))}
                          aria-label={`移除部门 ${dept.name}`}
                        >
                          <Icon icon={X} size={13} />
                        </button>
                      </span>
                    ))}
                    {selected.users.map(u => (
                      <span className="chip" key={u.id}>
                        <span>{u.name}</span>
                        <button
                          type="button"
                          onClick={() => setSelected(prev => ({ ...prev, users: prev.users.filter(x => x.id !== u.id) }))}
                          aria-label={`移除成员 ${u.name}`}
                        >
                          <Icon icon={X} size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <label className="checkbox-label compact-checkbox">
                  <input
                    type="checkbox"
                    checked={includeChildren}
                    onChange={e => setIncludeChildren(e.target.checked)}
                  />
                  <span>包含所选部门的全部子部门</span>
                </label>
              </div>
            )}

            {scopeMode === 'numbers' && (
              <div className="scope-subpanel">
                <textarea
                  className="number-input compact-number-input"
                  placeholder={'一行一个工号，例如：\nE1001\nE1002'}
                  value={numbersText}
                  onChange={e => setNumbersText(e.target.value)}
                  spellCheck={false}
                />
                <span className="field-hint">已识别 {parsedDraftNumbers.length} 个不重复工号</span>
              </div>
            )}

            {scopeMode !== 'all' && (
              <label className="checkbox-label compact-checkbox">
                <input
                  type="checkbox"
                  checked={allowOutOfScope}
                  onChange={e => setAllowOutOfScope(e.target.checked)}
                />
                <span>允许范围外同事通过链接确认</span>
              </label>
            )}
          </div>

          <div className="form-actions-right">
            <button
              type="button"
              className="button ghost-button"
              onClick={() => {
                setError('');
                onNavigate('/ops/tasks');
              }}
            >
              取消
            </button>
            <button type="submit" className="button primary" disabled={creating}>
              <Icon icon={creating ? LoaderCircle : FileCheck2} size={16} className={creating ? 'spin' : ''} />
              {creating ? '正在创建…' : '创建任务并固化快照'}
            </button>
          </div>
        </form>

        {picker && (
          <DemoPicker
            contacts={bootstrap.demoContacts || []}
            departments={bootstrap.demoDepartments || []}
            selected={selected}
            onClose={() => setPicker(false)}
            onConfirm={next => {
              setSelected(next);
              setPicker(false);
            }}
          />
        )}
      </>
    );
  }

  // ─── 任务列表视图 ────────────────────────────────────────────────────────────
  const activeCount = tasks.filter(item => item.status === 'active').length;
  const totalSnapshot = tasks.reduce((sum, item) => sum + (item.snapshotCount || 0), 0);
  const totalConfirmed = tasks.reduce((sum, item) => sum + (item.confirmedInScopeCount || 0), 0);
  const overallBeamWidth = totalSnapshot > 0 ? Math.round((1000 * totalConfirmed) / totalSnapshot) : 0;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>重要文件签收确认</h1>
          <p>固化发布瞬间的在职名单快照，结合实时飞书通讯录自动剔除离职账号并支持双通道精准催办。</p>
        </div>
        <button
          type="button"
          className="button primary"
          disabled={!ready}
          onClick={() => {
            setError('');
            setBanner('');
            onNavigate('/ops/tasks/new');
          }}
        >
          <Icon icon={FilePlus2} size={16} />
          新建任务
        </button>
      </div>

      {error && (
        <div className="notice error-notice" role="alert">
          <Icon icon={CircleAlert} />
          <span>{error}</span>
          <button type="button" className="icon-button" onClick={() => setError('')} aria-label="关闭错误提示">
            <Icon icon={X} size={16} />
          </button>
        </div>
      )}

      {banner && (
        <div className="notice success-notice" role="status">
          <Icon icon={CheckCheck} />
          <span>{banner}</span>
          <button type="button" className="icon-button" onClick={() => setBanner('')} aria-label="关闭提示">
            <Icon icon={X} size={16} />
          </button>
        </div>
      )}

      {tasks.length > 0 && (
        <section className="beam-panel" aria-label="签收任务总览分束条">
          <div className="beam-metrics beam-metrics--three">
            <div className="beam-node">
              <span className="beam-node-value">{tasks.length}</span>
              <span className="beam-node-label">累计分发任务</span>
            </div>
            <div className="beam-node">
              <span className="beam-node-value beam-node-value--cobalt">{activeCount}</span>
              <span className="beam-node-label">正在收集确认</span>
            </div>
            <div className="beam-node">
              <span className="beam-node-value beam-node-value--emerald">
                {totalConfirmed} / {totalSnapshot}
              </span>
              <span className="beam-node-label">快照累计实名签收人次</span>
            </div>
          </div>
          <div className="beam-track" aria-hidden="true">
            <svg className="beam-svg" viewBox="0 0 1000 6" preserveAspectRatio="none">
              <rect className="beam-seg-emerald" x="0" y="0" width={overallBeamWidth} height="6" />
              <rect
                className="beam-seg-cobalt"
                x={overallBeamWidth}
                y="0"
                width={Math.max(0, 1000 - overallBeamWidth)}
                height="6"
                opacity="0.22"
              />
            </svg>
            <div className="beam-scale">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>
        </section>
      )}

      <section className="surface-box optical-surface tasks-list-surface" aria-labelledby="tasks-list-heading">
        <div className="section-heading">
          <h2 id="tasks-list-heading">
            任务列表
            <span className="count-label">{tasks.length}</span>
          </h2>
          <button
            type="button"
            className="text-button"
            disabled={loadingList || !ready}
            onClick={fetchTaskList}
          >
            {loadingList ? '刷新中…' : '刷新列表'}
          </button>
        </div>

        {loadingList && !tasks.length ? (
          <div className="loading-box">
            <Icon icon={LoaderCircle} size={24} className="spin" />
            <span>正在读取任务列表…</span>
          </div>
        ) : tasks.length === 0 ? (
          <div className="result-empty compact-empty">
            <div className="empty-symbol">
              <Icon icon={FileCheck2} size={24} />
            </div>
            <h3>还没有签收确认任务</h3>
            <p>点击右上角「新建任务」或从「邮箱提取」页面带入受众，即可生成专属实名确认短链。</p>
          </div>
        ) : (
          <div className="task-rows">
            {tasks.map(item => {
              const rate = item.snapshotCount > 0
                ? Math.round((item.confirmedInScopeCount / item.snapshotCount) * 1000) / 10
                : 0;
              return (
                <div className="task-row" key={item.slug}>
                  <div className="task-row-main">
                    <div className="task-row-title">
                      <button
                        type="button"
                        className="task-title-link"
                        onClick={() => onNavigate(`/ops/tasks/${item.slug}`)}
                      >
                        {item.title}
                      </button>
                      <span className="badge version-badge">{item.version}</span>
                      <span className={`badge ${item.status === 'active' ? 'status-active' : 'status-closed'}`}>
                        {item.status === 'active' ? '收集中' : '已归档'}
                      </span>
                    </div>
                    <div className="task-row-meta">
                      <span>范围：{scopeLabel(item.scopeType)}</span>
                      <span className="task-mini-meter tabular">
                        <svg className="task-mini-svg" viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true">
                          <rect className="beam-seg-emerald" x="0" y="0" width={Math.max(0, Math.min(100, rate))} height="5" />
                        </svg>
                        <span>快照进度：<strong>{item.confirmedInScopeCount} / {item.snapshotCount}</strong> 人（{rate}%）</span>
                      </span>
                      {item.deadlineAt && <span>截止：{item.deadlineAt}</span>}
                    </div>
                  </div>
                  <div className="task-row-actions">
                    <button
                      type="button"
                      className={`button ${copiedKey === `row-${item.slug}` ? 'success-button' : 'ghost-button'}`}
                      onClick={() => triggerCopy(`row-${item.slug}`, item.ackUrl)}
                    >
                      <Icon icon={copiedKey === `row-${item.slug}` ? Check : Copy} size={15} />
                      {copiedKey === `row-${item.slug}` ? '已复制链接' : '复制确认链接'}
                    </button>
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => onNavigate(`/ops/tasks/${item.slug}`)}
                    >
                      查看对账
                      <Icon icon={ChevronRight} size={15} />
                    </button>
                    <button
                      type="button"
                      className="button danger-button"
                      disabled={deletingSlug === item.slug}
                      onClick={() => handleDeleteTask(item)}
                    >
                      <Icon icon={Trash2} size={15} />
                      {deletingSlug === item.slug ? '正在删除…' : '删除'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

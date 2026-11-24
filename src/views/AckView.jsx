import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCheck,
  CircleAlert,
  ExternalLink,
  FileCheck2,
  FileText,
  LoaderCircle,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { api, isFeishuClient, loginFeishu, startWebOAuthLogin } from '../feishu.js';

const Icon = ({ icon: Component, ...props }) => <Component size={18} strokeWidth={1.8} aria-hidden="true" {...props} />;

function formatDateTime(iso) {
  if (!iso) return '—';
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

export function AckView({ slug, bootstrap, onBootstrapRefresh, onNavigate }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);

  const demo = bootstrap?.mode === 'demo';
  const currentOpenId = bootstrap?.user?.openId || '';

  async function loadAckPage() {
    setLoading(true);
    setError('');
    try {
      const data = await api(`/api/ack/${encodeURIComponent(slug)}`);
      setPayload(data);
      setChecked(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAckPage();
  }, [slug, currentOpenId, bootstrap?.authenticated]);

  async function handleLogin() {
    if (!bootstrap) return;
    setError('');
    if (!isFeishuClient()) {
      startWebOAuthLogin(`/ack/${slug}`);
      return;
    }
    setAuthBusy(true);
    try {
      await loginFeishu(bootstrap.appId, `/ack/${slug}`);
      await onBootstrapRefresh?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleConfirm(event) {
    event.preventDefault();
    if (!checked || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await api(`/api/ack/${encodeURIComponent(slug)}/confirm`, { confirmed: true });
      setPayload(prev => ({ ...prev, ack: res.ack }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !payload) {
    return (
      <div className="ack-container">
        <div className="surface-box loading-box">
          <Icon icon={LoaderCircle} size={28} className="spin" />
          <span>正在加载文件确认单据…</span>
        </div>
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="ack-container">
        <div className="notice error-notice" role="alert">
          <Icon icon={CircleAlert} />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  const task = payload?.task;
  const user = payload?.user;
  const ack = payload?.ack;

  return (
    <div className="ack-container">
      {bootstrap?.user?.canManageOps && (
        <div className="ack-admin-hint">
          <button type="button" className="text-button back-link" onClick={() => onNavigate(`/ops/tasks/${slug}`)}>
            <Icon icon={ArrowLeft} size={15} />
            返回该任务的管理员对账台账
          </button>
          <span>当前你正以员工视角预览确认单据页</span>
        </div>
      )}

      {error && (
        <div className="notice error-notice" role="alert">
          <Icon icon={CircleAlert} />
          <span>{error}</span>
        </div>
      )}

      <article className="surface-box ack-sheet" aria-labelledby="ack-doc-title">
        <div className="ack-sheet-header">
          <div className="ack-meta-row">
            <span className="badge version-badge">文件版本 {task.version}</span>
            <span className={`badge ${ack || task.status === 'active' ? 'status-active' : 'status-closed'}`}>
              {ack ? '本人已签收' : task.status === 'active' ? '待实名签收' : '已截止归档'}
            </span>
            {task.deadlineAt && <span className="ack-deadline">截止日期：{task.deadlineAt}</span>}
          </div>
          <h1 id="ack-doc-title">{task.title}</h1>
          <p className="ack-publisher">发布人：{task.createdByName}</p>
        </div>

        {!payload.authenticated ? (
          <div className="ack-auth-block">
            <div className="ack-auth-info">
              <Icon icon={ShieldCheck} size={22} />
              <div>
                <h2>请先验证本人飞书身份</h2>
                <p>
                  本确认记录需与企业飞书实名账号绑定。登录验证后即可查看完整文件说明并一键确认已读。
                </p>
              </div>
            </div>
            <div className="ack-auth-buttons">
              <button type="button" className="button primary ack-submit-btn" disabled={authBusy} onClick={handleLogin}>
                <Icon icon={authBusy ? LoaderCircle : UserCheck} className={authBusy ? 'spin' : ''} />
                {authBusy
                  ? '正在验证飞书身份…'
                  : isFeishuClient()
                    ? '飞书客户端一键免登并阅读'
                    : '通过飞书账号登录（扫码或桌面端快捷授权）'}
              </button>
              {!isFeishuClient() && payload.feishuAppLink && (
                <a className="button secondary ack-applink" href={payload.feishuAppLink}>
                  <Icon icon={ExternalLink} size={16} />
                  在飞书客户端中打开此确认页
                </a>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="identity-strip">
              <Icon icon={UserCheck} size={18} />
              <div className="identity-strip-text">
                <span>当前确认身份：<strong>{user.name}</strong></span>
                {user.employeeNo && <code>{user.employeeNo}</code>}
                {user.departmentNames && <span>· {user.departmentNames}</span>}
              </div>
              {demo && <span className="identity-demo-tip">可在顶部栏切换其他演示员工体验</span>}
            </div>

            {!payload.eligible ? (
              <div className="notice auth-notice ack-ineligible">
                <Icon icon={CircleAlert} />
                <span>
                  <strong>无需确认</strong>：本文件仅面向指定部门或成员分发，当前登录账号（{user.name}）不在本次应确认名单内。
                </span>
              </div>
            ) : (
              <>
                <section className="ack-content-section" aria-label="文件必读说明">
                  <h2>必读说明与确认要求</h2>
                  <div className="ack-summary-body">{task.summary}</div>

                  {(task.docUrl || task.fileName || task.fileSha256) && (
                    <div className="ack-attachment-box">
                      {task.docUrl && (
                        <div className="ack-attachment-row">
                          <span>在线查阅文档</span>
                          <a href={task.docUrl} target="_blank" rel="noopener noreferrer">
                            打开飞书云文档 / 原文链接
                            <Icon icon={ExternalLink} size={14} />
                          </a>
                        </div>
                      )}
                      {task.fileName && (
                        <div className="ack-attachment-row">
                          <span>随信邮件附件</span>
                          <code>{task.fileName}</code>
                        </div>
                      )}
                      {task.fileSha256 && (
                        <div className="ack-attachment-row">
                          <span>SHA-256 校验摘要</span>
                          <code className="sha-code">{task.fileSha256}</code>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {ack ? (
                  <div className="receipt-box" role="status">
                    <div className="receipt-title">
                      <Icon icon={CheckCheck} size={20} />
                      <strong>已完成本人实名确认</strong>
                    </div>
                    <dl className="receipt-dl">
                      <div>
                        <dt>电子回执编号</dt>
                        <dd><code>{ack.receiptNo}</code></dd>
                      </div>
                      <div>
                        <dt>确认人身份</dt>
                        <dd>{ack.name}{ack.employeeNo ? `（${ack.employeeNo}）` : ''}</dd>
                      </div>
                      <div>
                        <dt>确认文件版本</dt>
                        <dd><code>{ack.version}</code></dd>
                      </div>
                      <div>
                        <dt>确认留痕时间</dt>
                        <dd className="tabular">{formatDateTime(ack.confirmedAt)}</dd>
                      </div>
                    </dl>
                    <div className="receipt-footer">
                      <button type="button" className="text-button" onClick={() => onNavigate('/my/acks')}>
                        查看我已确认的全部文件记录
                      </button>
                    </div>
                  </div>
                ) : task.status !== 'active' ? (
                  <div className="notice demo-notice">
                    <Icon icon={CircleAlert} />
                    <span>本次文件确认收集已截止归档，现仅保留查阅，无法补签。如需补确认请联系发布人。</span>
                  </div>
                ) : (
                  <form className="ack-confirm-form" onSubmit={handleConfirm}>
                    {!payload.inTargetScope && (
                      <p className="out-of-scope-hint">
                        提示：你的账号不在初始分发快照中，确认后系统将以「范围外已确认」为你记录实名回执。
                      </p>
                    )}
                    <label className="checkbox-label ack-checkbox">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={submitting}
                        onChange={e => setChecked(e.target.checked)}
                      />
                      <span>
                        本人（<strong>{user.name}{user.employeeNo ? ` · ${user.employeeNo}` : ''}</strong>）已完整阅读上述文件及必读说明，知悉并确认相关内容。
                      </span>
                    </label>
                    <button
                      type="submit"
                      className="button primary ack-submit-btn"
                      disabled={!checked || submitting}
                    >
                      <Icon icon={submitting ? LoaderCircle : FileCheck2} className={submitting ? 'spin' : ''} />
                      {submitting ? '正在提交实名回执…' : `以本人身份确认已读（${user.name}）`}
                    </button>
                  </form>
                )}
              </>
            )}
          </>
        )}
      </article>
    </div>
  );
}

export function MyAcksView({ bootstrap, onNavigate }) {
  const [acks, setAcks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!bootstrap?.authenticated) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api('/api/my/acks')
      .then(data => setAcks(data.acks || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [bootstrap?.authenticated, bootstrap?.user?.openId]);

  return (
    <div className="ack-container">
      <div className="page-heading">
        <div>
          <h1>我的实名确认记录</h1>
          <p>当前飞书账号（{bootstrap?.user?.name || '未登录'}）在本平台留存的全部文件阅读确认凭证。</p>
        </div>
      </div>

      {error && (
        <div className="notice error-notice" role="alert">
          <Icon icon={CircleAlert} />
          <span>{error}</span>
        </div>
      )}

      <section className="surface-box tasks-list-surface">
        {loading ? (
          <div className="loading-box">
            <Icon icon={LoaderCircle} size={24} className="spin" />
            <span>正在查询确认凭证…</span>
          </div>
        ) : acks.length === 0 ? (
          <div className="result-empty compact-empty">
            <div className="empty-symbol">
              <Icon icon={FileText} size={28} />
            </div>
            <h3>暂无已确认记录</h3>
            <p>当你通过邮件中的确认链接完成文件阅读确认后，电子回执会自动保存在这里。</p>
          </div>
        ) : (
          <div className="task-rows">
            {acks.map(item => (
              <div className="task-row" key={item.receiptNo}>
                <div className="task-row-main">
                  <div className="task-row-title">
                    <button
                      type="button"
                      className="task-title-link"
                      onClick={() => onNavigate(`/ack/${item.slug}`)}
                    >
                      {item.title}
                    </button>
                    <span className="badge version-badge">{item.version}</span>
                  </div>
                  <div className="task-row-meta">
                    <span>回执编号：<code>{item.receiptNo}</code></span>
                    <span>·</span>
                    <span className="tabular">确认时间：{formatDateTime(item.confirmedAt)}</span>
                  </div>
                </div>
                <div className="task-row-actions">
                  <button
                    type="button"
                    className="button ghost-button"
                    onClick={() => onNavigate(`/ack/${item.slug}`)}
                  >
                    查看回执详情
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Briefcase,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Copy,
  FileCheck2,
  LoaderCircle,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { api, copyTextWithFallback, isFeishuClient, loginFeishu, startWebOAuthLogin } from './feishu.js';
import { MailView } from './views/MailView.jsx';
import { TasksView } from './views/TasksView.jsx';
import { AckView, MyAcksView } from './views/AckView.jsx';
import './styles.css';

const Icon = ({ icon: Component, ...props }) => <Component size={18} strokeWidth={1.8} aria-hidden="true" {...props} />;

function parseRoute(pathname) {
  const clean = (pathname || '/').replace(/\/+$/, '') || '/';
  const ackMatch = clean.match(/^\/ack\/([A-Za-z0-9_-]+)$/);
  if (ackMatch) return { kind: 'ack', slug: ackMatch[1] };
  if (clean === '/my/acks') return { kind: 'my-acks' };
  if (clean === '/ops/permissions') return { kind: 'permissions' };
  const taskDetailMatch = clean.match(/^\/ops\/tasks\/([A-Za-z0-9_-]+)$/);
  if (taskDetailMatch) return { kind: 'tasks', slug: taskDetailMatch[1] };
  if (clean === '/ops/tasks') return { kind: 'tasks', slug: '' };
  return { kind: 'mail' };
}

function PermissionsView({ bootstrap, onRefreshBootstrap }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState('');
  const [name, setName] = useState('');
  const [employeeNo, setEmployeeNo] = useState('');
  const [role, setRole] = useState('operator');
  const [saving, setSaving] = useState(false);
  const [refreshingDir, setRefreshingDir] = useState(false);
  const [dirBanner, setDirBanner] = useState('');

  async function loadGrants() {
    setLoading(true);
    setError('');
    try {
      setData(await api('/api/ops/admins'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadGrants();
  }, []);

  async function handleBindSelf() {
    setSaving(true);
    setError('');
    try {
      const next = await api('/api/ops/admins', { role: 'admin' });
      setData(prev => ({ ...prev, ...next }));
      await onRefreshBootstrap?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddGrant(event) {
    event.preventDefault();
    if (!openId.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const next = await api('/api/ops/admins', {
        openId: openId.trim(),
        name: name.trim(),
        employeeNo: employeeNo.trim(),
        role,
      });
      setData(prev => ({ ...prev, ...next }));
      setOpenId('');
      setName('');
      setEmployeeNo('');
      await onRefreshBootstrap?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveGrant(targetOpenId) {
    setError('');
    try {
      const next = await api(`/api/ops/admins/${encodeURIComponent(targetOpenId)}`, undefined, { method: 'DELETE' });
      setData(prev => ({ ...prev, ...next }));
      await onRefreshBootstrap?.();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRefreshDirectoryCache() {
    setRefreshingDir(true);
    setError('');
    setDirBanner('');
    try {
      const res = await api('/api/ops/directory/refresh', {});
      setDirBanner(`已同步刷新通讯录缓存，当前可见成员共 ${res.userCount} 人。`);
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshingDir(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>命名空间与运营权限同步</h1>
          <p>「邮箱提取」与「分发确认」共用同一飞书应用凭证、通讯录缓存及后台协作者名单。</p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={refreshingDir}
          onClick={handleRefreshDirectoryCache}
        >
          <Icon icon={RefreshCw} size={15} className={refreshingDir ? 'spin' : ''} />
          {refreshingDir ? '正在刷新通讯录…' : '立即刷新通讯录缓存'}
        </button>
      </div>

      {error && (
        <div className="notice error-notice" role="alert">
          <Icon icon={CircleAlert} />
          <span>{error}</span>
        </div>
      )}

      {dirBanner && (
        <div className="notice success-notice" role="status">
          <Icon icon={CheckCheck} />
          <span>{dirBanner}</span>
        </div>
      )}

      {data && !data.rbacStrict && bootstrap?.mode === 'feishu' && (
        <div className="notice auth-notice">
          <Icon icon={Lock} />
          <span>
            <strong>尚未启用管理后台角色隔离</strong>：在你向全员发送确认链接前，请先将当前账号绑定为管理员，启用后普通员工仅能访问邮件确认页，无法进入管理工作台。
          </span>
          <button type="button" className="button primary" disabled={saving} onClick={handleBindSelf}>
            将我设为管理员并启用隔离
          </button>
        </div>
      )}

      <div className="workspace permissions-workspace">
        <section className="input-panel" aria-labelledby="add-operator-heading">
          <div className="section-heading">
            <h2 id="add-operator-heading">新增运营后台协作者</h2>
          </div>
          <p className="field-hint">
            所有本企业飞书员工默认均可点击邮件确认链接签收，无需在此添加；此处仅授权可进入「邮箱提取」与「分发确认管理」后台的同事。
          </p>
          <form onSubmit={handleAddGrant}>
            <div className="form-field">
              <label className="form-label" htmlFor="grant-openid">成员飞书 open_id</label>
              <input
                id="grant-openid"
                className="text-input mono-input"
                required
                placeholder="例如 ou_xxxxxxxxxxxxxxxx"
                value={openId}
                onChange={e => setOpenId(e.target.value)}
              />
            </div>
            <div className="form-grid-two">
              <div>
                <label className="form-label" htmlFor="grant-name">姓名备注（可选）</label>
                <input
                  id="grant-name"
                  className="text-input"
                  placeholder="例如 张三"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="grant-empno">工号备注（可选）</label>
                <input
                  id="grant-empno"
                  className="text-input mono-input"
                  placeholder="例如 E1005"
                  value={employeeNo}
                  onChange={e => setEmployeeNo(e.target.value)}
                />
              </div>
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="grant-role">角色类型</label>
              <select
                id="grant-role"
                className="select-input"
                value={role}
                onChange={e => setRole(e.target.value)}
              >
                <option value="operator">运营协作者（可使用邮箱提取与分发对账）</option>
                <option value="admin">系统管理员（包含权限管理）</option>
              </select>
            </div>
            <button type="submit" className="button primary submit-button" disabled={saving || !openId.trim()}>
              <Icon icon={UserPlus} size={16} />
              授权进入运营助手后台
            </button>
          </form>
        </section>

        <section className="result-panel" aria-labelledby="operator-list-heading">
          <div className="section-heading">
            <h2 id="operator-list-heading">当前后台授权名单</h2>
            <span className="section-note">{data?.rbacStrict ? '角色隔离已生效' : '初始开放设置态'}</span>
          </div>
          {loading ? (
            <div className="loading-box">
              <Icon icon={LoaderCircle} size={22} className="spin" />
              <span>正在读取权限配置…</span>
            </div>
          ) : (
            <>
              {(data?.envAdminOpenIds?.length > 0 || data?.envAdminEmployeeNos?.length > 0) && (
                <div className="env-admin-note">
                  环境变量固定管理员：
                  {data.envAdminEmployeeNos?.map(no => <code key={no}>{no}</code>)}
                  {data.envAdminOpenIds?.map(id => <code key={id}>{id}</code>)}
                </div>
              )}
              {data?.grants?.length ? (
                <div className="detail-list">
                  {data.grants.map(grant => (
                    <div className="matched-row" key={grant.openId}>
                      <div>
                        <strong>{grant.name || grant.openId}</strong>
                        {grant.employeeNo && <code>{grant.employeeNo}</code>}
                        <code>{grant.openId}</code>
                      </div>
                      <div className="grant-row-right">
                        <span className="badge version-badge">{grant.role === 'admin' ? '管理员' : '运营协作'}</span>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => handleRemoveGrant(grant.openId)}
                          aria-label={`移除 ${grant.name || grant.openId} 的后台权限`}
                        >
                          <Icon icon={Trash2} size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="result-empty compact-empty">
                  <p>当前暂无页面内动态添加的协作者记录。</p>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}

function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [bootstrap, setBootstrap] = useState(null);
  const [globalError, setGlobalError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [draftAudience, setDraftAudience] = useState(null);
  const [openIdCopied, setOpenIdCopied] = useState(false);

  const navigate = useCallback(nextPath => {
    if (nextPath === window.location.pathname) return;
    window.history.pushState({}, '', nextPath);
    setPathname(nextPath);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const refreshBootstrap = useCallback(async () => {
    try {
      const data = await api('/api/bootstrap');
      setBootstrap(data);
      setGlobalError('');
      return data;
    } catch (err) {
      setGlobalError(err.message);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshBootstrap();
  }, [refreshBootstrap]);

  const route = parseRoute(pathname);
  const demo = bootstrap?.mode === 'demo';
  const authenticated = Boolean(bootstrap?.authenticated);
  const canManageOps = Boolean(bootstrap?.user?.canManageOps);
  const ready = Boolean(bootstrap) && authenticated && canManageOps;
  const isEmployeeSurface = route.kind === 'ack' || route.kind === 'my-acks';

  async function handleFeishuLogin() {
    if (!bootstrap) return;
    setGlobalError('');
    if (!isFeishuClient()) {
      startWebOAuthLogin(pathname);
      return;
    }
    setAuthBusy(true);
    try {
      const next = await loginFeishu(bootstrap.appId, pathname);
      if (next) setBootstrap(next);
    } catch (err) {
      setGlobalError(err.message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleDemoPersonaChange(event) {
    const nextOpenId = event.target.value;
    try {
      await api('/api/demo/persona', { openId: nextOpenId });
      await refreshBootstrap();
    } catch (err) {
      setGlobalError(err.message);
    }
  }

  async function handleLogout() {
    try {
      await api('/api/auth/logout', {});
      await refreshBootstrap();
    } catch (err) {
      setGlobalError(err.message);
    }
  }

  function handleCreateTaskFromAudience(audience) {
    setDraftAudience(audience);
    navigate('/ops/tasks');
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a
            className="brand"
            href={canManageOps ? '/ops/mail' : '/my/acks'}
            onClick={e => {
              e.preventDefault();
              navigate(canManageOps ? '/ops/mail' : '/my/acks');
            }}
            aria-label="飞书运营助手首页"
          >
            <span className="brand-icon">
              <Icon icon={Briefcase} size={20} />
            </span>
            <span>运营助手</span>
          </a>

          {(canManageOps || (!authenticated && !isEmployeeSurface)) && (
            <>
              <span className="topbar-divider" />
              <nav className="topbar-nav" aria-label="运营助手功能模块">
                <button
                  type="button"
                  className={`topbar-link ${route.kind === 'mail' ? 'active' : ''}`}
                  onClick={() => navigate('/ops/mail')}
                >
                  <Icon icon={Mail} size={16} />
                  邮箱提取
                </button>
                <button
                  type="button"
                  className={`topbar-link ${route.kind === 'tasks' ? 'active' : ''}`}
                  onClick={() => navigate('/ops/tasks')}
                >
                  <Icon icon={FileCheck2} size={16} />
                  分发确认
                </button>
                <button
                  type="button"
                  className={`topbar-link ${route.kind === 'permissions' ? 'active' : ''}`}
                  onClick={() => navigate('/ops/permissions')}
                >
                  <Icon icon={ShieldCheck} size={16} />
                  权限同步
                </button>
              </nav>
            </>
          )}

          <div className="topbar-right">
            {demo && bootstrap?.demoPersonas && (
              <label className="persona-switcher">
                <span className="sr-only">切换演示身份视角</span>
                <select
                  value={bootstrap.user?.openId || ''}
                  onChange={handleDemoPersonaChange}
                  aria-label="切换演示身份视角"
                >
                  {bootstrap.demoPersonas.map(persona => (
                    <option key={persona.openId} value={persona.openId}>
                      视角：{persona.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="environment">
              {!bootstrap ? '正在连接' : demo ? '演示环境' : '企业应用'}
            </span>
          </div>
        </div>
      </header>

      <main>
        {demo && (
          <div className="notice demo-notice">
            <Icon icon={CircleAlert} />
            <span>
              <strong>当前为演示模式</strong> · 组织架构与示例任务均为虚构数据。你可在右上角切换「管理员 / 待确认员工 / 新入职员工」视角完整体验发信取邮箱、点链接签收与通讯录对账。
            </span>
          </div>
        )}

        {globalError && (
          <div className="notice error-notice" role="alert">
            <Icon icon={CircleAlert} />
            <span>{globalError}</span>
            {!bootstrap && (
              <button type="button" className="text-button" onClick={refreshBootstrap}>
                重新连接
              </button>
            )}
            <button type="button" className="icon-button" onClick={() => setGlobalError('')} aria-label="关闭错误提示">
              <Icon icon={X} size={16} />
            </button>
          </div>
        )}

        {bootstrap && !demo && authenticated && (
          <div className="session-line">
            <Icon icon={CheckCheck} />
            <span>
              {bootstrap.user?.name || '飞书成员'}
              {bootstrap.user?.employeeNo ? `（${bootstrap.user.employeeNo}）` : ''}
              ，已通过飞书实名认证
            </span>
            <button type="button" className="text-button" onClick={() => navigate('/my/acks')}>
              我的确认回执
            </button>
            <button type="button" className="text-button" onClick={handleLogout}>
              退出
            </button>
          </div>
        )}

        {route.kind === 'ack' ? (
          <AckView
            slug={route.slug}
            bootstrap={bootstrap}
            onBootstrapRefresh={refreshBootstrap}
            onNavigate={navigate}
          />
        ) : route.kind === 'my-acks' ? (
          <MyAcksView bootstrap={bootstrap} onNavigate={navigate} />
        ) : bootstrap && !demo && !authenticated ? (
          <div className="notice auth-notice">
            <Icon icon={ShieldCheck} />
            <span>
              <strong>先登录飞书，再进入运营助手工作台</strong>
              <br />
              支持在飞书工作台内一键免登，或在普通浏览器中通过飞书扫码 / 桌面端快捷授权登录。
            </span>
            <button type="button" className="button primary" onClick={handleFeishuLogin} disabled={authBusy}>
              {authBusy && <Icon icon={LoaderCircle} className="spin" />}
              {authBusy ? '正在授权…' : '登录飞书'}
            </button>
          </div>
        ) : bootstrap && authenticated && !canManageOps ? (
          <div className="ack-container">
            <div className="surface-box restricted-box">
              <Icon icon={Lock} size={28} />
              <h1>当前身份无运营管理工作台权限</h1>
              <p>
                你当前登录的账号为 <strong>{bootstrap.user?.name}</strong>
                {bootstrap.user?.employeeNo ? `（工号 ${bootstrap.user.employeeNo}）` : ''}，属于普通员工视角，可通过邮件中的专属确认链接完成文件实名签收。
              </p>
              <div className="openid-self-box">
                <span>如需开通运营助手管理权限，请将以下标识发给管理员加入后台授权：</span>
                <div className="openid-copy-line">
                  <code>{bootstrap.user?.openId}</code>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={async () => {
                      const res = await copyTextWithFallback(bootstrap.user?.openId || '');
                      if (res.ok) {
                        setOpenIdCopied(true);
                        setTimeout(() => setOpenIdCopied(false), 2000);
                      }
                    }}
                  >
                    <Icon icon={Copy} size={14} />
                    {openIdCopied ? '已复制' : '复制 open_id'}
                  </button>
                </div>
              </div>
              <div className="restricted-actions">
                <button type="button" className="button primary" onClick={() => navigate('/my/acks')}>
                  <Icon icon={UserCheck} size={16} />
                  查看我已确认的文件记录
                </button>
                {demo && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => navigate('/ack/demo-sec-2026')}
                  >
                    前往示例制度确认单据页
                    <Icon icon={ChevronRight} size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : route.kind === 'tasks' ? (
          <TasksView
            bootstrap={bootstrap}
            ready={ready}
            activeSlug={route.slug}
            draftAudience={draftAudience}
            onClearDraftAudience={() => setDraftAudience(null)}
            onNavigate={navigate}
            onAuthError={() => setBootstrap(prev => prev && { ...prev, authenticated: false })}
          />
        ) : route.kind === 'permissions' ? (
          <PermissionsView bootstrap={bootstrap} onRefreshBootstrap={refreshBootstrap} />
        ) : (
          <MailView
            bootstrap={bootstrap}
            ready={ready}
            onAuthError={() => setBootstrap(prev => prev && { ...prev, authenticated: false })}
            onCreateTaskFromAudience={handleCreateTaskFromAudience}
          />
        )}

        <footer>
          <span>飞书运营助手 · 统一通讯录邮箱提取与重要文件实名确认</span>
          <span>{demo ? '演示模式：所有人员与回执均为本地虚构样本' : '实名确认记录与通讯录数据仅限企业内部合规运营使用'}</span>
        </footer>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);

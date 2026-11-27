import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Copy,
  FileCheck2,
  FolderKanban,
  KeyRound,
  Layers,
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
import { api, clearOAuthFallback, copyTextWithFallback, isFeishuClient, loginFeishu, startWebOAuthLogin } from './feishu.js';
import { MailView } from './views/MailView.jsx';
import { TasksView } from './views/TasksView.jsx';
import { ProjectsView } from './views/ProjectsView.jsx';
import { TokensView } from './views/TokensView.jsx';
import { AckView, MyAcksView } from './views/AckView.jsx';
import { MemberPicker } from './components/MemberPicker.jsx';
import './styles.css';

const Icon = ({ icon: Component, ...props }) => <Component size={18} strokeWidth={1.8} aria-hidden="true" {...props} />;

function parseRoute(pathname) {
  const clean = (pathname || '/').replace(/\/+$/, '') || '/';
  const ackMatch = clean.match(/^\/ack\/([A-Za-z0-9_-]+)$/);
  if (ackMatch) return { kind: 'ack', slug: ackMatch[1] };
  if (clean === '/my/acks') return { kind: 'my-acks' };
  if (clean === '/ops/permissions') return { kind: 'redirect', to: '/ops/admin/permissions' };
  if (clean === '/ops/admin' || clean === '/ops/admin/permissions') return { kind: 'admin', section: 'permissions' };
  if (clean === '/ops/admin/tokens') return { kind: 'admin', section: 'tokens' };
  if (clean === '/ops/projects') return { kind: 'projects', mode: 'list', projectId: '' };
  if (clean === '/ops/projects/new') return { kind: 'projects', mode: 'new', projectId: '' };
  const projectEditMatch = clean.match(/^\/ops\/projects\/([A-Za-z0-9_-]+)\/edit$/);
  if (projectEditMatch) return { kind: 'projects', mode: 'edit', projectId: projectEditMatch[1] };
  const projectDetailMatch = clean.match(/^\/ops\/projects\/([A-Za-z0-9_-]+)$/);
  if (projectDetailMatch) return { kind: 'projects', mode: 'detail', projectId: projectDetailMatch[1] };
  if (clean === '/ops/tasks/new') return { kind: 'tasks', mode: 'new', slug: '' };
  const taskDetailMatch = clean.match(/^\/ops\/tasks\/([A-Za-z0-9_-]+)$/);
  if (taskDetailMatch) return { kind: 'tasks', mode: 'detail', slug: taskDetailMatch[1] };
  if (clean === '/ops/tasks') return { kind: 'tasks', mode: 'list', slug: '' };
  return { kind: 'mail' };
}

function PermissionsView({ bootstrap, onRefreshBootstrap }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
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
    if (!picked.length || saving) return;
    setSaving(true);
    setError('');
    try {
      let next = null;
      for (const person of picked) {
        next = await api('/api/ops/admins', {
          openId: person.openId,
          name: person.name,
          employeeNo: person.employeeNo,
          role,
        });
      }
      if (next) setData(prev => ({ ...prev, ...next }));
      setPicked([]);
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
      setDirBanner(`已同步刷新通讯录缓存，当前可见在职成员共 ${res.userCount} 人。`);
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshingDir(false);
    }
  }

  return (
    <>
      <div className="section-heading">
        <h2>后台角色授权与通讯录缓存</h2>
        <button
          type="button"
          className="button ghost-button"
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
        <section className="input-panel optical-surface" aria-labelledby="add-operator-heading">
          <div className="section-heading">
            <h2 id="add-operator-heading">添加后台协作者</h2>
          </div>
          <form onSubmit={handleAddGrant}>
            <div className="form-field">
              <label className="form-label">成员</label>
              <button type="button" className="choose-button" onClick={() => setPickerOpen(true)}>
                <Icon icon={UserPlus} size={16} />
                <span>从通讯录选择</span>
                <Icon icon={ChevronRight} size={16} />
              </button>
              {picked.length > 0 && (
                <div className="chips scope-chips">
                  {picked.map(person => (
                    <span className="chip" key={person.openId}>
                      <span>{person.name}{person.employeeNo ? ` ${person.employeeNo}` : ''}</span>
                      <button
                        type="button"
                        onClick={() => setPicked(current => current.filter(item => item.openId !== person.openId))}
                        aria-label={`移除 ${person.name}`}
                      >
                        <Icon icon={X} size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="grant-role">角色级别</label>
              <select
                id="grant-role"
                className="select-input"
                value={role}
                onChange={e => setRole(e.target.value)}
              >
                <option value="operator">运营协作者</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <button type="submit" className="button primary submit-button" disabled={saving || !picked.length}>
              <Icon icon={UserPlus} size={16} />
              {saving ? '正在添加…' : '加入后台权限'}
            </button>
          </form>
          {pickerOpen && (
            <MemberPicker
              selected={picked}
              onClose={() => setPickerOpen(false)}
              onConfirm={people => {
                setPicked(people);
                setPickerOpen(false);
              }}
            />
          )}
        </section>

        <section className="result-panel" aria-labelledby="operator-list-heading">
          <div className="section-heading">
            <h2 id="operator-list-heading">
              当前授权名单
              {data?.grants && <span className="count-label">{data.grants.length}</span>}
            </h2>
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
                  <span>环境变量固定管理员：</span>
                  {data.envAdminEmployeeNos?.map(no => <code key={no}>{no}</code>)}
                  {data.envAdminOpenIds?.map(id => <code key={id}>{id}</code>)}
                </div>
              )}
              {data?.grants?.length ? (
                <div className="detail-list">
                  {data.grants.map(grant => (
                    <div className="matched-row" key={grant.openId}>
                      <div>
                        <strong>{grant.name || '未命名成员'}</strong>
                        {grant.employeeNo && <code>{grant.employeeNo}</code>}
                      </div>
                      <div className="grant-row-right">
                        <span className={`badge ${grant.role === 'admin' ? 'status-active' : 'version-badge'}`}>
                          {grant.role === 'admin' ? '管理员' : '运营协作'}
                        </span>
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
                  <h3>暂无动态添加的协作者</h3>
                  <p>左侧从通讯录选择同事后，即可授予运营工作台访问权限。</p>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}

function AdminCenterView({ bootstrap, section, onNavigate, onRefreshBootstrap, ready }) {
  const isAdmin = bootstrap?.user?.role === 'admin';
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>管理中心</h1>
          <p>配置工作台角色隔离权限、手动同步飞书通讯录缓存，并管理自动化集成 API 令牌。</p>
        </div>
      </div>
      <div className="mode-tabs compact-tabs" role="tablist" aria-label="管理中心子功能">
        <button
          type="button"
          role="tab"
          aria-selected={section === 'permissions'}
          onClick={() => onNavigate('/ops/admin/permissions')}
        >
          <Icon icon={ShieldCheck} size={16} />
          权限管理
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === 'tokens'}
          onClick={() => onNavigate('/ops/admin/tokens')}
        >
          <Icon icon={KeyRound} size={16} />
          API 令牌
        </button>
      </div>

      {section === 'permissions' ? (
        <PermissionsView bootstrap={bootstrap} onRefreshBootstrap={onRefreshBootstrap} />
      ) : isAdmin ? (
        <TokensView ready={ready} />
      ) : (
        <div className="notice auth-notice">
          <Icon icon={Lock} />
          <span>API 令牌仅管理员可管理。</span>
        </div>
      )}
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
  const autoLoginAttempted = useRef(false);

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

  useEffect(() => {
    if (bootstrap?.authenticated) clearOAuthFallback();
  }, [bootstrap?.authenticated]);

  const route = parseRoute(pathname);

  useEffect(() => {
    if (route.kind !== 'redirect') return;
    window.history.replaceState({}, '', route.to);
    setPathname(route.to);
  }, [route.kind, route.to]);

  const demo = bootstrap?.mode === 'demo';
  const authenticated = Boolean(bootstrap?.authenticated);
  const canManageOps = Boolean(bootstrap?.user?.canManageOps);
  const ready = Boolean(bootstrap) && authenticated && canManageOps;
  const isEmployeeSurface = route.kind === 'ack' || route.kind === 'my-acks';
  const showOpsShell = !isEmployeeSurface && (canManageOps || !authenticated);
  const inFeishuClient = isFeishuClient();

  const handleFeishuLogin = useCallback(async ({ silent = false } = {}) => {
    if (!bootstrap || bootstrap.mode === 'demo') return false;
    setGlobalError('');
    if (!isFeishuClient()) {
      startWebOAuthLogin(pathname);
      return true;
    }
    setAuthBusy(true);
    try {
      const next = await loginFeishu(bootstrap.appId, pathname, { force: !silent });
      if (next) setBootstrap(next);
      return Boolean(next?.authenticated);
    } catch (err) {
      setGlobalError(err.message || '飞书免登未完成，请点击下方按钮重试。');
      return false;
    } finally {
      setAuthBusy(false);
    }
  }, [bootstrap, pathname]);

  useEffect(() => {
    if (!bootstrap || demo || authenticated || isEmployeeSurface) return;
    if (!inFeishuClient || autoLoginAttempted.current || authBusy) return;
    autoLoginAttempted.current = true;
    handleFeishuLogin({ silent: true });
  }, [bootstrap, demo, authenticated, isEmployeeSurface, inFeishuClient, authBusy, handleFeishuLogin]);

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
    navigate('/ops/tasks/new');
  }

  const brandHref = canManageOps ? '/ops/mail' : '/my/acks';

  const personaSelect = demo && bootstrap?.demoPersonas ? (
    <label className="persona-switcher">
      <span className="sr-only">切换演示身份视角</span>
      <select
        value={bootstrap.user?.openId || ''}
        onChange={handleDemoPersonaChange}
        aria-label="切换演示身份视角"
      >
        {bootstrap.demoPersonas.map(persona => (
          <option key={persona.openId} value={persona.openId}>
            {persona.label}
          </option>
        ))}
      </select>
    </label>
  ) : null;

  const envBadge = (
    <span className="env-pill">
      <span className={`env-dot ${bootstrap && !demo ? 'env-dot--live' : ''}`} aria-hidden="true" />
      {!bootstrap ? '正在连接' : demo ? '演示环境' : '企业应用'}
    </span>
  );

  return (
    <div className={showOpsShell ? 'app-shell--ops' : 'app-shell--sheet'}>
      {showOpsShell ? (
        <aside className="carbon-rail" aria-label="运营工作台主导航">
          <a
            className="rail-brand"
            href={brandHref}
            onClick={e => {
              e.preventDefault();
              navigate(brandHref);
            }}
            aria-label="飞书运营助手首页"
          >
            <span className="rail-brand-mark">
              <Icon icon={Layers} size={17} />
            </span>
            <span>飞书运营助手</span>
          </a>

          <nav className="rail-nav" aria-label="运营助手功能模块">
            <button
              type="button"
              className={`rail-link ${route.kind === 'mail' ? 'active' : ''}`}
              onClick={() => navigate('/ops/mail')}
            >
              <Icon icon={Mail} size={17} />
              <span>邮箱提取</span>
              <span className="rail-link-dot" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`rail-link ${route.kind === 'tasks' ? 'active' : ''}`}
              onClick={() => navigate('/ops/tasks')}
            >
              <Icon icon={FileCheck2} size={17} />
              <span>分发确认</span>
              <span className="rail-link-dot" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`rail-link ${route.kind === 'projects' ? 'active' : ''}`}
              onClick={() => navigate('/ops/projects')}
            >
              <Icon icon={FolderKanban} size={17} />
              <span>项目清单</span>
              <span className="rail-link-dot" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`rail-link ${route.kind === 'admin' ? 'active' : ''}`}
              onClick={() => navigate('/ops/admin/permissions')}
            >
              <Icon icon={ShieldCheck} size={17} />
              <span>管理中心</span>
              <span className="rail-link-dot" aria-hidden="true" />
            </button>
          </nav>

          <div className="rail-dock">
            <div className="rail-env-row">
              {envBadge}
            </div>
            {personaSelect}
            {bootstrap && !demo && authenticated && (
              <div className="rail-session">
                <div className="rail-session-user">
                  <span>{bootstrap.user?.name || '飞书成员'}</span>
                  {bootstrap.user?.employeeNo && <code>{bootstrap.user.employeeNo}</code>}
                </div>
                <div className="rail-session-links">
                  <button type="button" className="rail-text-btn" onClick={() => navigate('/my/acks')}>
                    我的回执
                  </button>
                  <button type="button" className="rail-text-btn" onClick={handleLogout}>
                    退出
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
      ) : (
        <header className="sheet-topbar">
          <div className="sheet-topbar-inner">
            <a
              className="rail-brand"
              href={brandHref}
              onClick={e => {
                e.preventDefault();
                navigate(brandHref);
              }}
              aria-label="飞书运营助手"
            >
              <span className="rail-brand-mark">
                <Icon icon={Layers} size={17} />
              </span>
              <span>飞书运营助手</span>
            </a>

            <div className="sheet-topbar-right">
              {personaSelect}
              {envBadge}
              {bootstrap && !demo && authenticated && (
                <>
                  <button type="button" className="rail-text-btn" onClick={() => navigate('/my/acks')}>
                    我的确认回执
                  </button>
                  <button type="button" className="rail-text-btn" onClick={handleLogout}>
                    退出
                  </button>
                </>
              )}
            </div>
          </div>
        </header>
      )}

      <main className="app-canvas">
        <div className="canvas-inner">
          {demo && (
            <div className="notice demo-notice">
              <Icon icon={CircleAlert} size={17} />
              <span>
                {isEmployeeSurface ? (
                  <>
                    <strong>演示模式</strong> · 当前为虚构示例单据，可在顶栏切换员工身份视角体验签收与回执。
                  </>
                ) : (
                  <>
                    <strong>当前为演示模式</strong> · 组织架构与示例任务均为虚构数据。你可在导航栏切换「管理员 / 待确认员工 / 新入职员工」视角完整体验发信取邮箱、点链接签收与通讯录对账。
                  </>
                )}
              </span>
            </div>
          )}

          {globalError && (
            <div className="notice error-notice" role="alert">
              <Icon icon={CircleAlert} size={17} />
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
                <strong>
                  {authBusy
                    ? '正在跳转飞书授权…'
                    : '先登录飞书，再进入运营助手工作台'}
                </strong>
                <br />
                {inFeishuClient
                  ? '将使用已配置的回调地址完成登录，不会再校验当前页面地址。'
                  : '普通浏览器中将跳转飞书扫码或桌面端快捷授权登录。'}
              </span>
              {!(authBusy && inFeishuClient) && (
                <button
                  type="button"
                  className="button primary"
                  onClick={() => handleFeishuLogin()}
                  disabled={authBusy}
                >
                  {authBusy && <Icon icon={LoaderCircle} className="spin" />}
                  {authBusy ? '正在授权…' : '登录飞书'}
                </button>
              )}
              {authBusy && inFeishuClient && (
                <span className="auth-busy-line">
                  <Icon icon={LoaderCircle} className="spin" />
                  免登进行中
                </span>
              )}
            </div>
          ) : bootstrap && authenticated && !canManageOps ? (
            <div className="ack-container">
              <div className="surface-box optical-surface restricted-box">
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
              mode={route.mode}
              activeSlug={route.slug}
              draftAudience={draftAudience}
              onClearDraftAudience={() => setDraftAudience(null)}
              onNavigate={navigate}
              onAuthError={() => setBootstrap(prev => prev && { ...prev, authenticated: false })}
            />
          ) : route.kind === 'admin' ? (
            <AdminCenterView
              bootstrap={bootstrap}
              section={route.section}
              ready={ready}
              onNavigate={navigate}
              onRefreshBootstrap={refreshBootstrap}
            />
          ) : route.kind === 'projects' ? (
            <ProjectsView
              bootstrap={bootstrap}
              ready={ready}
              mode={route.mode}
              activeProjectId={route.projectId}
              onNavigate={navigate}
            />
          ) : route.kind === 'redirect' ? (
            null
          ) : (
            <MailView
              bootstrap={bootstrap}
              ready={ready}
              onAuthError={() => setBootstrap(prev => prev && { ...prev, authenticated: false })}
              onCreateTaskFromAudience={handleCreateTaskFromAudience}
            />
          )}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

import React, { useEffect, useState } from 'react';
import { Check, CircleAlert, Copy, KeyRound, LoaderCircle, Trash2, X } from 'lucide-react';
import { api, copyTextWithFallback } from '../feishu.js';

const Icon = ({ icon: Component, ...props }) => <Component size={18} strokeWidth={1.8} aria-hidden="true" {...props} />;

const SCOPE_LABELS = {
  'projects:read': '读取项目清单',
  'projects:write': '修改项目负责人与成员',
  'directory:read': '按工号或姓名查询在职成员',
  'tasks:read': '读取签收任务进度',
};

const EXPIRY_PRESETS = [
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天' },
  { value: '365', label: '1 年' },
  { value: 'never', label: '永久' },
  { value: 'custom', label: '自定义' },
];

function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function addDays(days) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

export function TokensView({ ready }) {
  const [tokens, setTokens] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('90');
  const [customExpiry, setCustomExpiry] = useState('');
  const [pickedScopes, setPickedScopes] = useState(['projects:read']);
  const [saving, setSaving] = useState(false);
  const [createdToken, setCreatedToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState('');

  async function loadTokens() {
    if (!ready) return;
    setLoading(true);
    setError('');
    try {
      const res = await api('/api/ops/tokens');
      setTokens(Array.isArray(res.tokens) ? res.tokens : []);
      setScopes(Array.isArray(res.scopes) ? res.scopes : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTokens();
  }, [ready]);

  function toggleScope(scope) {
    setPickedScopes(current => current.includes(scope) ? current.filter(item => item !== scope) : [...current, scope]);
  }

  async function handleCreate(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const expiresAt = expiry === 'never'
        ? ''
        : expiry === 'custom'
          ? customExpiry
          : addDays(Number(expiry));
      const res = await api('/api/ops/tokens', { name: name.trim(), scopes: pickedScopes, expiresAt });
      setCreatedToken(res.token);
      setCopied(false);
      setName('');
      setPickedScopes(['projects:read']);
      setExpiry('90');
      setCustomExpiry('');
      setShowForm(false);
      await loadTokens();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    const res = await copyTextWithFallback(createdToken);
    setCopied(res.ok);
    if (!res.ok && res.message) setError(res.message);
  }

  async function handleRevoke(token) {
    if (!window.confirm(`停用令牌「${token.name}」？停用后立即不可用。`)) return;
    setBusyId(String(token.id));
    setError('');
    try {
      const res = await api(`/api/ops/tokens/${token.id}/revoke`, {});
      setTokens(Array.isArray(res.tokens) ? res.tokens : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  async function handleDelete(token) {
    if (!window.confirm(`删除令牌「${token.name}」？删除后无法恢复。`)) return;
    setBusyId(String(token.id));
    setError('');
    try {
      const res = await api(`/api/ops/tokens/${token.id}`, undefined, { method: 'DELETE' });
      setTokens(Array.isArray(res.tokens) ? res.tokens : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <>
      <div className="section-heading">
        <h2>API 令牌</h2>
        <button type="button" className="button primary" disabled={!ready} onClick={() => setShowForm(v => !v)}>
          <Icon icon={KeyRound} size={15} />
          {showForm ? '收起' : '新建令牌'}
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

      {createdToken && (
        <div className="notice auth-notice" role="status">
          <Icon icon={KeyRound} />
          <span>
            <strong>令牌只显示这一次，请立即复制保存。</strong>
            <code className="mono-data token-plain">{createdToken}</code>
          </span>
          <button type="button" className={`button ${copied ? 'success-button' : 'primary'}`} onClick={handleCopy}>
            <Icon icon={copied ? Check : Copy} size={15} />
            {copied ? '已复制' : '复制令牌'}
          </button>
          <button type="button" className="icon-button" onClick={() => setCreatedToken('')} aria-label="关闭令牌提示">
            <Icon icon={X} size={16} />
          </button>
        </div>
      )}

      {showForm && (
        <form className="surface-box create-task-form" onSubmit={handleCreate}>
          <div className="section-heading">
            <h2>新建令牌</h2>
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="token-name">名称</label>
            <input
              id="token-name"
              className="text-input"
              required
              maxLength={80}
              placeholder="例如：人事系统同步"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="form-grid-two">
            <div>
              <label className="form-label" htmlFor="token-expiry">有效期</label>
              <select id="token-expiry" className="select-input" value={expiry} onChange={e => setExpiry(e.target.value)}>
                {EXPIRY_PRESETS.map(preset => (
                  <option key={preset.value} value={preset.value}>{preset.label}</option>
                ))}
              </select>
            </div>
            {expiry === 'custom' && (
              <div>
                <label className="form-label" htmlFor="token-custom-expiry">到期日期</label>
                <input
                  id="token-custom-expiry"
                  className="text-input"
                  type="date"
                  required
                  value={customExpiry}
                  onChange={e => setCustomExpiry(e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="form-field">
            <label className="form-label">权限范围</label>
            <div className="chips scope-chips">
              {scopes.map(scope => {
                const active = pickedScopes.includes(scope);
                return (
                  <label className={`chip scope-choice ${active ? 'department-chip' : ''}`} key={scope}>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleScope(scope)}
                    />
                    <span>{SCOPE_LABELS[scope] || scope}</span>
                    <code>{scope}</code>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="form-actions-right">
            <button type="button" className="button ghost-button" onClick={() => setShowForm(false)}>取消</button>
            <button type="submit" className="button primary" disabled={saving || !pickedScopes.length}>
              <Icon icon={saving ? LoaderCircle : KeyRound} size={15} className={saving ? 'spin' : ''} />
              {saving ? '正在创建…' : '创建令牌'}
            </button>
          </div>
        </form>
      )}

      <section className="surface-box tasks-list-surface">
        <div className="section-heading">
          <h2>
            令牌
            <span className="count-label">{tokens.length}</span>
          </h2>
          <button type="button" className="text-button" disabled={loading || !ready} onClick={loadTokens}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>

        {loading && !tokens.length ? (
          <div className="loading-box">
            <Icon icon={LoaderCircle} size={24} className="spin" />
            <span>正在读取…</span>
          </div>
        ) : tokens.length === 0 ? (
          <div className="result-empty compact-empty">
            <h3>还没有令牌</h3>
          </div>
        ) : (
          <div className="task-rows">
            {tokens.map(token => (
              <div className="task-row" key={token.id}>
                <div className="task-row-main">
                  <div className="task-row-title">
                    <strong>{token.name}</strong>
                    <code>{token.prefix}</code>
                    <span className={`badge ${token.usable ? 'status-active' : 'status-closed'}`}>
                      {token.usable ? '可用' : token.revokedAt ? '已停用' : '已过期'}
                    </span>
                  </div>
                  <div className="task-row-meta">
                    <span>{token.scopes.join(' · ')}</span>
                    <span>·</span>
                    <span>到期：{token.expiresAt ? formatDate(token.expiresAt) : '永久'}</span>
                    <span>·</span>
                    <span>最近使用：{token.lastUsedAt ? formatDate(token.lastUsedAt) : '从未'}</span>
                  </div>
                </div>
                <div className="task-row-actions">
                  {token.usable && (
                    <button
                      type="button"
                      className="button ghost-button"
                      disabled={busyId === String(token.id)}
                      onClick={() => handleRevoke(token)}
                    >
                      停用
                    </button>
                  )}
                  <button
                    type="button"
                    className="button danger-button"
                    disabled={busyId === String(token.id)}
                    onClick={() => handleDelete(token)}
                  >
                    <Icon icon={Trash2} size={15} />
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

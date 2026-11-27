import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Copy,
  FileCheck2,
  FileText,
  FolderTree,
  LoaderCircle,
  Mail,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { api, chooseFeishuContacts, copyTextWithFallback } from '../feishu.js';
import { DemoPicker, navigateTabs } from '../components/DemoPicker.jsx';

const unique = values => [...new Set(values)];
export const parseNumbers = text => unique(text.split(/\r?\n/).map(value => value.trim()).filter(Boolean));
const Icon = ({ icon: Component, ...props }) => <Component size={18} strokeWidth={1.8} aria-hidden="true" {...props} />;

export function MailView({ bootstrap, ready, onAuthError, onCreateTaskFromAudience }) {
  const [mode, setMode] = useState('numbers');
  const [text, setText] = useState('');
  const [selected, setSelected] = useState({ users: [], departments: [] });
  const [includeChildren, setIncludeChildren] = useState(true);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [details, setDetails] = useState('issues');

  const output = useRef(null);
  const copyTimer = useRef(null);
  const resultHeading = useRef(null);

  const demo = bootstrap?.mode === 'demo';
  const numbers = parseNumbers(text);
  const maxNumbers = bootstrap?.limits?.employeeNumbers || 1000;
  const overLimit = numbers.length > maxNumbers;
  const inputCount = mode === 'numbers' ? numbers.length : selected.users.length + selected.departments.length;
  const limitSelected = selected.users.length > 1000 || selected.departments.length > 100;

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  function invalidate() {
    setResult(null);
    setCopied(false);
    setCopyError('');
    setError('');
  }

  function fail(err) {
    setError(err.message);
    if (err.status === 401) {
      setResult(null);
      onAuthError?.();
    }
  }

  async function choose() {
    if (demo) return setPicker(true);
    setPicking(true);
    setError('');
    try {
      const next = await chooseFeishuContacts(selected.users);
      if (next) {
        const departments = [...new Map([...selected.departments, ...next.departments].map(item => [item.id, item])).values()];
        setSelected({ users: [...new Map(next.users.map(item => [item.id, item])).values()], departments });
        invalidate();
      }
    } catch (err) {
      fail(err);
    } finally {
      setPicking(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!inputCount || busy || (overLimit && mode === 'numbers') || !ready) return;
    setBusy(true);
    invalidate();
    try {
      const next = mode === 'numbers'
        ? await api('/api/resolve/employee-numbers', { numbers })
        : await api('/api/resolve/selection', {
            userIds: selected.users.map(user => user.id),
            departmentIds: selected.departments.map(department => department.id),
            includeChildren,
          });
      setResult(next);
      setDetails(next.issues.length ? 'issues' : 'matched');
      requestAnimationFrame(() => resultHeading.current?.focus({ preventScroll: true }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    setCopyError('');
    const outcome = await copyTextWithFallback(result.text, output);
    if (outcome.ok) {
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } else {
      setCopyError(outcome.message);
    }
  }

  function removeSelection(kind, id) {
    setSelected(previous => ({ ...previous, [kind]: previous[kind].filter(item => item.id !== id) }));
    invalidate();
  }

  function handoffToTask() {
    if (mode === 'numbers' && numbers.length) {
      onCreateTaskFromAudience({
        scopeMode: 'numbers',
        numbersText: numbers.join('\n'),
        selected: { users: [], departments: [] },
        includeChildren: true,
      });
    } else if (mode === 'people' && (selected.users.length || selected.departments.length)) {
      onCreateTaskFromAudience({
        scopeMode: 'selection',
        numbersText: '',
        selected,
        includeChildren,
      });
    }
  }

  // Optical Split-Stream Beam Geometry (1000-unit coordinate space, zero inline CSS)
  const resolvedTotal = result ? Math.max(1, result.emails.length + result.issues.length) : 1;
  const gapUnits = result && result.emails.length > 0 && result.issues.length > 0 ? 6 : 0;
  const validWidth = result
    ? Math.round(((1000 - gapUnits) * result.emails.length) / resolvedTotal)
    : 0;
  const issueWidth = result
    ? Math.max(0, 1000 - gapUnits - validWidth) * (result.issues.length > 0 ? 1 : 0)
    : 0;
  const standbyWidth = !result && inputCount > 0
    ? Math.min(1000, Math.max(140, inputCount * 90))
    : 0;
  const inactiveHitCount = result
    ? result.issues.filter(item => item.reason === 'resigned' || item.reason === 'disabled').length
    : 0;
  const activeMatchedCount = result ? Math.max(0, result.stats.people - inactiveHitCount) : 0;

  const matchedNos = result?.matched?.map(item => item.employeeNo).filter(Boolean) || [];
  const matchedRange = matchedNos.length > 1
    ? `${matchedNos[0]} – ${matchedNos[matchedNos.length - 1]}`
    : matchedNos[0] || '';

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>邮件地址整理</h1>
          <p>按员工工号或部门提取在职成员企业邮箱，自动去重并拦截离职、冻结及缺失信箱账号。</p>
        </div>
        <div className="privacy-note">
          <Icon icon={ShieldCheck} size={15} />
          <span>不保存邮箱查询历史</span>
        </div>
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

      <section
        className="beam-panel"
        aria-label="通讯录邮箱解析分束状态"
      >
        {result ? (
          <div className="beam-metrics beam-metrics--four" role="status">
            <div className="beam-node">
              <span className="beam-node-value">{result.stats.requested}</span>
              <span className="beam-node-label">输入源项数</span>
            </div>
            <div className="beam-node">
              <span className="beam-node-value beam-node-value--cobalt">{activeMatchedCount}</span>
              <span className="beam-node-label">在职成员匹配</span>
            </div>
            <button
              type="button"
              className={`beam-node ${details === 'matched' ? 'beam-node--active' : ''}`}
              onClick={() => setDetails('matched')}
            >
              <span className="beam-node-value beam-node-value--emerald">{result.emails.length}</span>
              <span className="beam-node-label">有效企业邮箱</span>
            </button>
            <button
              type="button"
              className={`beam-node ${details === 'issues' ? 'beam-node--active' : ''}`}
              onClick={() => setDetails('issues')}
            >
              <span className={`beam-node-value ${result.issues.length > 0 ? 'beam-node-value--amber' : ''}`}>
                {result.issues.length}
              </span>
              <span className="beam-node-label">异常与剔除项</span>
            </button>
          </div>
        ) : (
          <div className="beam-metrics beam-metrics--three">
            <div className="beam-node">
              <span className="beam-node-value beam-node-value--cobalt">{inputCount}</span>
              <span className="beam-node-label">
                {mode === 'numbers' ? '待核验去重工号' : '已选部门与成员项'}
              </span>
            </div>
            <div className="beam-node">
              <span className="beam-node-value">{mode === 'numbers' ? '1:1' : includeChildren ? '递归' : '直属'}</span>
              <span className="beam-node-label">
                {mode === 'numbers' ? '严格工号精确匹配' : includeChildren ? '展开全部子部门去重' : '仅当前所选层级'}
              </span>
            </div>
            <div className="beam-node">
              <span className="beam-node-value">{busy ? '解析中' : '待命'}</span>
              <span className="beam-node-label">仅输出有效企业邮箱</span>
            </div>
          </div>
        )}
        <div className="beam-track" aria-hidden="true">
          <svg className="beam-svg" viewBox="0 0 1000 6" preserveAspectRatio="none">
            <rect className="beam-seg-cobalt" x="0" y="0" width={result ? 0 : standbyWidth} height="6" />
            <rect className="beam-seg-emerald" x="0" y="0" width={result ? validWidth : 0} height="6" />
            <rect
              className="beam-seg-amber"
              x={result ? validWidth + gapUnits : 0}
              y="0"
              width={result ? issueWidth : 0}
              height="6"
            />
          </svg>
          {result && (
            <div className="beam-scale">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          )}
        </div>
      </section>

      <div className="workspace" aria-busy={busy}>
        <section className={`input-panel ${!result ? 'optical-surface' : ''}`} aria-labelledby="input-title">
          <div className="section-heading">
            <h2 id="input-title">选择查询方式</h2>
            <span className="section-note">与分发确认共享通讯录范围</span>
          </div>
          <div className="mode-tabs" role="tablist" onKeyDown={navigateTabs} aria-label="查询方式">
            <button
              type="button"
              role="tab"
              id="tab-numbers"
              aria-controls="input-content"
              aria-selected={mode === 'numbers'}
              disabled={busy || picking}
              onClick={() => { setMode('numbers'); invalidate(); }}
            >
              <Icon icon={FileText} size={16} />
              按工号查询
            </button>
            <button
              type="button"
              role="tab"
              id="tab-people"
              aria-controls="input-content"
              aria-selected={mode === 'people'}
              disabled={busy || picking}
              onClick={() => { setMode('people'); invalidate(); }}
            >
              <Icon icon={Users} size={16} />
              选择成员 / 部门
            </button>
          </div>
          <form onSubmit={submit} id="input-content" role="tabpanel" aria-labelledby={mode === 'numbers' ? 'tab-numbers' : 'tab-people'}>
            {mode === 'numbers' ? (
              <>
                <div className="field-heading">
                  <label htmlFor="employee-numbers">工号列表</label>
                  {demo && (
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy}
                      onClick={() => { setText('E1001\nE1002\nE1003\nE1004\nE1007'); invalidate(); }}
                    >
                      填入示例工号
                    </button>
                  )}
                </div>
                <p className="field-hint" id="numbers-hint">
                  一行一个，最多 {maxNumbers.toLocaleString()} 个，自动去除首尾空格与重复项。
                </p>
                <textarea
                  id="employee-numbers"
                  className="number-input"
                  placeholder={'在此粘贴工号，例如：\nE1001\nE1002\nE1004'}
                  value={text}
                  onChange={event => { setText(event.target.value); invalidate(); }}
                  disabled={busy}
                  aria-describedby="numbers-hint input-count"
                  aria-invalid={overLimit}
                  spellCheck={false}
                  maxLength={64000}
                />
                <div className="input-meta">
                  <span id="input-count" className={overLimit ? 'error-text' : ''}>
                    已输入 <strong>{numbers.length}</strong> 个不同工号{overLimit && `，请减少至 ${maxNumbers} 个以内`}
                  </span>
                  <button className="text-button" type="button" disabled={!text || busy} onClick={() => { setText(''); invalidate(); }}>
                    清空
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="field-heading">
                  <label>成员与部门</label>
                  {inputCount > 0 && (
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy || picking}
                      onClick={() => { setSelected({ users: [], departments: [] }); invalidate(); }}
                    >
                      清空选择
                    </button>
                  )}
                </div>
                <p className="field-hint">可同时选择多个成员和部门，交叉重复人员只计一次。</p>
                <button type="button" className="choose-button" onClick={choose} disabled={!ready || busy || picking}>
                  <Icon icon={picking ? LoaderCircle : Users} size={16} className={picking ? 'spin' : ''} />
                  <span>{picking ? '正在打开选择器…' : demo ? '打开演示通讯录' : '打开飞书成员选择器'}</span>
                  <Icon icon={ChevronRight} size={16} />
                </button>
                <div className={`selection-area ${inputCount ? 'has-selection' : ''}`}>
                  {!inputCount ? (
                    <div className="selection-empty">
                      <Icon icon={FolderTree} size={26} />
                      <span>还没有选择成员或部门</span>
                      <small>选定部门后，服务端会自动展开在职成员名单</small>
                    </div>
                  ) : (
                    <>
                      {selected.departments.length > 0 && (
                        <div className="selected-group">
                          <span className="selected-label">部门 · {selected.departments.length}</span>
                          <div className="chips">
                            {selected.departments.map(item => (
                              <span className="chip department-chip" key={item.id}>
                                <Icon icon={FolderTree} size={13} />
                                <span title={item.name}>{item.name}</span>
                                <button
                                  type="button"
                                  disabled={busy || picking}
                                  onClick={() => removeSelection('departments', item.id)}
                                  aria-label={`移除部门 ${item.name}`}
                                >
                                  <Icon icon={X} size={13} />
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {selected.users.length > 0 && (
                        <div className="selected-group">
                          <span className="selected-label">成员 · {selected.users.length}</span>
                          <div className="chips">
                            {selected.users.map(item => (
                              <span className="chip" key={item.id}>
                                <span title={item.name}>{item.name}</span>
                                <button
                                  type="button"
                                  disabled={busy || picking}
                                  onClick={() => removeSelection('users', item.id)}
                                  aria-label={`移除成员 ${item.name}`}
                                >
                                  <Icon icon={X} size={13} />
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={includeChildren}
                    disabled={busy}
                    onChange={event => { setIncludeChildren(event.target.checked); invalidate(); }}
                  />
                  <span>包含所选部门的全部子部门</span>
                </label>
                {!demo && <p className="field-hint">已选部门会保留；如需取消，请点击上方部门标签的移除按钮。</p>}
                {limitSelected && <p className="error-text" role="alert">最多选择 1,000 位成员和 100 个部门，请减少选择。</p>}
              </>
            )}
            <button
              className={`button ${result ? 'secondary' : 'primary'} submit-button`}
              type="submit"
              disabled={!ready || !inputCount || busy || picking || (mode === 'numbers' ? overLimit : limitSelected)}
            >
              <Icon icon={busy ? LoaderCircle : Search} size={16} className={busy ? 'spin' : ''} />
              {busy ? '正在查询通讯录…' : '查询企业邮箱'}
              {!busy && <Icon icon={ArrowRight} size={16} />}
            </button>
            <p className="input-footnote">
              <Icon icon={ShieldCheck} size={14} />
              仅查询应用获准访问的通讯录范围，自动剔除离职与冻结成员
            </p>
          </form>
        </section>

        <section
          className={`result-panel ${result ? 'optical-surface optical-surface--emerald' : ''}`}
          aria-labelledby="result-title"
        >
          <div className="section-heading">
            <h2 id="result-title" ref={resultHeading} tabIndex={-1}>
              邮箱集合{result && <span className="count-label">{result.emails.length}</span>}
            </h2>
            <span className="section-note">去重 · 空格分隔</span>
          </div>
          {!result ? (
            <div className="result-empty" aria-live="polite">
              <div className="empty-symbol">
                <Icon icon={busy ? LoaderCircle : Mail} size={26} className={busy ? 'spin' : ''} />
              </div>
              <h3>{busy ? '正在整理企业邮箱' : '解析后的企业邮箱将在此输出'}</h3>
              <p>左侧输入工号或选择飞书部门后点击查询，可直接复制至邮件收件人栏，或一键转为确认任务。</p>
              <div className="format-example">
                <span>输出格式示例</span>
                <code>lin.xiao@example.com chen.yu@example.com</code>
              </div>
            </div>
          ) : (
            <>
              <div className="output-wrap">
                <label htmlFor="email-output" className="sr-only">空格分隔的邮箱集合</label>
                <textarea
                  id="email-output"
                  ref={output}
                  readOnly
                  value={result.text}
                  placeholder="没有可导出的企业邮箱，请查看下方明细。"
                  spellCheck={false}
                />
              </div>
              <div className="copy-row">
                <button
                  type="button"
                  className="button secondary"
                  onClick={handoffToTask}
                  disabled={!result.matched.length}
                >
                  <Icon icon={FileCheck2} size={16} />
                  以此范围新建确认任务
                </button>
                <button
                  type="button"
                  className={`button ${copied ? 'success-button' : 'primary'}`}
                  onClick={copy}
                  disabled={!result.emails.length}
                >
                  <Icon icon={copied ? Check : Copy} size={16} />
                  {copied ? '已复制邮箱' : `复制邮箱 (${result.emails.length})`}
                </button>
              </div>
              <span className="sr-only" role="status">{copied ? '邮箱集合已复制到剪贴板' : ''}</span>
              {copyError && <p className="copy-error" role="alert">{copyError}</p>}
              {result.issues.length > 0 && (
                <div className="result-warning">
                  <Icon icon={CircleAlert} size={16} />
                  <span><strong>{result.issues.length} 项需要留意的异常</strong>，未包含在上方邮箱集合中。</span>
                </div>
              )}
              <div className="detail-header">
                <div className="detail-tabs" role="tablist" onKeyDown={navigateTabs} aria-label="查询结果明细">
                  <button
                    type="button"
                    role="tab"
                    id="detail-issues"
                    aria-selected={details === 'issues'}
                    aria-controls="detail-content"
                    onClick={() => setDetails('issues')}
                  >
                    异常项 <span>{result.issues.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    id="detail-matched"
                    aria-selected={details === 'matched'}
                    aria-controls="detail-content"
                    onClick={() => setDetails('matched')}
                  >
                    已匹配 <span>{result.matched.length}</span>
                  </button>
                </div>
                {details === 'matched' && matchedRange && (
                  <span className="range-readout">{matchedRange}</span>
                )}
              </div>
              <div className="detail-list" id="detail-content" role="tabpanel" aria-labelledby={`detail-${details}`}>
                {details === 'issues' ? (
                  result.issues.length ? (
                    result.issues.map((issue, index) => (
                      <div className="issue-row" key={`${issue.key}-${index}`}>
                        <Icon icon={CircleAlert} size={16} />
                        <div>
                          <strong>{issue.name || issue.key}</strong>
                          {issue.name && <code>{issue.key}</code>}
                          <p>{issue.message}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="details-clear">
                      <Icon icon={CheckCheck} />
                      <span>全部输入均已正常匹配在职企业邮箱</span>
                    </div>
                  )
                ) : result.matched.length ? (
                  result.matched.map(person => (
                    <div className="matched-row" key={person.id}>
                      <div>
                        <strong>{person.name || person.employeeNo || '成员'}</strong>
                        <code>{person.employeeNo}</code>
                      </div>
                      <span className="mono-data">{person.email}</span>
                    </div>
                  ))
                ) : (
                  <p className="no-matches">没有匹配到可用的企业邮箱。</p>
                )}
              </div>
              <p className="scope-note">{result.scopeNote}</p>
            </>
          )}
        </section>
      </div>

      {picker && (
        <DemoPicker
          contacts={bootstrap.demoContacts || []}
          departments={bootstrap.demoDepartments || []}
          selected={selected}
          onClose={() => setPicker(false)}
          onConfirm={next => {
            setSelected(next);
            setPicker(false);
            invalidate();
          }}
        />
      )}
    </>
  );
}

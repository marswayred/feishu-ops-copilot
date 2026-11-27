import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  CircleAlert,
  FilePlus2,
  FolderTree,
  LoaderCircle,
  Pencil,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api } from '../feishu.js';
import { MemberPicker } from '../components/MemberPicker.jsx';
import { parseNumbers } from './MailView.jsx';

const Icon = ({ icon: Component, ...props }) => <Component size={18} strokeWidth={1.8} aria-hidden="true" {...props} />;

const emptyDraft = () => ({
  id: '',
  name: '',
  owner: null,
  members: [],
  departmentIds: [],
  departmentLabels: [],
  numbersText: '',
});

export function ProjectsView({ bootstrap, ready }) {
  const isAdmin = bootstrap?.user?.role === 'admin';
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [ownerPicker, setOwnerPicker] = useState(false);
  const [memberPicker, setMemberPicker] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [detail, setDetail] = useState(null);
  const [issues, setIssues] = useState([]);
  const [departmentsLoaded, setDepartmentsLoaded] = useState(false);
  const [showDeptPicker, setShowDeptPicker] = useState(false);
  const detailRef = useRef(null);

  async function loadProjects() {
    if (!ready) return;
    setLoading(true);
    setError('');
    try {
      const res = await api('/api/ops/projects');
      setProjects(Array.isArray(res.projects) ? res.projects : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, [ready]);

  async function loadDepartments() {
    if (departmentsLoaded) return;
    try {
      const res = await api('/api/ops/directory/departments', {});
      setDepartments(Array.isArray(res.departments) ? res.departments : []);
      setDepartmentsLoaded(true);
    } catch (err) {
      setError(err.message);
    }
  }

  function openCreate() {
    setDraft(emptyDraft());
    setIssues([]);
    setError('');
    setBanner('');
    loadDepartments();
  }

  async function openEdit(projectId) {
    setError('');
    setBanner('');
    try {
      const res = await api(`/api/ops/projects/${encodeURIComponent(projectId)}`);
      const project = res.project;
      setDraft({
        id: project.id,
        name: project.name,
        owner: project.owner,
        members: project.members,
        departmentIds: [],
        departmentLabels: [],
        numbersText: '',
      });
      setIssues([]);
      loadDepartments();
    } catch (err) {
      setError(err.message);
    }
  }

  async function openDetail(projectId) {
    setError('');
    try {
      const res = await api(`/api/ops/projects/${encodeURIComponent(projectId)}`);
      setDetail(res.project);
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' }));
    } catch (err) {
      setError(err.message);
    }
  }

  function addMembers(people) {
    setDraft(current => {
      const seen = new Set(current.members.map(member => member.openId));
      return { ...current, members: [...current.members, ...people.filter(person => !seen.has(person.openId))] };
    });
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!draft || saving) return;
    if (!draft.name.trim()) {
      setError('请填写项目名称。');
      return;
    }
    if (!draft.owner) {
      setError('请选择项目负责人。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: draft.name.trim(),
        ownerOpenId: draft.owner.openId,
        ownerName: draft.owner.name || '',
        ownerEmployeeNo: draft.owner.employeeNo || '',
        userIds: draft.members.map(member => member.openId),
        departmentIds: draft.departmentIds,
        departmentLabels: draft.departmentLabels,
        numbers: parseNumbers(draft.numbersText),
        includeChildren: true,
      };
      const res = draft.id
        ? await api(`/api/ops/projects/${encodeURIComponent(draft.id)}`, payload, { method: 'PUT' })
        : await api('/api/ops/projects', payload);
      setBanner(draft.id ? '项目已更新。' : '项目已创建。');
      setIssues(Array.isArray(res.issues) ? res.issues : []);
      setDraft(null);
      setDetail(res.project);
      await loadProjects();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(project) {
    if (!project?.id) return;
    if (!window.confirm(`删除项目「${project.name}」？仅删除本清单记录。`)) return;
    setDeletingId(project.id);
    setError('');
    try {
      await api(`/api/ops/projects/${encodeURIComponent(project.id)}`, undefined, { method: 'DELETE' });
      setProjects(current => current.filter(item => item.id !== project.id));
      setDetail(current => current?.id === project.id ? null : current);
      if (draft?.id === project.id) setDraft(null);
      setBanner('项目已删除。');
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId('');
    }
  }

  function toggleDepartment(department) {
    setDraft(current => {
      const exists = current.departmentIds.includes(department.id);
      return {
        ...current,
        departmentIds: exists
          ? current.departmentIds.filter(id => id !== department.id)
          : [...current.departmentIds, department.id],
        departmentLabels: exists
          ? current.departmentLabels.filter(item => item.id !== department.id)
          : [...current.departmentLabels, department],
      };
    });
  }

  const ownerOnly = draft?.owner ? [draft.owner] : [];

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>项目清单</h1>
        </div>
        <button
          type="button"
          className="button primary"
          disabled={!ready || !isAdmin || Boolean(draft)}
          onClick={openCreate}
        >
          <Icon icon={FilePlus2} size={16} />
          新建项目
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
          <Icon icon={Check} />
          <span>{banner}</span>
          <button type="button" className="icon-button" onClick={() => setBanner('')} aria-label="关闭提示">
            <Icon icon={X} size={16} />
          </button>
        </div>
      )}

      {draft && (
        <form className="surface-box create-task-form" onSubmit={handleSave}>
          <div className="section-heading">
            <h2>{draft.id ? '编辑项目' : '新建项目'}</h2>
            <button type="button" className="text-button" onClick={() => { setDraft(null); setIssues([]); }}>
              收起
            </button>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="project-name">项目名称</label>
            <input
              id="project-name"
              className="text-input"
              required
              maxLength={80}
              value={draft.name}
              onChange={e => setDraft(current => ({ ...current, name: e.target.value }))}
            />
          </div>

          <div className="form-field">
            <label className="form-label">项目负责人</label>
            <button type="button" className="choose-button" onClick={() => setOwnerPicker(true)}>
              <Icon icon={Users} size={16} />
              <span>{draft.owner ? `${draft.owner.name}${draft.owner.employeeNo ? ` ${draft.owner.employeeNo}` : ''}` : '从通讯录选择'}</span>
              <Icon icon={ChevronRight} />
            </button>
            {draft.owner && (
              <div className="chips scope-chips">
                <span className="chip">
                  <span>{draft.owner.name}</span>
                  <button type="button" onClick={() => setDraft(current => ({ ...current, owner: null }))} aria-label={`移除负责人 ${draft.owner.name}`}>
                    <Icon icon={X} size={13} />
                  </button>
                </span>
              </div>
            )}
          </div>

          <div className="form-field">
            <label className="form-label">项目成员</label>
            <div className="copy-row">
              <button type="button" className="choose-button" onClick={() => setMemberPicker(true)}>
                <Icon icon={Users} size={16} />
                <span>从通讯录选择成员</span>
                <Icon icon={ChevronRight} />
              </button>
              <button type="button" className="button ghost-button" onClick={() => setShowDeptPicker(v => !v)}>
                <Icon icon={FolderTree} size={15} />
                选择部门
              </button>
            </div>

            {showDeptPicker && (
              <div className="scope-subpanel">
                {departments.length ? (
                  <div className="chips scope-chips">
                    {departments.map(department => {
                      const active = draft.departmentIds.includes(department.id);
                      return (
                        <button
                          key={department.id}
                          type="button"
                          className={`chip ${active ? 'department-chip' : ''}`}
                          onClick={() => toggleDepartment(department)}
                          aria-pressed={active}
                        >
                          <span>{department.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="no-matches">暂未读取到可选择的部门。</p>
                )}
              </div>
            )}

            {(draft.departmentLabels.length > 0 || draft.members.length > 0) && (
              <div className="chips scope-chips">
                {draft.departmentLabels.map(department => (
                  <span className="chip department-chip" key={department.id}>
                    <Icon icon={FolderTree} size={13} />
                    <span>{department.name}</span>
                    <button type="button" onClick={() => toggleDepartment(department)} aria-label={`移除部门 ${department.name}`}>
                      <Icon icon={X} size={13} />
                    </button>
                  </span>
                ))}
                {draft.members.map(member => (
                  <span className="chip" key={member.openId}>
                    <span>{member.name}{member.employeeNo ? ` ${member.employeeNo}` : ''}</span>
                    <button
                      type="button"
                      onClick={() => setDraft(current => ({
                        ...current,
                        members: current.members.filter(item => item.openId !== member.openId),
                      }))}
                      aria-label={`移除成员 ${member.name}`}
                    >
                      <Icon icon={X} size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="form-field">
              <label className="form-label" htmlFor="project-numbers">按工号批量导入</label>
              <textarea
                id="project-numbers"
                className="number-input compact-number-input"
                placeholder={'一行一个工号，例如：\nE1001\nE1002'}
                value={draft.numbersText}
                onChange={e => setDraft(current => ({ ...current, numbersText: e.target.value }))}
                spellCheck={false}
              />
            </div>
          </div>

          {issues.length > 0 && (
            <div className="result-warning">
              <Icon icon={CircleAlert} size={17} />
              <span>{issues.length} 条未加入：{issues.slice(0, 4).map(issue => `${issue.key}（${issue.message}）`).join('；')}</span>
            </div>
          )}

          <div className="form-actions-right">
            <button type="button" className="button ghost-button" onClick={() => { setDraft(null); setIssues([]); }}>
              取消
            </button>
            <button type="submit" className="button primary" disabled={saving}>
              <Icon icon={saving ? LoaderCircle : Check} size={16} className={saving ? 'spin' : ''} />
              {saving ? '正在保存…' : '保存'}
            </button>
          </div>
        </form>
      )}

      <section className="surface-box tasks-list-surface" aria-labelledby="projects-list-heading">
        <div className="section-heading">
          <h2 id="projects-list-heading">
            项目
            <span className="count-label">{projects.length}</span>
          </h2>
          <button type="button" className="text-button" disabled={loading || !ready} onClick={loadProjects}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>

        {loading && !projects.length ? (
          <div className="loading-box">
            <Icon icon={LoaderCircle} size={24} className="spin" />
            <span>正在读取…</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="result-empty compact-empty">
            <h3>还没有项目</h3>
          </div>
        ) : (
          <div className="task-rows">
            {projects.map(item => (
              <div className="task-row" key={item.id}>
                <div className="task-row-main">
                  <div className="task-row-title">
                    <button type="button" className="task-title-link" onClick={() => openDetail(item.id)}>
                      {item.name}
                    </button>
                  </div>
                  <div className="task-row-meta">
                    <span>负责人：{item.owner?.name || '未设置'}{item.owner?.employeeNo ? `（${item.owner.employeeNo}）` : ''}</span>
                    <span>·</span>
                    <span>成员：{item.memberCount} 人</span>
                  </div>
                </div>
                <div className="task-row-actions">
                  {isAdmin && (
                    <button type="button" className="button ghost-button" onClick={() => openEdit(item.id)}>
                      <Icon icon={Pencil} size={15} />
                      编辑
                    </button>
                  )}
                  <button type="button" className="button primary" onClick={() => openDetail(item.id)}>
                    查看
                    <Icon icon={ChevronRight} size={15} />
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      className="button danger-button"
                      disabled={deletingId === item.id}
                      onClick={() => handleDelete(item)}
                    >
                      <Icon icon={Trash2} size={15} />
                      {deletingId === item.id ? '正在删除…' : '删除'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {detail && (
        <section className="surface-box task-detail-surface" ref={detailRef} aria-labelledby="project-detail-heading">
          <div className="section-heading">
            <h2 id="project-detail-heading">{detail.name}</h2>
            <button type="button" className="text-button" onClick={() => setDetail(null)}>关闭</button>
          </div>
          <p className="task-meta-line">
            负责人：{detail.owner?.name || '未设置'}
            {detail.owner?.employeeNo ? `（${detail.owner.employeeNo}）` : ''}
            {` · 成员：${detail.memberCount} 人`}
            {` · 更新于 ${detail.updatedAt?.slice(0, 19).replace('T', ' ') || '—'}`}
          </p>
          {detail.members.length ? (
            <div className="ledger-table-wrap">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>工号</th>
                    <th>部门</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.members.map(member => (
                    <tr key={member.openId}>
                      <td><strong>{member.name}</strong></td>
                      <td><code>{member.employeeNo || '—'}</code></td>
                      <td>{member.departmentNames || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="no-matches">这个项目还没有成员。</p>
          )}
        </section>
      )}

      {ownerPicker && draft && (
        <MemberPicker
          mode="single"
          title="选择项目负责人"
          selected={ownerOnly}
          onClose={() => setOwnerPicker(false)}
          onConfirm={people => {
            setDraft(current => ({
              ...current,
              owner: people[0] || null,
              members: current.members.filter(member => member.openId !== people[0]?.openId),
            }));
            setOwnerPicker(false);
          }}
        />
      )}

      {memberPicker && draft && (
        <MemberPicker
          selected={draft.members}
          onClose={() => setMemberPicker(false)}
          onConfirm={people => {
            const filtered = people.filter(person => person.openId !== draft.owner?.openId);
            setDraft(current => ({ ...current, members: filtered }));
            setMemberPicker(false);
          }}
        />
      )}
    </>
  );
}

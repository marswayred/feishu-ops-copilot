import React, { useEffect, useRef, useState } from 'react';
import { Check, FolderTree, Search, X } from 'lucide-react';

const Icon = ({ icon: Component, ...props }) => <Component size={18} strokeWidth={1.8} aria-hidden="true" {...props} />;

export function navigateTabs(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]:not(:disabled)')];
  if (!tabs.length) return;
  const index = tabs.indexOf(document.activeElement);
  const next = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}

export function DemoPicker({ contacts, departments, selected, onClose, onConfirm }) {
  const dialog = useRef(null);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState(selected.users.map(item => item.id));
  const [depts, setDepts] = useState(selected.departments.map(item => item.id));

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const toggle = (value, list, set) => {
    set(list.includes(value) ? list.filter(item => item !== value) : [...list, value]);
  };

  const q = query.trim().toLocaleLowerCase();
  const shownUsers = contacts.filter(user => `${user.name} ${user.employee_no}`.toLocaleLowerCase().includes(q));
  const shownDepartments = departments.filter(department => department.name.toLocaleLowerCase().includes(q));

  return (
    <dialog ref={dialog} className="picker-dialog" aria-labelledby="picker-title" onCancel={onClose}>
      <div className="dialog-heading">
        <div>
          <h2 id="picker-title">选择成员或部门</h2>
          <p>演示通讯录 · 含在职、缺失邮箱与离职状态样本</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭选择器">
          <Icon icon={X} />
        </button>
      </div>
      <div className="picker-search">
        <Icon icon={Search} />
        <input
          autoFocus
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="搜索姓名、工号或部门"
          aria-label="搜索演示通讯录"
        />
      </div>
      <div className="picker-list">
        {shownDepartments.length > 0 && (
          <>
            <h3>部门</h3>
            {shownDepartments.map(department => (
              <label className="picker-row" key={department.open_department_id}>
                <input
                  type="checkbox"
                  checked={depts.includes(department.open_department_id)}
                  onChange={() => toggle(department.open_department_id, depts, setDepts)}
                />
                <Icon icon={FolderTree} />
                <span>
                  {department.name}
                  <small>{department.parent_department_id && department.parent_department_id !== '0' ? '子部门' : '一级部门'}</small>
                </span>
              </label>
            ))}
          </>
        )}
        {shownUsers.length > 0 && (
          <>
            <h3>成员</h3>
            {shownUsers.map(user => {
              const resigned = user.status?.is_resigned === true;
              return (
                <label className="picker-row" key={user.open_id}>
                  <input
                    type="checkbox"
                    checked={users.includes(user.open_id)}
                    onChange={() => toggle(user.open_id, users, setUsers)}
                  />
                  <span className="avatar" aria-hidden="true">{user.name.slice(-2)}</span>
                  <span>
                    {user.name}
                    <small>
                      {user.employee_no}
                      {resigned ? ' · 已离职' : !user.enterprise_email ? ' · 未配置企业邮箱' : ''}
                    </small>
                  </span>
                </label>
              );
            })}
          </>
        )}
        {!shownDepartments.length && !shownUsers.length && (
          <p className="no-matches">没有找到匹配项，试试其他姓名或工号。</p>
        )}
      </div>
      <div className="dialog-footer">
        <span>已选 {users.length} 人、{depts.length} 个部门</span>
        <button
          type="button"
          className="button primary"
          onClick={() => onConfirm({
            users: contacts.filter(user => users.includes(user.open_id)).map(user => ({ id: user.open_id, name: user.name })),
            departments: departments.filter(department => depts.includes(department.open_department_id)).map(department => ({ id: department.open_department_id, name: department.name })),
          })}
        >
          确认选择
          <Icon icon={Check} />
        </button>
      </div>
    </dialog>
  );
}

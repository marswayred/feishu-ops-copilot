import React, { useEffect, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { api } from '../feishu.js';

const Icon = ({ icon: Component, ...props }) => <Component size={18} strokeWidth={1.8} aria-hidden="true" {...props} />;

export function MemberPicker({ selected = [], mode = 'multiple', title = '从通讯录选择', onClose, onConfirm }) {
  const dialog = useRef(null);
  const single = mode === 'single';
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState([]);
  const [picked, setPicked] = useState(selected);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const result = await api('/api/ops/directory/people', { query });
        setPeople(Array.isArray(result.people) ? result.people : []);
      } catch (err) {
        setError(err.message);
        setPeople([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  function toggle(person) {
    if (single) {
      setPicked([person]);
      return;
    }
    setPicked(current => (
      current.some(item => item.openId === person.openId)
        ? current.filter(item => item.openId !== person.openId)
        : [...current, person]
    ));
  }

  return (
    <dialog ref={dialog} className="picker-dialog" aria-labelledby="member-picker-title" onCancel={onClose}>
      <div className="dialog-heading">
        <h2 id="member-picker-title">{title}</h2>
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
          aria-label="搜索通讯录"
        />
      </div>
      <div className="picker-list">
        {error && <p className="no-matches">{error}</p>}
        {loading && !people.length && !error && <p className="no-matches">正在读取通讯录…</p>}
        {!loading && !error && !people.length && <p className="no-matches">没有找到匹配的在职成员。</p>}
        {people.map(person => (
          <label className="picker-row" key={person.openId}>
            <input
              type={single ? 'radio' : 'checkbox'}
              name={single ? 'member-single' : undefined}
              checked={picked.some(item => item.openId === person.openId)}
              onChange={() => toggle(person)}
            />
            <span className="avatar" aria-hidden="true">{(person.name || '成员').slice(-2)}</span>
            <span>
              {person.name}
              <small>
                {[person.employeeNo, person.departmentNames].filter(Boolean).join(' · ')}
              </small>
            </span>
          </label>
        ))}
      </div>
      <div className="dialog-footer">
        <span>{single ? (picked[0] ? `已选 ${picked[0].name}` : '请选择一位成员') : `已选 ${picked.length} 人`}</span>
        <button type="button" className="button primary" disabled={!picked.length} onClick={() => onConfirm(picked)}>
          确认选择
          <Icon icon={Check} />
        </button>
      </div>
    </dialog>
  );
}

// Fixed fictional contacts only. No production credentials or real employee data.
export const demoDepartments = [
  { open_department_id: 'od-demo-rd', name: '产品研发', parent_department_id: '0' },
  { open_department_id: 'od-demo-product', name: '产品组', parent_department_id: 'od-demo-rd' },
  { open_department_id: 'od-demo-engineering', name: '工程组', parent_department_id: 'od-demo-rd' },
  { open_department_id: 'od-demo-ops', name: '综合运营', parent_department_id: '0' },
];

export const demoContacts = [
  {
    open_id: 'ou-demo-linxiao',
    name: '林晓',
    employee_no: 'E1001',
    enterprise_email: 'lin.xiao@example.com',
    department_ids: ['od-demo-product'],
    status: { is_activated: true },
  },
  {
    open_id: 'ou-demo-chenyu',
    name: '陈予',
    employee_no: 'E1002',
    enterprise_email: 'chen.yu@example.com',
    department_ids: ['od-demo-engineering'],
    status: { is_activated: true },
  },
  {
    open_id: 'ou-demo-zhouning',
    name: '周宁',
    employee_no: 'E1003',
    enterprise_email: '',
    department_ids: ['od-demo-product'],
    status: { is_activated: true },
  },
  {
    open_id: 'ou-demo-xuyan',
    name: '许言',
    employee_no: 'E1004',
    enterprise_email: 'xu.yan@example.com',
    department_ids: ['od-demo-engineering'],
    status: { is_activated: true },
  },
  {
    open_id: 'ou-demo-songzhixia',
    name: '宋知夏',
    employee_no: 'E1005',
    enterprise_email: 'song.zhixia@example.com',
    department_ids: ['od-demo-ops'],
    status: { is_activated: true },
  },
  {
    open_id: 'ou-demo-guxingzhou',
    name: '顾行舟',
    employee_no: 'E1006',
    enterprise_email: 'gu.xingzhou@example.com',
    department_ids: ['od-demo-ops'],
    status: { is_activated: true },
  },
  {
    open_id: 'ou-demo-zhaotingyun',
    name: '赵停云',
    employee_no: 'E1007',
    enterprise_email: 'zhao.tingyun@example.com',
    department_ids: ['od-demo-ops'],
    status: { is_resigned: true },
  },
  {
    open_id: 'ou-demo-shenhe',
    name: '沈禾',
    employee_no: 'E1008',
    enterprise_email: 'shen.he@example.com',
    department_ids: ['od-demo-ops'],
    status: { is_activated: true },
  },
];

export const demoPersonas = [
  {
    openId: 'ou-demo-linxiao',
    name: '林晓',
    employeeNo: 'E1001',
    email: 'lin.xiao@example.com',
    departmentNames: '产品组',
    role: 'admin',
    label: '运营管理员 · 林晓（E1001）',
  },
  {
    openId: 'ou-demo-chenyu',
    name: '陈予',
    employeeNo: 'E1002',
    email: 'chen.yu@example.com',
    departmentNames: '工程组',
    role: 'employee',
    label: '待确认员工 · 陈予（E1002）',
  },
  {
    openId: 'ou-demo-xuyan',
    name: '许言',
    employeeNo: 'E1004',
    email: 'xu.yan@example.com',
    departmentNames: '工程组',
    role: 'employee',
    label: '已确认员工 · 许言（E1004）',
  },
  {
    openId: 'ou-demo-shenhe',
    name: '沈禾',
    employeeNo: 'E1008',
    email: 'shen.he@example.com',
    departmentNames: '综合运营',
    role: 'employee',
    label: '期间新入职员工 · 沈禾（E1008）',
  },
];

export function createDemoDirectory() {
  const contacts = structuredClone(demoContacts);
  const departments = structuredClone(demoDepartments);
  const deptMap = new Map(departments.map(d => [d.open_department_id, d.name]));
  const ensureDepartment = id => {
    if (id !== '0' && !departments.some(department => department.open_department_id === id)) {
      throw new Error(`演示部门不存在：${id}`);
    }
  };
  return {
    scopeNote: '演示数据：所有姓名、工号与邮箱均为虚构，仅用于体验；不会连接真实飞书通讯录。',
    async getDepartmentNameMap() { return new Map(deptMap); },
    async listAllUsers() { return structuredClone(contacts); },
    async getUser(id) { return structuredClone(contacts.find(user => user.open_id === id) || null); },
    async listDepartmentUsers(id) {
      ensureDepartment(id);
      return structuredClone(contacts.filter(user => user.department_ids.includes(id)));
    },
    async listDescendantDepartments(id) {
      ensureDepartment(id);
      const seen = new Set([id]);
      const result = [];
      for (const parent of seen) {
        for (const department of departments) {
          if (department.parent_department_id === parent && !seen.has(department.open_department_id)) {
            seen.add(department.open_department_id);
            result.push(department);
          }
        }
      }
      return structuredClone(result);
    },
  };
}

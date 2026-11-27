import crypto from 'node:crypto';

export const PROJECT_NAME_MAX = 80;
export const PROJECT_MEMBERS_MAX = 500;

export function makeProjectKey() {
  return `prj-${crypto.randomBytes(6).toString('hex')}`;
}

export function formatProject(project, members = []) {
  if (!project) return null;
  return {
    id: project.projectKey,
    name: project.name,
    owner: {
      openId: project.ownerOpenId,
      name: project.ownerName,
      employeeNo: project.ownerEmployeeNo || '',
    },
    members: members.map(member => ({
      openId: member.openId,
      name: member.name,
      employeeNo: member.employeeNo || '',
      departmentNames: member.departmentNames || '',
    })),
    memberCount: members.length,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function formatProjectSummary(project) {
  if (!project) return null;
  return {
    id: project.projectKey,
    name: project.name,
    owner: {
      openId: project.ownerOpenId,
      name: project.ownerName,
      employeeNo: project.ownerEmployeeNo || '',
    },
    memberCount: project.memberCount ?? 0,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

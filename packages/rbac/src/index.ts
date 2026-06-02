export const workspaceRoles = ['OWNER', 'ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER'] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];
export const assignableWorkspaceRoles = ['ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER'] as const;
export type AssignableWorkspaceRole = (typeof assignableWorkspaceRoles)[number];
export const globalRoles = ['USER', 'GLOBAL_ADMIN'] as const;
export type GlobalRole = (typeof globalRoles)[number];

export const roleRank: Record<WorkspaceRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  EDITOR: 2,
  COMMENTER: 1,
  VIEWER: 0
};

export function canManageMembers(role: WorkspaceRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export function canManageWorkspaceSettings(role: WorkspaceRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export function canDeleteWorkspace(role: WorkspaceRole): boolean {
  return role === 'OWNER';
}

export function canEditDeck(role: WorkspaceRole): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR';
}

export function canComment(role: WorkspaceRole): boolean {
  return role !== 'VIEWER';
}

export function isGlobalAdmin(role: GlobalRole): boolean {
  return role === 'GLOBAL_ADMIN';
}

export function canManageUsers(role: GlobalRole): boolean {
  return isGlobalAdmin(role);
}

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return workspaceRoles.includes(value as WorkspaceRole);
}

export function isAssignableWorkspaceRole(value: string): value is AssignableWorkspaceRole {
  return assignableWorkspaceRoles.includes(value as AssignableWorkspaceRole);
}

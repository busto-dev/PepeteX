import { describe, expect, it } from 'vitest';

import {
  assignableWorkspaceRoles,
  canEditDeck,
  canDeleteWorkspace,
  canManageMembers,
  canManageWorkspaceSettings,
  canManageUsers,
  isAssignableWorkspaceRole,
  isGlobalAdmin,
  isWorkspaceRole,
  workspaceRoles
} from './index';

describe('rbac helpers', () => {
  it('allows only owner and admin to manage members', () => {
    expect(canManageMembers('OWNER')).toBe(true);
    expect(canManageMembers('ADMIN')).toBe(true);
    expect(canManageMembers('EDITOR')).toBe(false);
    expect(canManageMembers('COMMENTER')).toBe(false);
    expect(canManageMembers('VIEWER')).toBe(false);
  });

  it('allows only owner and admin to manage workspace settings', () => {
    expect(canManageWorkspaceSettings('OWNER')).toBe(true);
    expect(canManageWorkspaceSettings('ADMIN')).toBe(true);
    expect(canManageWorkspaceSettings('EDITOR')).toBe(false);
    expect(canManageWorkspaceSettings('COMMENTER')).toBe(false);
    expect(canManageWorkspaceSettings('VIEWER')).toBe(false);
  });

  it('allows only owner to delete a workspace', () => {
    expect(canDeleteWorkspace('OWNER')).toBe(true);
    expect(canDeleteWorkspace('ADMIN')).toBe(false);
    expect(canDeleteWorkspace('EDITOR')).toBe(false);
    expect(canDeleteWorkspace('COMMENTER')).toBe(false);
    expect(canDeleteWorkspace('VIEWER')).toBe(false);
  });

  it('allows only owner, admin, and editor to edit decks', () => {
    expect(canEditDeck('OWNER')).toBe(true);
    expect(canEditDeck('ADMIN')).toBe(true);
    expect(canEditDeck('EDITOR')).toBe(true);
    expect(canEditDeck('COMMENTER')).toBe(false);
    expect(canEditDeck('VIEWER')).toBe(false);
  });

  it('allows only global admins to manage users', () => {
    expect(isGlobalAdmin('GLOBAL_ADMIN')).toBe(true);
    expect(isGlobalAdmin('USER')).toBe(false);
    expect(canManageUsers('GLOBAL_ADMIN')).toBe(true);
    expect(canManageUsers('USER')).toBe(false);
  });

  it('recognizes supported workspace roles', () => {
    for (const role of workspaceRoles) {
      expect(isWorkspaceRole(role)).toBe(true);
    }

    expect(isWorkspaceRole('INVALID')).toBe(false);
  });

  it('limits assignable workspace roles to non-owner roles', () => {
    for (const role of assignableWorkspaceRoles) {
      expect(isAssignableWorkspaceRole(role)).toBe(true);
    }

    expect(isAssignableWorkspaceRole('OWNER')).toBe(false);
    expect(isAssignableWorkspaceRole('INVALID')).toBe(false);
  });
});

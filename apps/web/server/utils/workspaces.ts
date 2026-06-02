import { createError } from 'h3';

import { Prisma, prisma, type ProviderKind } from '@pepetex/db';
import type { TextProviderKind } from '@pepetex/providers';
import {
  canManageMembers,
  canDeleteWorkspace,
  canManageWorkspaceSettings,
  isAssignableWorkspaceRole,
  type AssignableWorkspaceRole,
  type WorkspaceRole
} from '@pepetex/rbac';

export interface WorkspaceSummary {
  id: string;
  name: string;
  type: 'PERSONAL' | 'SHARED';
  createdAt: string;
  updatedAt: string;
  currentUserRole: WorkspaceRole;
}

export interface SharedWorkspaceInput {
  name: string;
}

export interface WorkspaceMemberSummary {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMemberCandidateSummary {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface CreateWorkspaceMemberInput {
  email: string;
  role: AssignableWorkspaceRole;
}

export interface UpdateWorkspaceMemberInput {
  role: AssignableWorkspaceRole;
}

export interface WorkspaceProviderPolicyEntryInput {
  providerDefinitionId: string;
  allowedModelIds: string[];
}

export interface WorkspaceProviderPoliciesInput {
  policies: WorkspaceProviderPolicyEntryInput[];
}

export interface WorkspaceProviderPolicySummary {
  id: string;
  workspaceId: string;
  providerDefinitionId: string;
  providerName: string;
  providerKind: TextProviderKind;
  providerEnabled: boolean;
  allowedModelIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceAccessRecord {
  id: string;
  name: string;
  type: 'PERSONAL' | 'SHARED';
  createdAt: Date;
  updatedAt: Date;
  members: Array<{
    role: WorkspaceRole;
  }>;
}

export function assertSharedWorkspaceInput(input: unknown): SharedWorkspaceInput {
  const candidate = input as Partial<SharedWorkspaceInput> | null;

  if (!candidate || typeof candidate !== 'object' || typeof candidate.name !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Workspace name is required.'
    });
  }

  const name = candidate.name.trim();

  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Workspace name is required.'
    });
  }

  if (name.length > 120) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Workspace name must be 120 characters or fewer.'
    });
  }

  return { name };
}

export function assertCreateWorkspaceMemberInput(input: unknown): CreateWorkspaceMemberInput {
  const candidate = input as Partial<CreateWorkspaceMemberInput> | null;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.email !== 'string' ||
    typeof candidate.role !== 'string'
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Member email and role are required.'
    });
  }

  const email = candidate.email.trim().toLowerCase();

  if (!email) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Member email is required.'
    });
  }

  if (!isAssignableWorkspaceRole(candidate.role)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Role must be one of ADMIN, EDITOR, COMMENTER, or VIEWER.'
    });
  }

  return {
    email,
    role: candidate.role
  };
}

export function assertWorkspaceMemberCandidateQuery(input: unknown): string {
  const candidate = input as { q?: unknown } | null;
  const rawQuery = Array.isArray(candidate?.q) ? candidate.q[0] : candidate?.q;

  if (rawQuery === undefined || rawQuery === null) {
    return '';
  }

  if (typeof rawQuery !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Search query must be a string.'
    });
  }

  const query = rawQuery.trim();

  if (query.length > 120) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Search query must be 120 characters or fewer.'
    });
  }

  return query;
}

export function assertUpdateWorkspaceMemberInput(input: unknown): UpdateWorkspaceMemberInput {
  const candidate = input as Partial<UpdateWorkspaceMemberInput> | null;

  if (!candidate || typeof candidate !== 'object' || typeof candidate.role !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Role is required.'
    });
  }

  if (!isAssignableWorkspaceRole(candidate.role)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Role must be one of ADMIN, EDITOR, COMMENTER, or VIEWER.'
    });
  }

  return {
    role: candidate.role
  };
}

export function assertWorkspaceId(input: string | undefined): string {
  const workspaceId = input?.trim();

  if (!workspaceId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Workspace id is required.'
    });
  }

  return workspaceId;
}

export function assertWorkspaceMemberId(input: string | undefined): string {
  const memberId = input?.trim();

  if (!memberId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Workspace member id is required.'
    });
  }

  return memberId;
}

export function assertWorkspaceProviderPoliciesInput(
  input: unknown
): WorkspaceProviderPoliciesInput {
  const candidate = input as Partial<WorkspaceProviderPoliciesInput> | null;

  if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.policies)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider policies must be provided as an array.'
    });
  }

  const policies = candidate.policies.map((policy, index) => {
    if (
      !policy ||
      typeof policy !== 'object' ||
      typeof policy.providerDefinitionId !== 'string'
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: `Provider policy #${index + 1} is missing a provider definition id.`
      });
    }

    const providerDefinitionId = policy.providerDefinitionId.trim();

    if (!providerDefinitionId) {
      throw createError({
        statusCode: 400,
        statusMessage: `Provider policy #${index + 1} is missing a provider definition id.`
      });
    }

    const allowedModelIds = normalizeAllowedModelIdsInput(policy.allowedModelIds, index + 1);

    return {
      providerDefinitionId,
      allowedModelIds
    };
  });

  if (new Set(policies.map((policy) => policy.providerDefinitionId)).size !== policies.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider definition ids in workspace policies must be unique.'
    });
  }

  return { policies };
}

export async function listUserWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  const workspaces = await prisma.workspace.findMany({
    where: {
      members: {
        some: { userId }
      }
    },
    orderBy: [{ createdAt: 'asc' }],
    include: {
      members: {
        where: { userId },
        select: { role: true }
      }
    }
  });

  return workspaces.map(mapWorkspaceSummary);
}

export async function getWorkspaceForUser(
  workspaceId: string,
  userId: string
): Promise<WorkspaceSummary> {
  const workspace = await getWorkspaceAccessRecord(workspaceId, userId);
  return mapWorkspaceSummary(workspace);
}

export async function createSharedWorkspace(
  userId: string,
  input: SharedWorkspaceInput
): Promise<WorkspaceSummary> {
  const workspace = await prisma.workspace.create({
    data: {
      name: input.name,
      type: 'SHARED',
      members: {
        create: {
          userId,
          role: 'OWNER'
        }
      }
    },
    include: {
      members: {
        where: { userId },
        select: { role: true }
      }
    }
  });

  return mapWorkspaceSummary(workspace);
}

export async function updateSharedWorkspace(
  workspaceId: string,
  userId: string,
  input: SharedWorkspaceInput
): Promise<WorkspaceSummary> {
  const workspace = await getWorkspaceAccessRecord(workspaceId, userId);
  assertSharedWorkspaceRecord(workspace, 'Only shared workspaces can be updated.');

  const currentUserRole = workspace.members[0]?.role;

  if (!currentUserRole || !canManageWorkspaceSettings(currentUserRole)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Workspace admin access is required.'
    });
  }

  const updatedWorkspace = await prisma.workspace.update({
    where: { id: workspaceId },
    data: { name: input.name },
    include: {
      members: {
        where: { userId },
        select: { role: true }
      }
    }
  });

  return mapWorkspaceSummary(updatedWorkspace);
}

export async function deleteSharedWorkspace(
  workspaceId: string,
  userId: string
): Promise<void> {
  const workspace = await getWorkspaceAccessRecord(workspaceId, userId);
  assertSharedWorkspaceRecord(workspace, 'Only shared workspaces can be deleted.');

  const currentUserRole = workspace.members[0]?.role;

  if (!currentUserRole || !canDeleteWorkspace(currentUserRole)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Workspace owner access is required.'
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.userProfile.updateMany({
      where: {
        defaultWorkspaceId: workspaceId
      },
      data: {
        defaultWorkspaceId: null
      }
    });

    await tx.workspace.delete({
      where: { id: workspaceId }
    });
  });
}

export async function listWorkspaceMembers(
  workspaceId: string,
  userId: string
): Promise<WorkspaceMemberSummary[]> {
  const workspace = await getWorkspaceAccessRecord(workspaceId, userId);
  assertSharedWorkspaceRecord(workspace, 'Only shared workspaces can list members.');

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    orderBy: [{ createdAt: 'asc' }],
    include: {
      user: {
        include: { profile: true }
      }
    }
  });

  return members.map(mapWorkspaceMemberSummary);
}

export async function searchWorkspaceMemberCandidates(
  workspaceId: string,
  actorUserId: string,
  query: string
): Promise<WorkspaceMemberCandidateSummary[]> {
  const workspace = await getWorkspaceAccessRecord(workspaceId, actorUserId);
  assertSharedWorkspaceRecord(workspace, 'Only shared workspaces can search member candidates.');

  const actorRole = getCurrentUserWorkspaceRole(workspace);

  if (!canManageMembers(actorRole)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Workspace admin access is required.'
    });
  }

  const search = query.trim();

  if (search.length < 2) {
    return [];
  }

  const users = await prisma.user.findMany({
    where: {
      memberships: {
        none: { workspaceId }
      },
      OR: [
        { email: { contains: search, mode: 'insensitive' } },
        { profile: { is: { name: { contains: search, mode: 'insensitive' } } } }
      ]
    },
    orderBy: [{ email: 'asc' }],
    take: 10,
    include: { profile: true }
  });

  return users.map(mapWorkspaceMemberCandidateSummary);
}

export async function createWorkspaceMember(
  workspaceId: string,
  actorUserId: string,
  input: CreateWorkspaceMemberInput
): Promise<WorkspaceMemberSummary> {
  const workspace = await getWorkspaceAccessRecord(workspaceId, actorUserId);
  assertSharedWorkspaceRecord(workspace, 'Only shared workspaces can manage members.');

  const actorRole = getCurrentUserWorkspaceRole(workspace);

  if (!canManageMembers(actorRole)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Workspace admin access is required.'
    });
  }

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { profile: true }
  });

  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found.'
    });
  }

  const existingMembership = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId: user.id
    }
  });

  if (existingMembership) {
    throw createError({
      statusCode: 409,
      statusMessage: 'User is already a member of this workspace.'
    });
  }

  const membership = await prisma.workspaceMember.create({
    data: {
      workspaceId,
      userId: user.id,
      role: input.role
    },
    include: {
      user: {
        include: { profile: true }
      }
    }
  });

  return mapWorkspaceMemberSummary(membership);
}

export async function updateWorkspaceMember(
  workspaceId: string,
  memberId: string,
  actorUserId: string,
  input: UpdateWorkspaceMemberInput
): Promise<WorkspaceMemberSummary> {
  const workspace = await getWorkspaceAccessRecord(workspaceId, actorUserId);
  assertSharedWorkspaceRecord(workspace, 'Only shared workspaces can manage members.');

  const actorRole = getCurrentUserWorkspaceRole(workspace);

  if (!canManageMembers(actorRole)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Workspace admin access is required.'
    });
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: {
      id: memberId,
      workspaceId
    },
    include: {
      user: {
        include: { profile: true }
      }
    }
  });

  if (!membership) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Workspace member not found.'
    });
  }

  assertMutableWorkspaceMembership(membership.userId, membership.role, actorUserId);

  const updatedMembership = await prisma.workspaceMember.update({
    where: { id: memberId },
    data: { role: input.role },
    include: {
      user: {
        include: { profile: true }
      }
    }
  });

  return mapWorkspaceMemberSummary(updatedMembership);
}

export async function deleteWorkspaceMember(
  workspaceId: string,
  memberId: string,
  actorUserId: string
): Promise<void> {
  const workspace = await getWorkspaceAccessRecord(workspaceId, actorUserId);
  assertSharedWorkspaceRecord(workspace, 'Only shared workspaces can manage members.');

  const actorRole = getCurrentUserWorkspaceRole(workspace);

  if (!canManageMembers(actorRole)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Workspace admin access is required.'
    });
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: {
      id: memberId,
      workspaceId
    },
    select: {
      id: true,
      userId: true,
      role: true
    }
  });

  if (!membership) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Workspace member not found.'
    });
  }

  assertMutableWorkspaceMembership(membership.userId, membership.role, actorUserId);

  await prisma.$transaction(async (tx) => {
    await tx.userProfile.updateMany({
      where: {
        userId: membership.userId,
        defaultWorkspaceId: workspaceId
      },
      data: {
        defaultWorkspaceId: null
      }
    });

    await tx.workspaceMember.delete({
      where: { id: memberId }
    });
  });
}

export async function listWorkspaceProviderPolicies(
  workspaceId: string,
  userId: string
): Promise<WorkspaceProviderPolicySummary[]> {
  await getWorkspaceAccessRecord(workspaceId, userId);

  const policies = await prisma.workspaceProviderPolicy.findMany({
    where: {
      workspaceId
    },
    orderBy: [{ createdAt: 'asc' }],
    include: {
      providerDefinition: {
        select: {
          id: true,
          name: true,
          kind: true,
          enabled: true
        }
      }
    }
  });

  return policies.map(mapWorkspaceProviderPolicySummary);
}

export async function replaceWorkspaceProviderPolicies(
  workspaceId: string,
  userId: string,
  input: WorkspaceProviderPoliciesInput
): Promise<WorkspaceProviderPolicySummary[]> {
  const workspace = await getWorkspaceAccessRecord(workspaceId, userId);
  const currentUserRole = getCurrentUserWorkspaceRole(workspace);

  if (!canManageWorkspaceSettings(currentUserRole)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Workspace admin access is required.'
    });
  }

  const providerDefinitionIds = input.policies.map((policy) => policy.providerDefinitionId);
  const providerDefinitions =
    providerDefinitionIds.length > 0
      ? await prisma.providerDefinition.findMany({
          where: {
            id: {
              in: providerDefinitionIds
            }
          },
          select: {
            id: true,
            enabled: true
          }
        })
      : [];

  if (providerDefinitions.length !== providerDefinitionIds.length) {
    throw createError({
      statusCode: 404,
      statusMessage: 'One or more provider definitions were not found.'
    });
  }

  if (providerDefinitions.some((providerDefinition) => !providerDefinition.enabled)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Workspace policies can reference only enabled providers.'
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.workspaceProviderPolicy.deleteMany({
      where: {
        workspaceId
      }
    });

    if (input.policies.length > 0) {
      await tx.workspaceProviderPolicy.createMany({
        data: input.policies.map((policy) => ({
          workspaceId,
          providerDefinitionId: policy.providerDefinitionId,
          allowedModelIdsJson:
            policy.allowedModelIds.length > 0
              ? (policy.allowedModelIds as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull
        }))
      });
    }
  });

  return listWorkspaceProviderPolicies(workspaceId, userId);
}

export async function getWorkspaceProviderPolicyRestrictions(
  workspaceId: string,
  userId: string
): Promise<Map<string, string[]> | null> {
  await getWorkspaceAccessRecord(workspaceId, userId);

  const policies = await prisma.workspaceProviderPolicy.findMany({
    where: {
      workspaceId
    },
    select: {
      providerDefinitionId: true,
      allowedModelIdsJson: true
    }
  });

  if (policies.length === 0) {
    return null;
  }

  return new Map(
    policies.map((policy) => [
      policy.providerDefinitionId,
      parseAllowedModelIdsJson(policy.allowedModelIdsJson)
    ])
  );
}

async function getWorkspaceAccessRecord(
  workspaceId: string,
  userId: string
): Promise<WorkspaceAccessRecord> {
  const workspace = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      members: {
        some: { userId }
      }
    },
    include: {
      members: {
        where: { userId },
        select: { role: true }
      }
    }
  });

  if (!workspace) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Workspace not found.'
    });
  }

  return workspace;
}

function assertSharedWorkspaceRecord(workspace: WorkspaceAccessRecord, message: string): void {
  if (workspace.type !== 'SHARED') {
    throw createError({
      statusCode: 400,
      statusMessage: message
    });
  }
}

function mapWorkspaceSummary(workspace: WorkspaceAccessRecord): WorkspaceSummary {
  return {
    id: workspace.id,
    name: workspace.name,
    type: workspace.type,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
    currentUserRole: getCurrentUserWorkspaceRole(workspace)
  };
}

function getCurrentUserWorkspaceRole(workspace: WorkspaceAccessRecord): WorkspaceRole {
  const currentUserRole = workspace.members[0]?.role;

  if (!currentUserRole) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Workspace membership is missing for the current user.'
    });
  }

  return currentUserRole;
}

function assertMutableWorkspaceMembership(
  targetUserId: string,
  targetRole: WorkspaceRole,
  actorUserId: string
): void {
  if (targetRole === 'OWNER') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Workspace ownership transfer is not supported yet.'
    });
  }

  if (targetUserId === actorUserId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'You cannot change or remove your own workspace membership.'
    });
  }
}

function mapWorkspaceMemberSummary(membership: {
  id: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    email: string;
    profile: {
      name: string;
      avatarUrl: string | null;
    } | null;
  };
}): WorkspaceMemberSummary {
  return {
    id: membership.id,
    userId: membership.user.id,
    email: membership.user.email,
    name: membership.user.profile?.name ?? null,
    avatarUrl: membership.user.profile?.avatarUrl ?? null,
    role: membership.role,
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString()
  };
}

function mapWorkspaceMemberCandidateSummary(user: {
  id: string;
  email: string;
  profile: {
    name: string;
    avatarUrl: string | null;
  } | null;
}): WorkspaceMemberCandidateSummary {
  return {
    userId: user.id,
    email: user.email,
    name: user.profile?.name ?? null,
    avatarUrl: user.profile?.avatarUrl ?? null
  };
}

function normalizeAllowedModelIdsInput(value: unknown, policyIndex: number): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `allowedModelIds for provider policy #${policyIndex} must be an array of strings.`
    });
  }

  const normalized = value.map((entry) => {
    if (typeof entry !== 'string') {
      throw createError({
        statusCode: 400,
        statusMessage: `allowedModelIds for provider policy #${policyIndex} must be an array of strings.`
      });
    }

    const trimmedEntry = entry.trim();

    if (!trimmedEntry) {
      throw createError({
        statusCode: 400,
        statusMessage: `allowedModelIds for provider policy #${policyIndex} must not contain empty values.`
      });
    }

    return trimmedEntry;
  });

  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

function parseAllowedModelIdsJson(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mapWorkspaceProviderPolicySummary(policy: {
  id: string;
  workspaceId: string;
  allowedModelIdsJson: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  providerDefinition: {
    id: string;
    name: string;
    kind: ProviderKind;
    enabled: boolean;
  };
}): WorkspaceProviderPolicySummary {
  return {
    id: policy.id,
    workspaceId: policy.workspaceId,
    providerDefinitionId: policy.providerDefinition.id,
    providerName: policy.providerDefinition.name,
    providerKind: fromPrismaProviderKind(policy.providerDefinition.kind),
    providerEnabled: policy.providerDefinition.enabled,
    allowedModelIds: parseAllowedModelIdsJson(policy.allowedModelIdsJson),
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString()
  };
}

function fromPrismaProviderKind(kind: ProviderKind): TextProviderKind {
  switch (kind) {
    case 'GEMINI':
      return 'gemini';
    case 'OPENAI_COMPATIBLE':
      return 'openai-compatible';
    case 'CLIPROXYAPI':
      return 'cliproxyapi';
  }
}

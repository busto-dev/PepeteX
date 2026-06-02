import { createError } from 'h3';

import type { CreateAuditLogInput } from '@pepetex/audit';
import { hashPassword } from '@pepetex/auth';
import { Prisma, prisma } from '@pepetex/db';

export interface CreateAdminUserInput {
  email: string;
  password: string;
  name: string;
  uiLanguage: 'en' | 'id';
  themePreference: 'light' | 'dark' | 'system';
}

export interface ManualAdminPasswordResetInput {
  userId: string;
  password: string;
}

export interface DeleteAdminUserInput {
  userId: string;
  confirmationEmail: string;
  deleteOwnedSharedWorkspaces: boolean;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  globalRole: 'USER' | 'GLOBAL_ADMIN';
  createdAt: string;
  profile: {
    name: string;
    avatarUrl: string | null;
    uiLanguage: string;
    themePreference: string;
    defaultWorkspaceId: string | null;
  } | null;
}

const allowedUiLanguages = new Set<CreateAdminUserInput['uiLanguage']>(['en', 'id']);
const allowedThemePreferences = new Set<CreateAdminUserInput['themePreference']>([
  'light',
  'dark',
  'system'
]);

export function assertCreateAdminUserInput(input: unknown): CreateAdminUserInput {
  const candidate = input as Partial<CreateAdminUserInput> | null;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.email !== 'string' ||
    typeof candidate.password !== 'string' ||
    typeof candidate.name !== 'string'
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Name, email, and password are required.'
    });
  }

  const email = candidate.email.trim().toLowerCase();
  const name = candidate.name.trim();
  const uiLanguage = candidate.uiLanguage ?? 'en';
  const themePreference = candidate.themePreference ?? 'system';

  if (!email || !email.includes('@')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A valid email address is required.'
    });
  }

  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Name is required.'
    });
  }

  if (!allowedUiLanguages.has(uiLanguage)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'UI language must be `en` or `id`.'
    });
  }

  if (!allowedThemePreferences.has(themePreference)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Theme preference must be `light`, `dark`, or `system`.'
    });
  }

  return {
    email,
    password: candidate.password,
    name,
    uiLanguage,
    themePreference
  };
}

export function assertManualAdminPasswordResetInput(
  input: unknown
): ManualAdminPasswordResetInput {
  const candidate = input as Partial<ManualAdminPasswordResetInput> | null;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.userId !== 'string' ||
    typeof candidate.password !== 'string'
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'User id and password are required.'
    });
  }

  const normalizedUserId = candidate.userId.trim();

  if (!normalizedUserId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'User id is required.'
    });
  }

  return {
    userId: normalizedUserId,
    password: candidate.password
  };
}

export function assertDeleteAdminUserInput(
  userId: string | undefined,
  input: unknown
): DeleteAdminUserInput {
  const normalizedUserId = userId?.trim();
  const candidate = input as Partial<DeleteAdminUserInput> | null;

  if (!normalizedUserId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'User id is required.'
    });
  }

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.confirmationEmail !== 'string'
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Confirmation email is required.'
    });
  }

  const confirmationEmail = candidate.confirmationEmail.trim().toLowerCase();

  if (!confirmationEmail) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Confirmation email is required.'
    });
  }

  return {
    userId: normalizedUserId,
    confirmationEmail,
    deleteOwnedSharedWorkspaces: candidate.deleteOwnedSharedWorkspaces === true
  };
}

export async function listAdminUsers(): Promise<AdminUserSummary[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    include: { profile: true }
  });

  return users.map((user) => mapAdminUser(user));
}

export async function createAdminUser(
  input: CreateAdminUserInput,
  actorUserId: string
): Promise<AdminUserSummary> {
  let passwordHash: string;

  try {
    passwordHash = await hashPassword(input.password);
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage:
        error instanceof Error ? error.message : 'Password does not meet requirements.'
    });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          profile: {
            create: {
              name: input.name,
              uiLanguage: input.uiLanguage,
              themePreference: input.themePreference
            }
          },
          memberships: {
            create: {
              role: 'OWNER',
              workspace: {
                create: {
                  name: `${input.name}'s Workspace`,
                  type: 'PERSONAL'
                }
              }
            }
          }
        },
        include: {
          profile: true,
          memberships: {
            include: {
              workspace: true
            }
          }
        }
      });

      const personalWorkspace = user.memberships.find(
        (membership) => membership.workspace.type === 'PERSONAL'
      )?.workspace;

      if (!personalWorkspace || !user.profile) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Failed to create the user personal workspace.'
        });
      }

      const profile = await tx.userProfile.update({
        where: { userId: user.id },
        data: {
          defaultWorkspaceId: personalWorkspace.id
        }
      });

      await tx.auditLog.create({
        data: createAuditLogInput({
          actorUserId,
          action: 'admin.user.create',
          targetType: 'user',
          targetId: user.id,
          metadata: {
            email: user.email
          }
        })
      });

      return mapAdminUser({
        ...user,
        profile
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw createError({
        statusCode: 409,
        statusMessage: 'A user with that email already exists.'
      });
    }

    throw error;
  }
}

export async function resetAdminUserPassword(
  input: ManualAdminPasswordResetInput,
  actorUserId: string
): Promise<void> {
  let passwordHash: string;

  try {
    passwordHash = await hashPassword(input.password);
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage:
        error instanceof Error ? error.message : 'Password does not meet requirements.'
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true }
  });

  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found.'
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: { passwordHash }
    });

    await tx.session.updateMany({
      where: {
        userId: input.userId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });

    await tx.passwordResetToken.deleteMany({
      where: {
        userId: input.userId
      }
    });

    await tx.auditLog.create({
      data: createAuditLogInput({
        actorUserId,
        action: 'admin.user.reset-password',
        targetType: 'user',
        targetId: input.userId
      })
    });
  });
}

export async function deleteAdminUser(
  input: DeleteAdminUserInput,
  actorUserId: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      email: true,
      memberships: {
        select: {
          role: true,
          workspace: {
            select: {
              id: true,
              type: true
            }
          }
        }
      }
    }
  });

  if (!user) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found.'
    });
  }

  if (input.confirmationEmail !== user.email) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Confirmation email does not match the target user.'
    });
  }

  const ownedPersonalWorkspaceIds = user.memberships
    .filter((membership) => membership.role === 'OWNER' && membership.workspace.type === 'PERSONAL')
    .map((membership) => membership.workspace.id);
  const ownedSharedWorkspaceIds = user.memberships
    .filter((membership) => membership.role === 'OWNER' && membership.workspace.type === 'SHARED')
    .map((membership) => membership.workspace.id);

  if (ownedSharedWorkspaceIds.length > 0 && !input.deleteOwnedSharedWorkspaces) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Deleting this user will also delete owned shared workspaces. Set deleteOwnedSharedWorkspaces to true to confirm.'
    });
  }

  const workspaceIdsToDelete = [...ownedPersonalWorkspaceIds, ...ownedSharedWorkspaceIds];

  await prisma.$transaction(async (tx) => {
    if (workspaceIdsToDelete.length > 0) {
      await tx.userProfile.updateMany({
        where: {
          defaultWorkspaceId: {
            in: workspaceIdsToDelete
          }
        },
        data: {
          defaultWorkspaceId: null
        }
      });

      await tx.workspace.deleteMany({
        where: {
          id: {
            in: workspaceIdsToDelete
          }
        }
      });
    }

    await tx.user.delete({
      where: { id: input.userId }
    });

    await tx.auditLog.create({
      data: createAuditLogInput({
        actorUserId,
        action: 'admin.user.delete',
        targetType: 'user',
        targetId: input.userId,
        metadata: {
          email: user.email,
          deletedWorkspaceIds: workspaceIdsToDelete
        }
      })
    });
  });
}

function mapAdminUser(user: {
  id: string;
  email: string;
  globalRole: 'USER' | 'GLOBAL_ADMIN';
  createdAt: Date;
  profile: {
    name: string;
    avatarUrl: string | null;
    uiLanguage: string;
    themePreference: string;
    defaultWorkspaceId: string | null;
  } | null;
}): AdminUserSummary {
  return {
    id: user.id,
    email: user.email,
    globalRole: user.globalRole,
    createdAt: user.createdAt.toISOString(),
    profile: user.profile
      ? {
          name: user.profile.name,
          avatarUrl: user.profile.avatarUrl,
          uiLanguage: user.profile.uiLanguage,
          themePreference: user.profile.themePreference,
          defaultWorkspaceId: user.profile.defaultWorkspaceId
        }
      : null
  };
}

function createAuditLogInput(input: CreateAuditLogInput): Prisma.AuditLogUncheckedCreateInput {
  const auditLog: Prisma.AuditLogUncheckedCreateInput = {
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId
  };

  if (input.metadata) {
    auditLog.metadata = input.metadata as Prisma.InputJsonValue;
  }

  return auditLog;
}

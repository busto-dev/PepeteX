import { createServer, request as httpRequest } from 'node:http';

import { createApp, createRouter, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  },
  userProfile: {
    update: vi.fn(),
    updateMany: vi.fn()
  },
  workspace: {
    deleteMany: vi.fn()
  },
  auditLog: {
    create: vi.fn()
  },
  session: {
    updateMany: vi.fn()
  },
  passwordResetToken: {
    deleteMany: vi.fn()
  }
}));

vi.mock('@pepetex/db', async () => {
  const actual = await vi.importActual<typeof import('@pepetex/db')>('@pepetex/db');

  return {
    ...actual,
    prisma: mockPrisma
  };
});

const mockHashPassword = vi.hoisted(() => vi.fn());

vi.mock('@pepetex/auth', async () => {
  const actual = await vi.importActual<typeof import('@pepetex/auth')>('@pepetex/auth');

  return {
    ...actual,
    hashPassword: mockHashPassword
  };
});

const mockGetAuthenticatedSession = vi.hoisted(() => vi.fn());

vi.mock('../../utils/auth', () => ({
  getAuthenticatedSession: mockGetAuthenticatedSession
}));

import usersGetHandler from './users.get';
import usersPostHandler from './users.post';
import userDeleteHandler from './users/[userId].delete';
import usersPasswordResetPostHandler from './users/reset-password.post';

describe('/api/admin/users', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rejects non-admin user creation requests', async () => {
    mockGetAuthenticatedSession.mockResolvedValue({
      sessionId: 'session_1',
      user: {
        id: 'user_1',
        email: 'editor@example.com',
        globalRole: 'USER',
        profile: null
      }
    });

    const response = await request('/api/admin/users', usersPostHandler, {
      method: 'POST',
      body: {
        name: 'New User',
        email: 'new-user@example.com',
        password: 'strong-password'
      }
    });

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Global admin access is required.');
  });

  it('creates a user with a personal workspace for admins', async () => {
    mockGetAuthenticatedSession.mockResolvedValue({
      sessionId: 'session_admin',
      user: {
        id: 'admin_1',
        email: 'admin@example.com',
        globalRole: 'GLOBAL_ADMIN',
        profile: null
      }
    });
    mockHashPassword.mockResolvedValue('hashed-password');
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) =>
      callback(mockPrisma)
    );
    mockPrisma.user.create.mockResolvedValue({
      id: 'user_2',
      email: 'new-user@example.com',
      globalRole: 'USER',
      createdAt: new Date('2026-04-15T10:30:00.000Z'),
      profile: {
        name: 'New User',
        avatarUrl: null,
        uiLanguage: 'id',
        themePreference: 'dark',
        defaultWorkspaceId: null
      },
      memberships: [
        {
          workspace: {
            id: 'workspace_personal',
            type: 'PERSONAL'
          }
        }
      ]
    });
    mockPrisma.userProfile.update.mockResolvedValue({
      name: 'New User',
      avatarUrl: null,
      uiLanguage: 'id',
      themePreference: 'dark',
      defaultWorkspaceId: 'workspace_personal'
    });

    const response = await request('/api/admin/users', usersPostHandler, {
      method: 'POST',
      body: {
        name: 'New User',
        email: 'new-user@example.com',
        password: 'strong-password',
        uiLanguage: 'id',
        themePreference: 'dark'
      }
    });

    expect(response.status).toBe(201);
    expect(mockHashPassword).toHaveBeenCalledWith('strong-password');
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'new-user@example.com',
        passwordHash: 'hashed-password',
        profile: {
          create: {
            name: 'New User',
            uiLanguage: 'id',
            themePreference: 'dark'
          }
        },
        memberships: {
          create: {
            role: 'OWNER',
            workspace: {
              create: {
                name: "New User's Workspace",
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
    expect(mockPrisma.userProfile.update).toHaveBeenCalledWith({
      where: { userId: 'user_2' },
      data: { defaultWorkspaceId: 'workspace_personal' }
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'admin_1',
        action: 'admin.user.create',
        targetType: 'user',
        targetId: 'user_2',
        metadata: {
          email: 'new-user@example.com'
        }
      }
    });
    expect(response.json).toEqual({
      ok: true,
      user: {
        id: 'user_2',
        email: 'new-user@example.com',
        globalRole: 'USER',
        createdAt: '2026-04-15T10:30:00.000Z',
        profile: {
          name: 'New User',
          avatarUrl: null,
          uiLanguage: 'id',
          themePreference: 'dark',
          defaultWorkspaceId: 'workspace_personal'
        }
      }
    });
  });

  it('lists users for global admins', async () => {
    mockGetAuthenticatedSession.mockResolvedValue({
      sessionId: 'session_admin',
      user: {
        id: 'admin_1',
        email: 'admin@example.com',
        globalRole: 'GLOBAL_ADMIN',
        profile: null
      }
    });
    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: 'user_1',
        email: 'user@example.com',
        globalRole: 'USER',
        createdAt: new Date('2026-04-15T09:00:00.000Z'),
        profile: {
          name: 'User One',
          avatarUrl: null,
          uiLanguage: 'en',
          themePreference: 'system',
          defaultWorkspaceId: 'workspace_1'
        }
      }
    ]);

    const response = await request('/api/admin/users', usersGetHandler);

    expect(response.status).toBe(200);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      include: { profile: true }
    });
    expect(response.json).toEqual({
      users: [
        {
          id: 'user_1',
          email: 'user@example.com',
          globalRole: 'USER',
          createdAt: '2026-04-15T09:00:00.000Z',
          profile: {
            name: 'User One',
            avatarUrl: null,
            uiLanguage: 'en',
            themePreference: 'system',
            defaultWorkspaceId: 'workspace_1'
          }
        }
      ]
    });
  });

  it('resets a user password for global admins and revokes active sessions', async () => {
    mockGetAuthenticatedSession.mockResolvedValue({
      sessionId: 'session_admin',
      user: {
        id: 'admin_1',
        email: 'admin@example.com',
        globalRole: 'GLOBAL_ADMIN',
        profile: null
      }
    });
    mockHashPassword.mockResolvedValue('hashed-new-password');
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_2' });
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) =>
      callback(mockPrisma)
    );
    mockPrisma.user.update.mockResolvedValue({ id: 'user_2' });
    mockPrisma.session.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 1 });

    const response = await request('/api/admin/users/reset-password', usersPasswordResetPostHandler, {
      method: 'POST',
      body: {
        userId: 'user_2',
        password: 'new-strong-password'
      }
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ ok: true });
    expect(mockHashPassword).toHaveBeenCalledWith('new-strong-password');
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user_2' },
      select: { id: true }
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_2' },
      data: { passwordHash: 'hashed-new-password' }
    });
    expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_2',
        revokedAt: null
      },
      data: {
        revokedAt: expect.any(Date)
      }
    });
    expect(mockPrisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_2'
      }
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'admin_1',
        action: 'admin.user.reset-password',
        targetType: 'user',
        targetId: 'user_2'
      }
    });
  });

  it('rejects non-admin manual password resets', async () => {
    mockGetAuthenticatedSession.mockResolvedValue({
      sessionId: 'session_1',
      user: {
        id: 'user_1',
        email: 'editor@example.com',
        globalRole: 'USER',
        profile: null
      }
    });

    const response = await request('/api/admin/users/reset-password', usersPasswordResetPostHandler, {
      method: 'POST',
      body: {
        userId: 'user_2',
        password: 'new-strong-password'
      }
    });

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Global admin access is required.');
  });

  it('rejects unknown users on manual password reset', async () => {
    mockGetAuthenticatedSession.mockResolvedValue({
      sessionId: 'session_admin',
      user: {
        id: 'admin_1',
        email: 'admin@example.com',
        globalRole: 'GLOBAL_ADMIN',
        profile: null
      }
    });
    mockHashPassword.mockResolvedValue('hashed-new-password');
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const response = await request('/api/admin/users/reset-password', usersPasswordResetPostHandler, {
      method: 'POST',
      body: {
        userId: 'missing-user',
        password: 'new-strong-password'
      }
    });

    expect(response.status).toBe(404);
    expect(response.json.statusMessage).toBe('User not found.');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects weak manual reset passwords', async () => {
    mockGetAuthenticatedSession.mockResolvedValue({
      sessionId: 'session_admin',
      user: {
        id: 'admin_1',
        email: 'admin@example.com',
        globalRole: 'GLOBAL_ADMIN',
        profile: null
      }
    });
    mockHashPassword.mockRejectedValue(new Error('Password must be at least 8 characters long.'));

    const response = await request('/api/admin/users/reset-password', usersPasswordResetPostHandler, {
      method: 'POST',
      body: {
        userId: 'user_2',
        password: 'short'
      }
    });

    expect(response.status).toBe(400);
    expect(response.json.statusMessage).toBe('Password must be at least 8 characters long.');
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('deletes a user after explicit confirmation and owned shared-workspace confirmation', async () => {
    mockGetAuthenticatedSession.mockResolvedValue({
      sessionId: 'session_admin',
      user: {
        id: 'admin_1',
        email: 'admin@example.com',
        globalRole: 'GLOBAL_ADMIN',
        profile: null
      }
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user_2',
      email: 'delete-me@example.com',
      memberships: [
        {
          role: 'OWNER',
          workspace: {
            id: 'workspace_personal',
            type: 'PERSONAL'
          }
        },
        {
          role: 'OWNER',
          workspace: {
            id: 'workspace_shared',
            type: 'SHARED'
          }
        },
        {
          role: 'EDITOR',
          workspace: {
            id: 'workspace_other',
            type: 'SHARED'
          }
        }
      ]
    });
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) =>
      callback(mockPrisma)
    );
    mockPrisma.userProfile.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.workspace.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.user.delete.mockResolvedValue({ id: 'user_2' });

    const response = await request(
      '/api/admin/users/user_2',
      userDeleteHandler,
      {
        method: 'DELETE',
        body: {
          confirmationEmail: 'delete-me@example.com',
          deleteOwnedSharedWorkspaces: true
        }
      },
      '/api/admin/users/:userId'
    );

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ ok: true });
    expect(mockPrisma.userProfile.updateMany).toHaveBeenCalledWith({
      where: {
        defaultWorkspaceId: {
          in: ['workspace_personal', 'workspace_shared']
        }
      },
      data: {
        defaultWorkspaceId: null
      }
    });
    expect(mockPrisma.workspace.deleteMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['workspace_personal', 'workspace_shared']
        }
      }
    });
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({
      where: { id: 'user_2' }
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'admin_1',
        action: 'admin.user.delete',
        targetType: 'user',
        targetId: 'user_2',
        metadata: {
          email: 'delete-me@example.com',
          deletedWorkspaceIds: ['workspace_personal', 'workspace_shared']
        }
      }
    });
  });

  it('rejects user deletion when the confirmation email does not match', async () => {
    mockGetAuthenticatedSession.mockResolvedValue({
      sessionId: 'session_admin',
      user: {
        id: 'admin_1',
        email: 'admin@example.com',
        globalRole: 'GLOBAL_ADMIN',
        profile: null
      }
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user_2',
      email: 'delete-me@example.com',
      memberships: []
    });

    const response = await request(
      '/api/admin/users/user_2',
      userDeleteHandler,
      {
        method: 'DELETE',
        body: {
          confirmationEmail: 'wrong@example.com'
        }
      },
      '/api/admin/users/:userId'
    );

    expect(response.status).toBe(400);
    expect(response.json.statusMessage).toBe('Confirmation email does not match the target user.');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires explicit shared-workspace deletion confirmation for owned shared workspaces', async () => {
    mockGetAuthenticatedSession.mockResolvedValue({
      sessionId: 'session_admin',
      user: {
        id: 'admin_1',
        email: 'admin@example.com',
        globalRole: 'GLOBAL_ADMIN',
        profile: null
      }
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user_2',
      email: 'delete-me@example.com',
      memberships: [
        {
          role: 'OWNER',
          workspace: {
            id: 'workspace_personal',
            type: 'PERSONAL'
          }
        },
        {
          role: 'OWNER',
          workspace: {
            id: 'workspace_shared',
            type: 'SHARED'
          }
        }
      ]
    });

    const response = await request(
      '/api/admin/users/user_2',
      userDeleteHandler,
      {
        method: 'DELETE',
        body: {
          confirmationEmail: 'delete-me@example.com'
        }
      },
      '/api/admin/users/:userId'
    );

    expect(response.status).toBe(400);
    expect(response.json.statusMessage).toBe(
      'Deleting this user will also delete owned shared workspaces. Set deleteOwnedSharedWorkspaces to true to confirm.'
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects non-admin user deletion requests', async () => {
    mockGetAuthenticatedSession.mockResolvedValue({
      sessionId: 'session_1',
      user: {
        id: 'user_1',
        email: 'editor@example.com',
        globalRole: 'USER',
        profile: null
      }
    });

    const response = await request(
      '/api/admin/users/user_2',
      userDeleteHandler,
      {
        method: 'DELETE',
        body: {
          confirmationEmail: 'delete-me@example.com'
        }
      },
      '/api/admin/users/:userId'
    );

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Global admin access is required.');
  });
});

async function request(
  path: string,
  handler: EventHandler,
  input: {
    method?: string;
    body?: unknown;
  } = {},
  routePath = path
) {
  const app = createApp();
  const router = createRouter();
  router.use(routePath, handler as never);
  app.use(router);

  const server = createServer(toNodeListener(app));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind test server.');
    }

    const payload = input.body ? JSON.stringify(input.body) : undefined;
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path,
          method: input.method ?? 'GET',
          headers: payload
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload)
              }
            : undefined
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              body
            });
          });
        }
      );

      req.on('error', reject);

      if (payload) {
        req.write(payload);
      }

      req.end();
    });

    return {
      status: response.status,
      json: response.body ? JSON.parse(response.body) : null
    };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

import { createServer, request as httpRequest } from 'node:http';

import { createApp, createRouter, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  workspace: {
    findFirst: vi.fn()
  },
  workspaceMember: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  },
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn()
  },
  userProfile: {
    updateMany: vi.fn()
  }
}));

vi.mock('@pepetex/db', async () => {
  const actual = await vi.importActual<typeof import('@pepetex/db')>('@pepetex/db');

  return {
    ...actual,
    prisma: mockPrisma
  };
});

const mockGetAuthenticatedSession = vi.hoisted(() => vi.fn());

vi.mock('../utils/auth', () => ({
  getAuthenticatedSession: mockGetAuthenticatedSession
}));

import workspaceMembersGetHandler from './workspaces/[workspaceId]/members.get';
import workspaceMembersPostHandler from './workspaces/[workspaceId]/members.post';
import workspaceMemberCandidatesGetHandler from './workspaces/[workspaceId]/members/candidates.get';
import workspaceMemberDeleteHandler from './workspaces/[workspaceId]/members/[memberId].delete';
import workspaceMemberPatchHandler from './workspaces/[workspaceId]/members/[memberId].patch';

describe('/api/workspaces/:workspaceId/members', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication to list workspace members', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const response = await request(
      '/api/workspaces/workspace_shared/members',
      workspaceMembersGetHandler
    );

    expect(response.status).toBe(401);
    expect(response.json.statusMessage).toBe('Authentication required.');
  });

  it('lists members for shared workspaces', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('ADMIN'));
    mockPrisma.workspaceMember.findMany.mockResolvedValue([
      createWorkspaceMemberRecord({
        id: 'member_owner',
        userId: 'user_owner',
        email: 'owner@example.com',
        name: 'Workspace Owner',
        role: 'OWNER'
      }),
      createWorkspaceMemberRecord({
        id: 'member_editor',
        userId: 'user_editor',
        email: 'editor@example.com',
        name: 'Deck Editor',
        role: 'EDITOR'
      })
    ]);

    const response = await request(
      '/api/workspaces/workspace_shared/members',
      workspaceMembersGetHandler,
      {},
      '/api/workspaces/:workspaceId/members'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.workspaceMember.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace_shared' },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        user: {
          include: { profile: true }
        }
      }
    });
    expect(response.json).toEqual({
      members: [
        {
          id: 'member_owner',
          userId: 'user_owner',
          email: 'owner@example.com',
          name: 'Workspace Owner',
          avatarUrl: null,
          role: 'OWNER',
          createdAt: '2026-04-25T01:00:00.000Z',
          updatedAt: '2026-04-25T01:05:00.000Z'
        },
        {
          id: 'member_editor',
          userId: 'user_editor',
          email: 'editor@example.com',
          name: 'Deck Editor',
          avatarUrl: null,
          role: 'EDITOR',
          createdAt: '2026-04-25T01:00:00.000Z',
          updatedAt: '2026-04-25T01:05:00.000Z'
        }
      ]
    });
  });

  it('rejects member listing for personal workspaces', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(personalWorkspaceAccess());

    const response = await request(
      '/api/workspaces/workspace_personal/members',
      workspaceMembersGetHandler,
      {},
      '/api/workspaces/:workspaceId/members'
    );

    expect(response.status).toBe(400);
    expect(response.json.statusMessage).toBe('Only shared workspaces can list members.');
  });

  it('searches existing non-member users for workspace admins', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('ADMIN'));
    mockPrisma.user.findMany.mockResolvedValue([
      createUserRecord({
        id: 'user_viewer',
        email: 'viewer@example.com',
        name: 'Viewer User'
      })
    ]);

    const response = await request(
      '/api/workspaces/workspace_shared/members/candidates?q=vie',
      workspaceMemberCandidatesGetHandler,
      {},
      '/api/workspaces/:workspaceId/members/candidates'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: {
        memberships: {
          none: { workspaceId: 'workspace_shared' }
        },
        OR: [
          { email: { contains: 'vie', mode: 'insensitive' } },
          { profile: { is: { name: { contains: 'vie', mode: 'insensitive' } } } }
        ]
      },
      orderBy: [{ email: 'asc' }],
      take: 10,
      include: { profile: true }
    });
    expect(response.json).toEqual({
      users: [
        {
          userId: 'user_viewer',
          email: 'viewer@example.com',
          name: 'Viewer User',
          avatarUrl: null
        }
      ]
    });
  });

  it('does not search candidates for short queries', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('ADMIN'));

    const response = await request(
      '/api/workspaces/workspace_shared/members/candidates?q=v',
      workspaceMemberCandidatesGetHandler,
      {},
      '/api/workspaces/:workspaceId/members/candidates'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    expect(response.json).toEqual({ users: [] });
  });

  it('rejects candidate search for non-admin workspace members', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('EDITOR'));

    const response = await request(
      '/api/workspaces/workspace_shared/members/candidates?q=viewer',
      workspaceMemberCandidatesGetHandler,
      {},
      '/api/workspaces/:workspaceId/members/candidates'
    );

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Workspace admin access is required.');
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it('adds an existing user to a shared workspace for workspace admins', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('ADMIN'));
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user_viewer',
      email: 'viewer@example.com',
      profile: {
        name: 'Viewer User',
        avatarUrl: null
      }
    });
    mockPrisma.workspaceMember.findFirst.mockResolvedValue(null);
    mockPrisma.workspaceMember.create.mockResolvedValue(
      createWorkspaceMemberRecord({
        id: 'member_viewer',
        userId: 'user_viewer',
        email: 'viewer@example.com',
        name: 'Viewer User',
        role: 'VIEWER'
      })
    );

    const response = await request(
      '/api/workspaces/workspace_shared/members',
      workspaceMembersPostHandler,
      {
        method: 'POST',
        body: {
          email: 'viewer@example.com',
          role: 'VIEWER'
        }
      },
      '/api/workspaces/:workspaceId/members'
    );

    expect(response.status).toBe(201);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'viewer@example.com' },
      include: { profile: true }
    });
    expect(mockPrisma.workspaceMember.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'workspace_shared',
        userId: 'user_viewer',
        role: 'VIEWER'
      },
      include: {
        user: {
          include: { profile: true }
        }
      }
    });
    expect(response.json).toEqual({
      ok: true,
      member: {
        id: 'member_viewer',
        userId: 'user_viewer',
        email: 'viewer@example.com',
        name: 'Viewer User',
        avatarUrl: null,
        role: 'VIEWER',
        createdAt: '2026-04-25T01:00:00.000Z',
        updatedAt: '2026-04-25T01:05:00.000Z'
      }
    });
  });

  it('rejects member creation for non-admin workspace members', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('EDITOR'));

    const response = await request(
      '/api/workspaces/workspace_shared/members',
      workspaceMembersPostHandler,
      {
        method: 'POST',
        body: {
          email: 'viewer@example.com',
          role: 'VIEWER'
        }
      },
      '/api/workspaces/:workspaceId/members'
    );

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Workspace admin access is required.');
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects duplicate workspace members', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('OWNER'));
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user_viewer',
      email: 'viewer@example.com',
      profile: {
        name: 'Viewer User',
        avatarUrl: null
      }
    });
    mockPrisma.workspaceMember.findFirst.mockResolvedValue({ id: 'member_existing' });

    const response = await request(
      '/api/workspaces/workspace_shared/members',
      workspaceMembersPostHandler,
      {
        method: 'POST',
        body: {
          email: 'viewer@example.com',
          role: 'VIEWER'
        }
      },
      '/api/workspaces/:workspaceId/members'
    );

    expect(response.status).toBe(409);
    expect(response.json.statusMessage).toBe('User is already a member of this workspace.');
    expect(mockPrisma.workspaceMember.create).not.toHaveBeenCalled();
  });

  it('updates a non-owner workspace member role', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('OWNER'));
    mockPrisma.workspaceMember.findFirst.mockResolvedValue(
      createWorkspaceMemberRecord({
        id: 'member_viewer',
        userId: 'user_viewer',
        email: 'viewer@example.com',
        name: 'Viewer User',
        role: 'VIEWER'
      })
    );
    mockPrisma.workspaceMember.update.mockResolvedValue(
      createWorkspaceMemberRecord({
        id: 'member_viewer',
        userId: 'user_viewer',
        email: 'viewer@example.com',
        name: 'Viewer User',
        role: 'EDITOR'
      })
    );

    const response = await request(
      '/api/workspaces/workspace_shared/members/member_viewer',
      workspaceMemberPatchHandler,
      {
        method: 'PATCH',
        body: {
          role: 'EDITOR'
        }
      },
      '/api/workspaces/:workspaceId/members/:memberId'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.workspaceMember.update).toHaveBeenCalledWith({
      where: { id: 'member_viewer' },
      data: { role: 'EDITOR' },
      include: {
        user: {
          include: { profile: true }
        }
      }
    });
    expect(response.json.member.role).toBe('EDITOR');
  });

  it('rejects changing workspace ownership through member updates', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('OWNER'));
    mockPrisma.workspaceMember.findFirst.mockResolvedValue(
      createWorkspaceMemberRecord({
        id: 'member_owner',
        userId: 'user_owner',
        email: 'owner@example.com',
        name: 'Workspace Owner',
        role: 'OWNER'
      })
    );

    const response = await request(
      '/api/workspaces/workspace_shared/members/member_owner',
      workspaceMemberPatchHandler,
      {
        method: 'PATCH',
        body: {
          role: 'ADMIN'
        }
      },
      '/api/workspaces/:workspaceId/members/:memberId'
    );

    expect(response.status).toBe(400);
    expect(response.json.statusMessage).toBe('Workspace ownership transfer is not supported yet.');
    expect(mockPrisma.workspaceMember.update).not.toHaveBeenCalled();
  });

  it('removes a workspace member and clears invalid default workspace references', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('ADMIN'));
    mockPrisma.workspaceMember.findFirst.mockResolvedValue({
      id: 'member_viewer',
      userId: 'user_viewer',
      role: 'VIEWER'
    });
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) =>
      callback(mockPrisma)
    );
    mockPrisma.userProfile.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workspaceMember.delete.mockResolvedValue({ id: 'member_viewer' });

    const response = await request(
      '/api/workspaces/workspace_shared/members/member_viewer',
      workspaceMemberDeleteHandler,
      {
        method: 'DELETE'
      },
      '/api/workspaces/:workspaceId/members/:memberId'
    );

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ ok: true });
    expect(mockPrisma.userProfile.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_viewer',
        defaultWorkspaceId: 'workspace_shared'
      },
      data: {
        defaultWorkspaceId: null
      }
    });
    expect(mockPrisma.workspaceMember.delete).toHaveBeenCalledWith({
      where: { id: 'member_viewer' }
    });
  });

  it('rejects changing or removing the current user membership', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('OWNER'));
    mockPrisma.workspaceMember.findFirst.mockResolvedValue(
      createWorkspaceMemberRecord({
        id: 'member_self',
        userId: 'user_1',
        email: 'user@example.com',
        name: 'Current User',
        role: 'ADMIN'
      })
    );

    const patchResponse = await request(
      '/api/workspaces/workspace_shared/members/member_self',
      workspaceMemberPatchHandler,
      {
        method: 'PATCH',
        body: {
          role: 'EDITOR'
        }
      },
      '/api/workspaces/:workspaceId/members/:memberId'
    );

    expect(patchResponse.status).toBe(400);
    expect(patchResponse.json.statusMessage).toBe(
      'You cannot change or remove your own workspace membership.'
    );

    mockPrisma.workspaceMember.findFirst.mockResolvedValue({
      id: 'member_self',
      userId: 'user_1',
      role: 'ADMIN'
    });

    const deleteResponse = await request(
      '/api/workspaces/workspace_shared/members/member_self',
      workspaceMemberDeleteHandler,
      {
        method: 'DELETE'
      },
      '/api/workspaces/:workspaceId/members/:memberId'
    );

    expect(deleteResponse.status).toBe(400);
    expect(deleteResponse.json.statusMessage).toBe(
      'You cannot change or remove your own workspace membership.'
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

function createSession() {
  return {
    sessionId: 'session_1',
    user: {
      id: 'user_1',
      email: 'user@example.com',
      globalRole: 'USER',
      profile: null
    }
  };
}

function sharedWorkspaceAccess(role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER') {
  return {
    id: 'workspace_shared',
    name: 'Team Workspace',
    type: 'SHARED',
    createdAt: new Date('2026-04-25T01:00:00.000Z'),
    updatedAt: new Date('2026-04-25T01:05:00.000Z'),
    members: [{ role }]
  };
}

function personalWorkspaceAccess() {
  return {
    id: 'workspace_personal',
    name: "User One's Workspace",
    type: 'PERSONAL',
    createdAt: new Date('2026-04-25T01:00:00.000Z'),
    updatedAt: new Date('2026-04-25T01:05:00.000Z'),
    members: [{ role: 'OWNER' }]
  };
}

function createWorkspaceMemberRecord(input: {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER';
}) {
  return {
    id: input.id,
    userId: input.userId,
    role: input.role,
    createdAt: new Date('2026-04-25T01:00:00.000Z'),
    updatedAt: new Date('2026-04-25T01:05:00.000Z'),
    user: {
      id: input.userId,
      email: input.email,
      profile: {
        name: input.name,
        avatarUrl: null
      }
    }
  };
}

function createUserRecord(input: {
  id: string;
  email: string;
  name: string;
}) {
  return {
    id: input.id,
    email: input.email,
    profile: {
      name: input.name,
      avatarUrl: null
    }
  };
}

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
          headers: payload ? { 'content-type': 'application/json' } : undefined
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

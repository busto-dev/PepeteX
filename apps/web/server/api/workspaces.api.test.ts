import { createServer, request as httpRequest } from 'node:http';

import { createApp, createRouter, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  workspace: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
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

import workspaceByIdDeleteHandler from './workspaces/[workspaceId].delete';
import workspaceByIdGetHandler from './workspaces/[workspaceId].get';
import workspaceByIdPatchHandler from './workspaces/[workspaceId].patch';
import workspacesGetHandler from './workspaces.get';
import workspacesPostHandler from './workspaces.post';

describe('/api/workspaces', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication to list workspaces', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const response = await request('/api/workspaces', workspacesGetHandler);

    expect(response.status).toBe(401);
    expect(response.json.statusMessage).toBe('Authentication required.');
  });

  it('lists the current user workspaces', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findMany.mockResolvedValue([
      {
        id: 'workspace_personal',
        name: "User One's Workspace",
        type: 'PERSONAL',
        createdAt: new Date('2026-04-15T11:00:00.000Z'),
        updatedAt: new Date('2026-04-15T11:05:00.000Z'),
        members: [{ role: 'OWNER' }]
      },
      {
        id: 'workspace_shared',
        name: 'Team Workspace',
        type: 'SHARED',
        createdAt: new Date('2026-04-15T12:00:00.000Z'),
        updatedAt: new Date('2026-04-15T12:10:00.000Z'),
        members: [{ role: 'EDITOR' }]
      }
    ]);

    const response = await request('/api/workspaces', workspacesGetHandler);

    expect(response.status).toBe(200);
    expect(mockPrisma.workspace.findMany).toHaveBeenCalledWith({
      where: {
        members: {
          some: { userId: 'user_1' }
        }
      },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        members: {
          where: { userId: 'user_1' },
          select: { role: true }
        }
      }
    });
    expect(response.json).toEqual({
      workspaces: [
        {
          id: 'workspace_personal',
          name: "User One's Workspace",
          type: 'PERSONAL',
          createdAt: '2026-04-15T11:00:00.000Z',
          updatedAt: '2026-04-15T11:05:00.000Z',
          currentUserRole: 'OWNER'
        },
        {
          id: 'workspace_shared',
          name: 'Team Workspace',
          type: 'SHARED',
          createdAt: '2026-04-15T12:00:00.000Z',
          updatedAt: '2026-04-15T12:10:00.000Z',
          currentUserRole: 'EDITOR'
        }
      ]
    });
  });

  it('creates a shared workspace for an authenticated user', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.create.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Team Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-15T12:00:00.000Z'),
      updatedAt: new Date('2026-04-15T12:00:00.000Z'),
      members: [{ role: 'OWNER' }]
    });

    const response = await request('/api/workspaces', workspacesPostHandler, {
      method: 'POST',
      body: {
        name: 'Team Workspace'
      }
    });

    expect(response.status).toBe(201);
    expect(mockPrisma.workspace.create).toHaveBeenCalledWith({
      data: {
        name: 'Team Workspace',
        type: 'SHARED',
        members: {
          create: {
            userId: 'user_1',
            role: 'OWNER'
          }
        }
      },
      include: {
        members: {
          where: { userId: 'user_1' },
          select: { role: true }
        }
      }
    });
    expect(response.json).toEqual({
      ok: true,
      workspace: {
        id: 'workspace_shared',
        name: 'Team Workspace',
        type: 'SHARED',
        createdAt: '2026-04-15T12:00:00.000Z',
        updatedAt: '2026-04-15T12:00:00.000Z',
        currentUserRole: 'OWNER'
      }
    });
  });

  it('returns a single workspace for a member', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Team Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-15T12:00:00.000Z'),
      updatedAt: new Date('2026-04-15T12:10:00.000Z'),
      members: [{ role: 'VIEWER' }]
    });

    const response = await request(
      '/api/workspaces/workspace_shared',
      workspaceByIdGetHandler,
      {},
      '/api/workspaces/:workspaceId'
    );

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      workspace: {
        id: 'workspace_shared',
        name: 'Team Workspace',
        type: 'SHARED',
        createdAt: '2026-04-15T12:00:00.000Z',
        updatedAt: '2026-04-15T12:10:00.000Z',
        currentUserRole: 'VIEWER'
      }
    });
  });

  it('updates a shared workspace for workspace admins', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Old Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-15T12:00:00.000Z'),
      updatedAt: new Date('2026-04-15T12:10:00.000Z'),
      members: [{ role: 'ADMIN' }]
    });
    mockPrisma.workspace.update.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Renamed Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-15T12:00:00.000Z'),
      updatedAt: new Date('2026-04-15T12:20:00.000Z'),
      members: [{ role: 'ADMIN' }]
    });

    const response = await request(
      '/api/workspaces/workspace_shared',
      workspaceByIdPatchHandler,
      {
        method: 'PATCH',
        body: {
          name: 'Renamed Workspace'
        }
      },
      '/api/workspaces/:workspaceId'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.workspace.update).toHaveBeenCalledWith({
      where: { id: 'workspace_shared' },
      data: { name: 'Renamed Workspace' },
      include: {
        members: {
          where: { userId: 'user_1' },
          select: { role: true }
        }
      }
    });
    expect(response.json).toEqual({
      ok: true,
      workspace: {
        id: 'workspace_shared',
        name: 'Renamed Workspace',
        type: 'SHARED',
        createdAt: '2026-04-15T12:00:00.000Z',
        updatedAt: '2026-04-15T12:20:00.000Z',
        currentUserRole: 'ADMIN'
      }
    });
  });

  it('rejects shared workspace updates from non-admin members', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Team Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-15T12:00:00.000Z'),
      updatedAt: new Date('2026-04-15T12:10:00.000Z'),
      members: [{ role: 'VIEWER' }]
    });

    const response = await request(
      '/api/workspaces/workspace_shared',
      workspaceByIdPatchHandler,
      {
        method: 'PATCH',
        body: {
          name: 'Renamed Workspace'
        }
      },
      '/api/workspaces/:workspaceId'
    );

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Workspace admin access is required.');
    expect(mockPrisma.workspace.update).not.toHaveBeenCalled();
  });

  it('rejects updates for personal workspaces through the shared workspace route', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace_personal',
      name: "User One's Workspace",
      type: 'PERSONAL',
      createdAt: new Date('2026-04-15T12:00:00.000Z'),
      updatedAt: new Date('2026-04-15T12:10:00.000Z'),
      members: [{ role: 'OWNER' }]
    });

    const response = await request(
      '/api/workspaces/workspace_personal',
      workspaceByIdPatchHandler,
      {
        method: 'PATCH',
        body: {
          name: 'Renamed Workspace'
        }
      },
      '/api/workspaces/:workspaceId'
    );

    expect(response.status).toBe(400);
    expect(response.json.statusMessage).toBe('Only shared workspaces can be updated.');
  });

  it('deletes a shared workspace for workspace owners', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Team Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-15T12:00:00.000Z'),
      updatedAt: new Date('2026-04-15T12:10:00.000Z'),
      members: [{ role: 'OWNER' }]
    });
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) =>
      callback(mockPrisma)
    );
    mockPrisma.userProfile.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.workspace.delete.mockResolvedValue({ id: 'workspace_shared' });

    const response = await request(
      '/api/workspaces/workspace_shared',
      workspaceByIdDeleteHandler,
      {
        method: 'DELETE'
      },
      '/api/workspaces/:workspaceId'
    );

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ ok: true });
    expect(mockPrisma.userProfile.updateMany).toHaveBeenCalledWith({
      where: {
        defaultWorkspaceId: 'workspace_shared'
      },
      data: {
        defaultWorkspaceId: null
      }
    });
    expect(mockPrisma.workspace.delete).toHaveBeenCalledWith({
      where: { id: 'workspace_shared' }
    });
  });

  it('rejects shared workspace deletion from non-owners', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Team Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-15T12:00:00.000Z'),
      updatedAt: new Date('2026-04-15T12:10:00.000Z'),
      members: [{ role: 'ADMIN' }]
    });

    const response = await request(
      '/api/workspaces/workspace_shared',
      workspaceByIdDeleteHandler,
      {
        method: 'DELETE'
      },
      '/api/workspaces/:workspaceId'
    );

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Workspace owner access is required.');
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

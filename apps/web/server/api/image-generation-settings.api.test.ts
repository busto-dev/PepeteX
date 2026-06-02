import { createServer, request as httpRequest } from 'node:http';

import { createApp, createRouter, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  workspace: {
    findFirst: vi.fn()
  },
  globalImageGenerationSettings: {
    findUnique: vi.fn(),
    upsert: vi.fn()
  },
  workspaceImageGenerationSettings: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
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

const mockGetAuthenticatedSession = vi.hoisted(() => vi.fn());

vi.mock('../utils/auth', () => ({
  getAuthenticatedSession: mockGetAuthenticatedSession
}));

import adminImageGenerationSettingsGetHandler from './admin/image-generation-settings.get';
import adminImageGenerationSettingsPatchHandler from './admin/image-generation-settings.patch';
import workspaceImageGenerationSettingsGetHandler from './workspaces/[workspaceId]/image-generation-settings.get';
import workspaceImageGenerationSettingsPutHandler from './workspaces/[workspaceId]/image-generation-settings.put';

describe('image generation settings APIs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('lists default global image generation settings for global admins', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession({ globalRole: 'GLOBAL_ADMIN' }));
    mockPrisma.globalImageGenerationSettings.findUnique.mockResolvedValue(null);

    const response = await request(
      '/api/admin/image-generation-settings',
      adminImageGenerationSettingsGetHandler
    );

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      settings: {
        isEnabled: false,
        providerKind: null,
        model: null,
        updatedAt: null
      }
    });
  });

  it('updates global image generation settings for global admins', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession({ globalRole: 'GLOBAL_ADMIN' }));
    mockPrisma.globalImageGenerationSettings.upsert.mockResolvedValue({
      id: 'global',
      isEnabled: true,
      defaultProviderKind: 'IMAGEN',
      defaultModel: 'imagen-4.0-fast-generate-001',
      updatedAt: new Date('2026-04-27T11:45:00.000Z')
    });

    const response = await request('/api/admin/image-generation-settings', adminImageGenerationSettingsPatchHandler, {
      method: 'PATCH',
      body: {
        isEnabled: true,
        providerKind: 'imagen',
        model: 'imagen-4.0-fast-generate-001'
      }
    });

    expect(response.status).toBe(200);
    expect(mockPrisma.globalImageGenerationSettings.upsert).toHaveBeenCalledWith({
      where: { id: 'global' },
      update: {
        isEnabled: true,
        defaultProviderKind: 'IMAGEN',
        defaultModel: 'imagen-4.0-fast-generate-001'
      },
      create: {
        id: 'global',
        isEnabled: true,
        defaultProviderKind: 'IMAGEN',
        defaultModel: 'imagen-4.0-fast-generate-001'
      }
    });
    expect(response.json.settings.providerKind).toBe('imagen');
  });

  it('returns workspace overrides plus effective inherited settings for members', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Team Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-27T11:00:00.000Z'),
      updatedAt: new Date('2026-04-27T11:00:00.000Z'),
      members: [{ role: 'VIEWER' }]
    });
    mockPrisma.globalImageGenerationSettings.findUnique.mockResolvedValue({
      id: 'global',
      isEnabled: true,
      defaultProviderKind: 'IMAGEN',
      defaultModel: 'imagen-4.0-fast-generate-001',
      updatedAt: new Date('2026-04-27T11:10:00.000Z')
    });
    mockPrisma.workspaceImageGenerationSettings.findUnique.mockResolvedValue({
      id: 'workspace_image_settings_1',
      workspaceId: 'workspace_shared',
      isEnabled: null,
      preferredProviderKind: 'GEMINI_IMAGE',
      preferredModel: 'gemini-2.5-flash-image-preview',
      updatedAt: new Date('2026-04-27T11:20:00.000Z')
    });

    const response = await request(
      '/api/workspaces/workspace_shared/image-generation-settings',
      workspaceImageGenerationSettingsGetHandler,
      {},
      '/api/workspaces/:workspaceId/image-generation-settings'
    );

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      settings: {
        workspaceId: 'workspace_shared',
        isEnabled: null,
        providerKind: 'gemini-image',
        model: 'gemini-2.5-flash-image-preview',
        updatedAt: '2026-04-27T11:20:00.000Z'
      },
      effectiveSettings: {
        workspaceId: 'workspace_shared',
        isEnabled: true,
        providerKind: 'gemini-image',
        model: 'gemini-2.5-flash-image-preview'
      }
    });
  });

  it('clears workspace overrides for workspace admins', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst
      .mockResolvedValueOnce({
        id: 'workspace_shared',
        name: 'Team Workspace',
        type: 'SHARED',
        createdAt: new Date('2026-04-27T11:00:00.000Z'),
        updatedAt: new Date('2026-04-27T11:00:00.000Z'),
        members: [{ role: 'ADMIN' }]
      })
      .mockResolvedValueOnce({
        id: 'workspace_shared',
        name: 'Team Workspace',
        type: 'SHARED',
        createdAt: new Date('2026-04-27T11:00:00.000Z'),
        updatedAt: new Date('2026-04-27T11:00:00.000Z'),
        members: [{ role: 'ADMIN' }]
      });
    mockPrisma.globalImageGenerationSettings.findUnique.mockResolvedValue({
      id: 'global',
      isEnabled: false,
      defaultProviderKind: null,
      defaultModel: null,
      updatedAt: new Date('2026-04-27T11:10:00.000Z')
    });
    mockPrisma.workspaceImageGenerationSettings.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.workspaceImageGenerationSettings.findUnique.mockResolvedValue(null);

    const response = await request(
      '/api/workspaces/workspace_shared/image-generation-settings',
      workspaceImageGenerationSettingsPutHandler,
      {
        method: 'PUT',
        body: {
          isEnabled: null,
          providerKind: null,
          model: null
        }
      },
      '/api/workspaces/:workspaceId/image-generation-settings'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.workspaceImageGenerationSettings.deleteMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace_shared'
      }
    });
    expect(response.json.ok).toBe(true);
    expect(response.json.effectiveSettings.isEnabled).toBe(false);
  });

  it('rejects workspace image generation updates from non-admin members', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Team Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-27T11:00:00.000Z'),
      updatedAt: new Date('2026-04-27T11:00:00.000Z'),
      members: [{ role: 'VIEWER' }]
    });
    mockPrisma.globalImageGenerationSettings.findUnique.mockResolvedValue(null);

    const response = await request(
      '/api/workspaces/workspace_shared/image-generation-settings',
      workspaceImageGenerationSettingsPutHandler,
      {
        method: 'PUT',
        body: {
          isEnabled: true,
          providerKind: 'imagen',
          model: 'imagen-4.0-fast-generate-001'
        }
      },
      '/api/workspaces/:workspaceId/image-generation-settings'
    );

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Workspace admin access is required.');
    expect(mockPrisma.workspaceImageGenerationSettings.upsert).not.toHaveBeenCalled();
  });
});

function createSession(
  input: {
    globalRole?: 'USER' | 'GLOBAL_ADMIN';
  } = {}
) {
  return {
    sessionId: 'session_1',
    user: {
      id: 'user_1',
      email: 'user@example.com',
      globalRole: input.globalRole ?? 'USER',
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
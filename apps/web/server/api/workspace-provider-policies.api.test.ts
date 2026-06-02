import { createServer, request as httpRequest } from 'node:http';

import { createApp, createRouter, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Prisma } from '@pepetex/db';

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  workspace: {
    findFirst: vi.fn()
  },
  providerDefinition: {
    findMany: vi.fn()
  },
  workspaceProviderPolicy: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn()
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

import workspaceProviderPoliciesGetHandler from './workspaces/[workspaceId]/provider-policies.get';
import workspaceProviderPoliciesPutHandler from './workspaces/[workspaceId]/provider-policies.put';

describe('/api/workspaces/:workspaceId/provider-policies', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('lists workspace provider policies for any workspace member', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Team Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-25T08:00:00.000Z'),
      updatedAt: new Date('2026-04-25T08:00:00.000Z'),
      members: [{ role: 'VIEWER' }]
    });
    mockPrisma.workspaceProviderPolicy.findMany.mockResolvedValue([
      {
        id: 'policy_1',
        workspaceId: 'workspace_shared',
        allowedModelIdsJson: ['gpt-4.1-mini'],
        createdAt: new Date('2026-04-25T08:05:00.000Z'),
        updatedAt: new Date('2026-04-25T08:05:00.000Z'),
        providerDefinition: {
          id: 'provider_openai',
          name: 'Primary OpenAI',
          kind: 'OPENAI_COMPATIBLE',
          enabled: true
        }
      }
    ]);

    const response = await request(
      '/api/workspaces/workspace_shared/provider-policies',
      workspaceProviderPoliciesGetHandler,
      {},
      '/api/workspaces/:workspaceId/provider-policies'
    );

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      policies: [
        {
          id: 'policy_1',
          workspaceId: 'workspace_shared',
          providerDefinitionId: 'provider_openai',
          providerName: 'Primary OpenAI',
          providerKind: 'openai-compatible',
          providerEnabled: true,
          allowedModelIds: ['gpt-4.1-mini'],
          createdAt: '2026-04-25T08:05:00.000Z',
          updatedAt: '2026-04-25T08:05:00.000Z'
        }
      ]
    });
  });

  it('replaces workspace provider policies for workspace admins', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Team Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-25T08:00:00.000Z'),
      updatedAt: new Date('2026-04-25T08:00:00.000Z'),
      members: [{ role: 'ADMIN' }]
    });
    mockPrisma.providerDefinition.findMany.mockResolvedValue([
      {
        id: 'provider_gemini',
        enabled: true
      },
      {
        id: 'provider_openai',
        enabled: true
      }
    ]);
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) =>
      callback(mockPrisma)
    );
    mockPrisma.workspaceProviderPolicy.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.workspaceProviderPolicy.createMany.mockResolvedValue({ count: 2 });
    mockPrisma.workspaceProviderPolicy.findMany.mockResolvedValue([
      {
        id: 'policy_1',
        workspaceId: 'workspace_shared',
        allowedModelIdsJson: null,
        createdAt: new Date('2026-04-25T08:10:00.000Z'),
        updatedAt: new Date('2026-04-25T08:10:00.000Z'),
        providerDefinition: {
          id: 'provider_gemini',
          name: 'Primary Gemini',
          kind: 'GEMINI',
          enabled: true
        }
      },
      {
        id: 'policy_2',
        workspaceId: 'workspace_shared',
        allowedModelIdsJson: ['gpt-4.1-mini', 'gpt-4.1'],
        createdAt: new Date('2026-04-25T08:10:00.000Z'),
        updatedAt: new Date('2026-04-25T08:10:00.000Z'),
        providerDefinition: {
          id: 'provider_openai',
          name: 'Primary OpenAI',
          kind: 'OPENAI_COMPATIBLE',
          enabled: true
        }
      }
    ]);

    const response = await request(
      '/api/workspaces/workspace_shared/provider-policies',
      workspaceProviderPoliciesPutHandler,
      {
        method: 'PUT',
        body: {
          policies: [
            {
              providerDefinitionId: 'provider_gemini'
            },
            {
              providerDefinitionId: 'provider_openai',
              allowedModelIds: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1']
            }
          ]
        }
      },
      '/api/workspaces/:workspaceId/provider-policies'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.workspaceProviderPolicy.deleteMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace_shared'
      }
    });
    expect(mockPrisma.workspaceProviderPolicy.createMany).toHaveBeenCalledWith({
      data: [
        {
          workspaceId: 'workspace_shared',
          providerDefinitionId: 'provider_gemini',
          allowedModelIdsJson: Prisma.DbNull
        },
        {
          workspaceId: 'workspace_shared',
          providerDefinitionId: 'provider_openai',
          allowedModelIdsJson: ['gpt-4.1', 'gpt-4.1-mini']
        }
      ]
    });
    expect(response.json.ok).toBe(true);
    expect(response.json.policies).toHaveLength(2);
  });

  it('rejects provider policy updates from non-admin members', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Team Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-25T08:00:00.000Z'),
      updatedAt: new Date('2026-04-25T08:00:00.000Z'),
      members: [{ role: 'VIEWER' }]
    });

    const response = await request(
      '/api/workspaces/workspace_shared/provider-policies',
      workspaceProviderPoliciesPutHandler,
      {
        method: 'PUT',
        body: {
          policies: [
            {
              providerDefinitionId: 'provider_openai'
            }
          ]
        }
      },
      '/api/workspaces/:workspaceId/provider-policies'
    );

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Workspace admin access is required.');
    expect(mockPrisma.workspaceProviderPolicy.deleteMany).not.toHaveBeenCalled();
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

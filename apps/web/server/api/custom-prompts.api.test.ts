import { createServer, request as httpRequest } from 'node:http';

import { createApp, createRouter, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  workspace: {
    findFirst: vi.fn()
  },
  customPrompt: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  },
  customPromptVariant: {
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

import customPromptByIdDeleteHandler from './custom-prompts/[customPromptId].delete';
import customPromptByIdGetHandler from './custom-prompts/[customPromptId].get';
import customPromptByIdPatchHandler from './custom-prompts/[customPromptId].patch';
import customPromptsGetHandler from './custom-prompts.get';
import customPromptsPostHandler from './custom-prompts.post';

describe('/api/custom-prompts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication to list custom prompts', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const response = await request('/api/custom-prompts', customPromptsGetHandler);

    expect(response.status).toBe(401);
    expect(response.json.statusMessage).toBe('Authentication required.');
  });

  it('lists accessible global and personal prompts for the current user', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.customPrompt.findMany.mockResolvedValue([
      createCustomPromptRecord({
        id: 'prompt_global',
        scope: 'GLOBAL',
        title: 'Board Update',
        tagsJson: ['exec', 'quarterly'],
        variants: [createVariantRecord('variant_en', 'en', 'Write an executive quarterly update.')]
      }),
      createCustomPromptRecord({
        id: 'prompt_personal',
        scope: 'PERSONAL',
        title: 'My Sales Pitch',
        description: 'Personal reusable framing.',
        category: 'Sales',
        tagsJson: ['personal'],
        variants: [createVariantRecord('variant_id', 'id', 'Tulis pitch penjualan yang singkat.')]
      })
    ]);

    const response = await request('/api/custom-prompts', customPromptsGetHandler);

    expect(response.status).toBe(200);
    expect(mockPrisma.customPrompt.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { scope: 'GLOBAL' },
          {
            scope: 'PERSONAL',
            ownerUserId: 'user_1'
          }
        ]
      },
      orderBy: [{ createdAt: 'desc' }],
      include: expect.any(Object)
    });
    expect(response.json.customPrompts).toHaveLength(2);
    expect(response.json.customPrompts[0]).toMatchObject({
      id: 'prompt_global',
      scope: 'global',
      tags: ['exec', 'quarterly']
    });
    expect(response.json.customPrompts[1]).toMatchObject({
      id: 'prompt_personal',
      scope: 'personal',
      category: 'Sales'
    });
  });

  it('creates a personal custom prompt for the current user', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.customPrompt.create.mockResolvedValue(
      createCustomPromptRecord({
        id: 'prompt_personal',
        scope: 'PERSONAL',
        title: 'Launch Brief',
        category: 'Marketing',
        tagsJson: ['launch', 'marketing'],
        variants: [
          createVariantRecord('variant_en', 'en', 'Create a launch brief for internal stakeholders.'),
          createVariantRecord('variant_id', 'id', 'Buat ringkasan peluncuran untuk pemangku kepentingan internal.')
        ]
      })
    );

    const response = await request('/api/custom-prompts', customPromptsPostHandler, {
      method: 'POST',
      body: {
        scope: 'personal',
        title: 'Launch Brief',
        category: 'Marketing',
        tags: ['marketing', 'launch'],
        variants: [
          {
            languageCode: 'en',
            instruction: 'Create a launch brief for internal stakeholders.'
          },
          {
            languageCode: 'id',
            instruction: 'Buat ringkasan peluncuran untuk pemangku kepentingan internal.'
          }
        ]
      }
    });

    expect(response.status).toBe(201);
    expect(mockPrisma.customPrompt.create).toHaveBeenCalledWith({
      data: {
        scope: 'PERSONAL',
        ownerUserId: 'user_1',
        title: 'Launch Brief',
        description: null,
        category: 'Marketing',
        tagsJson: ['launch', 'marketing'],
        variants: {
          create: [
            {
              languageCode: 'en',
              instruction: 'Create a launch brief for internal stakeholders.'
            },
            {
              languageCode: 'id',
              instruction: 'Buat ringkasan peluncuran untuk pemangku kepentingan internal.'
            }
          ]
        }
      },
      include: expect.any(Object)
    });
    expect(response.json.customPrompt).toMatchObject({
      id: 'prompt_personal',
      scope: 'personal',
      tags: ['launch', 'marketing']
    });
  });

  it('requires workspace admin access to create workspace custom prompts', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('EDITOR'));

    const response = await request('/api/custom-prompts', customPromptsPostHandler, {
      method: 'POST',
      body: {
        scope: 'workspace',
        workspaceId: 'workspace_shared',
        title: 'Team Prompt',
        variants: [
          {
            languageCode: 'en',
            instruction: 'Use the team tone.'
          }
        ]
      }
    });

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Workspace admin access is required.');
    expect(mockPrisma.customPrompt.create).not.toHaveBeenCalled();
  });

  it('creates a workspace custom prompt for workspace admins', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('ADMIN'));
    mockPrisma.customPrompt.create.mockResolvedValue(
      createCustomPromptRecord({
        id: 'prompt_workspace',
        scope: 'WORKSPACE',
        title: 'Team Prompt',
        workspace: {
          id: 'workspace_shared',
          name: 'Team Workspace'
        },
        tagsJson: ['team'],
        variants: [createVariantRecord('variant_en', 'en', 'Use the team tone.')]
      })
    );

    const response = await request('/api/custom-prompts', customPromptsPostHandler, {
      method: 'POST',
      body: {
        scope: 'workspace',
        workspaceId: 'workspace_shared',
        title: 'Team Prompt',
        tags: ['team'],
        variants: [
          {
            languageCode: 'en',
            instruction: 'Use the team tone.'
          }
        ]
      }
    });

    expect(response.status).toBe(201);
    expect(mockPrisma.customPrompt.create).toHaveBeenCalledWith({
      data: {
        scope: 'WORKSPACE',
        workspaceId: 'workspace_shared',
        title: 'Team Prompt',
        description: null,
        category: null,
        tagsJson: ['team'],
        variants: {
          create: [
            {
              languageCode: 'en',
              instruction: 'Use the team tone.'
            }
          ]
        }
      },
      include: expect.any(Object)
    });
    expect(response.json.customPrompt.workspaceId).toBe('workspace_shared');
  });

  it('allows only global admins to create global custom prompts', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());

    const response = await request('/api/custom-prompts', customPromptsPostHandler, {
      method: 'POST',
      body: {
        scope: 'global',
        title: 'Company Default',
        variants: [
          {
            languageCode: 'en',
            instruction: 'Use the company-wide default structure.'
          }
        ]
      }
    });

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Global admin access is required.');
  });

  it('loads a workspace custom prompt for members of that workspace', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.customPrompt.findUnique.mockResolvedValue(
      createCustomPromptRecord({
        id: 'prompt_workspace',
        scope: 'WORKSPACE',
        title: 'Team Prompt',
        workspace: {
          id: 'workspace_shared',
          name: 'Team Workspace'
        },
        variants: [createVariantRecord('variant_en', 'en', 'Use the team tone.')]
      })
    );
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('VIEWER'));

    const response = await request(
      '/api/custom-prompts/prompt_workspace',
      customPromptByIdGetHandler,
      {},
      '/api/custom-prompts/:customPromptId'
    );

    expect(response.status).toBe(200);
    expect(response.json.customPrompt).toMatchObject({
      id: 'prompt_workspace',
      workspaceName: 'Team Workspace'
    });
  });

  it('updates a personal custom prompt and replaces language variants', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.customPrompt.findUnique
      .mockResolvedValueOnce(
        createCustomPromptRecord({
          id: 'prompt_personal',
          scope: 'PERSONAL',
          ownerUserId: 'user_1',
          title: 'Old Prompt',
          category: 'Old',
          tagsJson: ['legacy'],
          variants: [createVariantRecord('variant_old', 'en', 'Old instruction.')]
        })
      )
      .mockResolvedValueOnce(
        createCustomPromptRecord({
          id: 'prompt_personal',
          scope: 'PERSONAL',
          ownerUserId: 'user_1',
          title: 'Updated Prompt',
          tagsJson: ['fresh', 'updated'],
          variants: [
            createVariantRecord('variant_en', 'en', 'Updated English instruction.'),
            createVariantRecord('variant_id', 'id', 'Instruksi bahasa Indonesia yang diperbarui.')
          ]
        })
      );
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) =>
      callback(mockPrisma)
    );
    mockPrisma.customPrompt.update.mockResolvedValue({ id: 'prompt_personal' });
    mockPrisma.customPromptVariant.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.customPromptVariant.createMany.mockResolvedValue({ count: 2 });

    const response = await request(
      '/api/custom-prompts/prompt_personal',
      customPromptByIdPatchHandler,
      {
        method: 'PATCH',
        body: {
          title: 'Updated Prompt',
          category: '',
          tags: ['updated', 'fresh'],
          variants: [
            {
              languageCode: 'en',
              instruction: 'Updated English instruction.'
            },
            {
              languageCode: 'id',
              instruction: 'Instruksi bahasa Indonesia yang diperbarui.'
            }
          ]
        }
      },
      '/api/custom-prompts/:customPromptId'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.customPrompt.update).toHaveBeenCalledWith({
      where: { id: 'prompt_personal' },
      data: {
        title: 'Updated Prompt',
        category: null,
        tagsJson: ['fresh', 'updated']
      }
    });
    expect(mockPrisma.customPromptVariant.deleteMany).toHaveBeenCalledWith({
      where: {
        customPromptId: 'prompt_personal'
      }
    });
    expect(mockPrisma.customPromptVariant.createMany).toHaveBeenCalledWith({
      data: [
        {
          customPromptId: 'prompt_personal',
          languageCode: 'en',
          instruction: 'Updated English instruction.'
        },
        {
          customPromptId: 'prompt_personal',
          languageCode: 'id',
          instruction: 'Instruksi bahasa Indonesia yang diperbarui.'
        }
      ]
    });
    expect(response.json.customPrompt).toMatchObject({
      id: 'prompt_personal',
      title: 'Updated Prompt',
      tags: ['fresh', 'updated']
    });
  });

  it('deletes a workspace custom prompt for workspace admins', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.customPrompt.findUnique.mockResolvedValue(
      createCustomPromptRecord({
        id: 'prompt_workspace',
        scope: 'WORKSPACE',
        title: 'Team Prompt',
        workspace: {
          id: 'workspace_shared',
          name: 'Team Workspace'
        },
        variants: [createVariantRecord('variant_en', 'en', 'Use the team tone.')]
      })
    );
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('OWNER'));
    mockPrisma.customPrompt.delete.mockResolvedValue({ id: 'prompt_workspace' });

    const response = await request(
      '/api/custom-prompts/prompt_workspace',
      customPromptByIdDeleteHandler,
      {
        method: 'DELETE'
      },
      '/api/custom-prompts/:customPromptId'
    );

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ ok: true });
    expect(mockPrisma.customPrompt.delete).toHaveBeenCalledWith({
      where: { id: 'prompt_workspace' }
    });
  });
});

function userSession() {
  return {
    sessionId: 'session_user',
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
    createdAt: new Date('2026-04-25T11:00:00.000Z'),
    updatedAt: new Date('2026-04-25T11:05:00.000Z'),
    members: [{ role }]
  };
}

function createCustomPromptRecord(input: {
  id: string;
  scope: 'PERSONAL' | 'WORKSPACE' | 'GLOBAL';
  ownerUserId?: string | null;
  title: string;
  description?: string | null;
  category?: string | null;
  tagsJson?: string[] | null;
  workspace?: {
    id: string;
    name: string;
  } | null;
  variants: Array<{
    id: string;
    languageCode: string;
    instruction: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  return {
    id: input.id,
    scope: input.scope,
    ownerUserId: input.ownerUserId ?? null,
    workspaceId: input.workspace?.id ?? null,
    title: input.title,
    description: input.description ?? null,
    category: input.category ?? null,
    tagsJson: input.tagsJson ?? null,
    createdAt: new Date('2026-04-25T11:10:00.000Z'),
    updatedAt: new Date('2026-04-25T11:15:00.000Z'),
    workspace: input.workspace ?? null,
    variants: input.variants
  };
}

function createVariantRecord(id: string, languageCode: string, instruction: string) {
  return {
    id,
    languageCode,
    instruction,
    createdAt: new Date('2026-04-25T11:20:00.000Z'),
    updatedAt: new Date('2026-04-25T11:25:00.000Z')
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

import { createServer, request as httpRequest } from 'node:http';

import { createApp, createRouter, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateLegacyDesignSystemDocument } from '@pepetex/design-systems';

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  workspace: {
    findFirst: vi.fn()
  },
  designSystem: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
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

import designSystemByIdDeleteHandler from './design-systems/[designSystemId].delete';
import designSystemByIdDuplicateHandler from './design-systems/[designSystemId]/duplicate.post';
import designSystemByIdExportHandler from './design-systems/[designSystemId]/export.get';
import designSystemByIdGetHandler from './design-systems/[designSystemId].get';
import designSystemByIdPatchHandler from './design-systems/[designSystemId].patch';
import designSystemsGetHandler from './design-systems.get';
import designSystemsImportHandler from './design-systems/import.post';
import designSystemsPostHandler from './design-systems.post';

describe('/api/design-systems', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication to list design systems', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(null);

    const response = await request('/api/design-systems', designSystemsGetHandler);

    expect(response.status).toBe(401);
    expect(response.json.statusMessage).toBe('Authentication required.');
  });

  it('lists accessible personal and global design systems', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.designSystem.findMany.mockResolvedValue([
      createDesignSystemRecord({
        id: 'ds_global',
        scope: 'GLOBAL',
        name: 'Corporate Default'
      }),
      createDesignSystemRecord({
        id: 'ds_personal',
        scope: 'PERSONAL',
        ownerUserId: 'user_1',
        name: 'My Team Deck'
      })
    ]);

    const response = await request('/api/design-systems', designSystemsGetHandler);

    expect(response.status).toBe(200);
    expect(mockPrisma.designSystem.findMany).toHaveBeenCalledWith({
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
    expect(response.json.designSystems).toHaveLength(2);
    expect(response.json.designSystems[0]).toMatchObject({
      id: 'ds_global',
      scope: 'global',
      versionCount: 1
    });
  });

  it('creates a workspace design system for workspace admins', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('ADMIN'));
    mockPrisma.designSystem.create.mockResolvedValue(
      createDesignSystemRecord({
        id: 'ds_workspace',
        scope: 'WORKSPACE',
        name: 'Workspace System',
        workspace: {
          id: 'workspace_shared',
          name: 'Shared Workspace'
        }
      })
    );

    const response = await request('/api/design-systems', designSystemsPostHandler, {
      method: 'POST',
      body: {
        scope: 'workspace',
        workspaceId: 'workspace_shared',
        name: 'Workspace System',
        description: 'Shared design system',
        tokens: {
          colors: [],
          typography: [],
          spacing: []
        },
        components: [],
        exampleSlides: []
      }
    });

    expect(response.status).toBe(201);
    expect(mockPrisma.designSystem.create).toHaveBeenCalledWith({
      data: {
        scope: 'WORKSPACE',
        workspaceId: 'workspace_shared',
        name: 'Workspace System',
        description: 'Shared design system',
        isEnabled: true,
        currentVersionNumber: 1,
        versions: {
          create: {
            versionNumber: 1,
            label: 'Initial version',
            summary: null,
            documentJson: migrateLegacyDesignSystemDocument({ tokens: { colors: [], typography: [], spacing: [] }, components: [], exampleSlides: [], archetypes: [], rules: [] }),
            createdByUserId: 'user_1'
          }
        }
      },
      include: expect.any(Object)
    });
    expect(response.json.designSystem).toMatchObject({
      id: 'ds_workspace',
      workspaceId: 'workspace_shared'
    });
  });

  it('requires workspace admin access to create a workspace design system', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('EDITOR'));

    const response = await request('/api/design-systems', designSystemsPostHandler, {
      method: 'POST',
      body: {
        scope: 'workspace',
        workspaceId: 'workspace_shared',
        name: 'Blocked System',
        tokens: {
          colors: [],
          typography: [],
          spacing: []
        },
        components: [],
        exampleSlides: []
      }
    });

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Workspace admin access is required.');
    expect(mockPrisma.designSystem.create).not.toHaveBeenCalled();
  });

  it('loads a workspace design system for workspace members', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.designSystem.findUnique.mockResolvedValue(
      createDesignSystemRecord({
        id: 'ds_workspace',
        scope: 'WORKSPACE',
        name: 'Workspace System',
        workspace: {
          id: 'workspace_shared',
          name: 'Shared Workspace'
        }
      })
    );
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('VIEWER'));

    const response = await request(
      '/api/design-systems/ds_workspace',
      designSystemByIdGetHandler,
      {},
      '/api/design-systems/:designSystemId'
    );

    expect(response.status).toBe(200);
    expect(response.json.designSystem).toMatchObject({
      id: 'ds_workspace',
      workspaceName: 'Shared Workspace'
    });
  });

  it('creates a new version when design-system content changes', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.designSystem.findUnique
      .mockResolvedValueOnce(
        createDesignSystemRecord({
          id: 'ds_personal',
          scope: 'PERSONAL',
          ownerUserId: 'user_1',
          name: 'Personal System'
        })
      )
      .mockResolvedValueOnce(
        createDesignSystemRecord({
          id: 'ds_personal',
          scope: 'PERSONAL',
          ownerUserId: 'user_1',
          name: 'Personal System v2',
          currentVersionNumber: 2,
          versions: [
            createVersionRecord({
              id: 'version_2',
              versionNumber: 2,
              label: 'Version 2',
              tokensJson: {
                colors: [
                  {
                    id: 'brand-primary',
                    label: 'Brand Primary',
                    value: '#112233',
                    usage: null
                  }
                ],
                typography: [],
                spacing: []
              }
            }),
            createVersionRecord()
          ]
        })
      );
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) =>
      callback(mockPrisma)
    );
    mockPrisma.designSystem.update.mockResolvedValue({ id: 'ds_personal' });

    const response = await request(
      '/api/design-systems/ds_personal',
      designSystemByIdPatchHandler,
      {
        method: 'PATCH',
        body: {
          name: 'Personal System v2',
          versionSummary: 'Refined brand colors.',
          tokens: {
            colors: [
              {
                id: 'brand-primary',
                label: 'Brand Primary',
                value: '#112233',
                usage: ''
              }
            ],
            typography: [],
            spacing: []
          }
        }
      },
      '/api/design-systems/:designSystemId'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.designSystem.update).toHaveBeenCalledWith({
      where: { id: 'ds_personal' },
      data: {
        name: 'Personal System v2',
        currentVersionNumber: 2,
        versions: {
          create: {
            versionNumber: 2,
            label: 'Version 2',
            summary: 'Refined brand colors.',
            documentJson: migrateLegacyDesignSystemDocument({
              tokens: { colors: [{ id: 'brand-primary', label: 'Brand Primary', value: '#112233', usage: null }], typography: [], spacing: [] },
              components: [],
              exampleSlides: [],
              archetypes: [],
              rules: []
            }),
            createdByUserId: 'user_1'
          }
        }
      }
    });
    expect(response.json.designSystem).toMatchObject({
      id: 'ds_personal',
      currentVersionNumber: 2
    });
  });

  it('deletes a personal design system for its owner', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.designSystem.findUnique.mockResolvedValue(
      createDesignSystemRecord({
        id: 'ds_personal',
        scope: 'PERSONAL',
        ownerUserId: 'user_1',
        name: 'Personal System'
      })
    );
    mockPrisma.designSystem.delete.mockResolvedValue({ id: 'ds_personal' });

    const response = await request(
      '/api/design-systems/ds_personal',
      designSystemByIdDeleteHandler,
      {
        method: 'DELETE'
      },
      '/api/design-systems/:designSystemId'
    );

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ ok: true });
    expect(mockPrisma.designSystem.delete).toHaveBeenCalledWith({
      where: { id: 'ds_personal' }
    });
  });

  it('duplicates a global design system into a personal copy by default', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.designSystem.findUnique.mockResolvedValue(
      createDesignSystemRecord({
        id: 'ds_global',
        scope: 'GLOBAL',
        name: 'Corporate Default',
        versions: [
          createVersionRecord({
            label: 'Brand refresh',
            summary: 'Updated shared components.'
          })
        ]
      })
    );
    mockPrisma.designSystem.create.mockResolvedValue(
      createDesignSystemRecord({
        id: 'ds_copy',
        scope: 'PERSONAL',
        ownerUserId: 'user_1',
        name: 'Corporate Default Copy',
        versions: [
          createVersionRecord({
            label: 'Duplicated from Corporate Default',
            summary: 'Updated shared components.'
          })
        ]
      })
    );

    const response = await request(
      '/api/design-systems/ds_global/duplicate',
      designSystemByIdDuplicateHandler,
      {
        method: 'POST'
      },
      '/api/design-systems/:designSystemId/duplicate'
    );

    expect(response.status).toBe(201);
    expect(mockPrisma.designSystem.create).toHaveBeenCalledWith({
      data: {
        scope: 'PERSONAL',
        ownerUserId: 'user_1',
        name: 'Corporate Default Copy',
        description: null,
        isEnabled: true,
        currentVersionNumber: 1,
        versions: {
          create: {
            versionNumber: 1,
            label: 'Duplicated from Corporate Default',
            summary: 'Updated shared components.',
            documentJson: migrateLegacyDesignSystemDocument({ tokens: { colors: [], typography: [], spacing: [] }, components: [], exampleSlides: [], archetypes: [], rules: [] }),
            createdByUserId: 'user_1'
          }
        }
      },
      include: expect.any(Object)
    });
    expect(response.json.designSystem).toMatchObject({
      id: 'ds_copy',
      scope: 'personal',
      name: 'Corporate Default Copy'
    });
  });

  it('requires workspace admin access to duplicate into a workspace scope', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.designSystem.findUnique.mockResolvedValue(
      createDesignSystemRecord({
        id: 'ds_personal',
        scope: 'PERSONAL',
        ownerUserId: 'user_1',
        name: 'Personal System'
      })
    );
    mockPrisma.workspace.findFirst.mockResolvedValue(sharedWorkspaceAccess('EDITOR'));

    const response = await request(
      '/api/design-systems/ds_personal/duplicate',
      designSystemByIdDuplicateHandler,
      {
        method: 'POST',
        body: {
          scope: 'workspace',
          workspaceId: 'workspace_shared'
        }
      },
      '/api/design-systems/:designSystemId/duplicate'
    );

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Workspace admin access is required.');
    expect(mockPrisma.designSystem.create).not.toHaveBeenCalled();
  });

  it('exports a design system as a portable payload', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.designSystem.findUnique.mockResolvedValue(
      createDesignSystemRecord({
        id: 'ds_personal',
        scope: 'PERSONAL',
        ownerUserId: 'user_1',
        name: 'Personal System',
        description: 'Portable design system',
        versions: [
          createVersionRecord({
            id: 'version_5',
            versionNumber: 5,
            label: 'Version 5',
            summary: 'Ready for export.',
            tokensJson: {
              colors: [
                {
                  id: 'brand-primary',
                  label: 'Brand Primary',
                  value: '#123456',
                  usage: null
                }
              ],
              typography: [],
              spacing: []
            }
          })
        ],
        currentVersionNumber: 5
      })
    );

    const response = await request(
      '/api/design-systems/ds_personal/export',
      designSystemByIdExportHandler,
      {},
      '/api/design-systems/:designSystemId/export'
    );

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      format: 'pepetex-design-system',
      version: 1,
      source: {
        id: 'ds_personal',
        scope: 'personal',
        name: 'Personal System',
        description: 'Portable design system',
        currentVersionNumber: 5
      },
      currentVersion: {
        versionNumber: 5,
        label: 'Version 5',
        summary: 'Ready for export.',
        document: {
          tokens: {
            colors: [
              {
                id: 'brand-primary',
                label: 'Brand Primary',
                value: '#123456',
                usage: null
              }
            ]
          }
        }
      }
    });
  });

  it('imports an exported design system into a personal design system by default', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.designSystem.create.mockResolvedValue(
      createDesignSystemRecord({
        id: 'ds_imported',
        scope: 'PERSONAL',
        ownerUserId: 'user_1',
        name: 'Imported System',
        description: 'Imported from export'
      })
    );

    const response = await request('/api/design-systems/import', designSystemsImportHandler, {
      method: 'POST',
      body: {
        name: 'Imported System',
        exportPayload: {
          format: 'pepetex-design-system',
          version: 1,
          exportedAt: '2026-04-27T08:30:00.000Z',
          source: {
            id: 'ds_exported',
            scope: 'workspace',
            workspaceId: 'workspace_shared',
            workspaceName: 'Shared Workspace',
            name: 'Workspace System',
            description: 'Imported from export',
            isEnabled: true,
            currentVersionNumber: 3
          },
          currentVersion: {
            versionNumber: 3,
            label: 'Version 3',
            summary: 'Imported from a workspace export.',
            document: {
              tokens: {
                colors: [],
                typography: [],
                spacing: []
              },
              components: [],
              exampleSlides: []
            }
          }
        }
      }
    });

    expect(response.status).toBe(201);
    expect(mockPrisma.designSystem.create).toHaveBeenCalledWith({
      data: {
        scope: 'PERSONAL',
        ownerUserId: 'user_1',
        name: 'Imported System',
        description: 'Imported from export',
        isEnabled: true,
        currentVersionNumber: 1,
        versions: {
          create: {
            versionNumber: 1,
            label: 'Version 3',
            summary: 'Imported from a workspace export.',
            documentJson: migrateLegacyDesignSystemDocument({ tokens: { colors: [], typography: [], spacing: [] }, components: [], exampleSlides: [], archetypes: [], rules: [] }),
            createdByUserId: 'user_1'
          }
        }
      },
      include: expect.any(Object)
    });
    expect(response.json.designSystem).toMatchObject({
      id: 'ds_imported',
      scope: 'personal',
      name: 'Imported System'
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
    name: 'Shared Workspace',
    type: 'SHARED',
    createdAt: new Date('2026-04-26T08:00:00.000Z'),
    updatedAt: new Date('2026-04-26T08:05:00.000Z'),
    members: [{ role }]
  };
}

function createDesignSystemRecord(input: {
  id: string;
  scope: 'PERSONAL' | 'WORKSPACE' | 'GLOBAL';
  ownerUserId?: string | null;
  workspace?: {
    id: string;
    name: string;
  } | null;
  name: string;
  description?: string | null;
  isEnabled?: boolean;
  currentVersionNumber?: number;
  versions?: ReturnType<typeof createVersionRecord>[];
}) {
  const versions = input.versions ?? [createVersionRecord()];

  return {
    id: input.id,
    scope: input.scope,
    ownerUserId: input.ownerUserId ?? null,
    workspaceId: input.workspace?.id ?? null,
    name: input.name,
    description: input.description ?? null,
    isEnabled: input.isEnabled ?? true,
    currentVersionNumber: input.currentVersionNumber ?? versions[0]?.versionNumber ?? 1,
    createdAt: new Date('2026-04-26T08:10:00.000Z'),
    updatedAt: new Date('2026-04-26T08:15:00.000Z'),
    workspace: input.workspace ?? null,
    versions,
    _count: {
      versions: versions.length
    }
  };
}

function createVersionRecord(input: {
  id?: string;
  versionNumber?: number;
  label?: string;
  summary?: string | null;
  tokensJson?: unknown;
  componentsJson?: unknown;
  exampleSlidesJson?: unknown;
} = {}) {
  const tokensJson = input.tokensJson ?? { colors: [], typography: [], spacing: [] };
  const componentsJson = input.componentsJson ?? [];
  const exampleSlidesJson = input.exampleSlidesJson ?? [];
  return {
    id: input.id ?? 'version_1',
    versionNumber: input.versionNumber ?? 1,
    label: input.label ?? 'Initial version',
    summary: input.summary ?? null,
    // The store is V2-only; build documentJson from the legacy-shaped test inputs.
    documentJson: migrateLegacyDesignSystemDocument({
      tokens: tokensJson as never,
      components: componentsJson as never,
      exampleSlides: exampleSlidesJson as never,
      archetypes: [],
      rules: []
    }),
    createdAt: new Date('2026-04-26T08:20:00.000Z'),
    createdByUser: {
      id: 'user_1',
      email: 'user@example.com',
      profile: {
        name: 'User One'
      }
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

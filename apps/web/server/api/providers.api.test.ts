import { createServer, request as httpRequest } from 'node:http';

import { createApp, createRouter, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptProviderCredentialPayload } from '@pepetex/providers';

const mockPrisma = vi.hoisted(() => ({
  auditLog: {
    create: vi.fn()
  },
  providerDefinition: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn()
  },
  workspace: {
    findFirst: vi.fn()
  },
  workspaceProviderPolicy: {
    findMany: vi.fn()
  },
  providerCredential: {
    count: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn()
  },
  providerModelCache: {
    findFirst: vi.fn(),
    upsert: vi.fn()
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

import adminProvidersPatchHandler from './admin/providers/[providerId].patch';
import adminProvidersPostHandler from './admin/providers.post';
import providerCredentialsPatchHandler from './provider-credentials/[credentialId].patch';
import providerCredentialRevealHandler from './provider-credentials/[credentialId]/reveal.post';
import providerCredentialsPostHandler from './provider-credentials.post';
import providerCostEstimatePostHandler from './providers/[providerId]/cost-estimate.post';
import providerModelsGetHandler from './providers/[providerId]/models.get';
import providerTestPostHandler from './providers/[providerId]/test.post';
import providersGetHandler from './providers.get';

describe('/api/providers', () => {
  const encryptionKey = Buffer.alloc(32, 9).toString('base64');

  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
  });

  it('creates provider definitions for global admins', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(adminSession());
    mockPrisma.providerDefinition.create.mockResolvedValue({
      id: 'provider_1',
      name: 'Primary Gemini',
      kind: 'GEMINI',
      enabled: true,
      allowUserCredentials: false,
      baseUrl: null,
      credentials: []
    });

    const response = await request('/api/admin/providers', adminProvidersPostHandler, {
      method: 'POST',
      body: {
        name: 'Primary Gemini',
        kind: 'gemini'
      }
    });

    expect(response.status).toBe(201);
    expect(mockPrisma.providerDefinition.create).toHaveBeenCalledWith({
      data: {
        name: 'Primary Gemini',
        kind: 'GEMINI',
        enabled: true,
        allowUserCredentials: false,
        baseUrl: null
      },
      include: {
        credentials: {
          where: {
            scope: 'SYSTEM'
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });
    expect(response.json.provider).toMatchObject({
      id: 'provider_1',
      name: 'Primary Gemini',
      kind: 'gemini',
      enabled: true,
      allowUserCredentials: false,
      hasSystemCredential: false,
      userCredentials: [],
      systemCredentials: []
    });
  });

  it('updates provider definitions for global admins', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(adminSession());
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_1',
      kind: 'OPENAI_COMPATIBLE',
      baseUrl: 'https://example.com/v1'
    });
    mockPrisma.providerDefinition.update.mockResolvedValue({
      id: 'provider_1',
      name: 'Primary OpenAI-Compatible',
      kind: 'OPENAI_COMPATIBLE',
      enabled: true,
      allowUserCredentials: true,
      baseUrl: 'https://example.com/v1',
      credentials: []
    });

    const response = await request(
      '/api/admin/providers/provider_1',
      adminProvidersPatchHandler,
      {
        method: 'PATCH',
        body: {
          allowUserCredentials: true
        }
      },
      '/api/admin/providers/:providerId'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.providerDefinition.update).toHaveBeenCalledWith({
      where: { id: 'provider_1' },
      data: {
        allowUserCredentials: true
      },
      include: {
        credentials: {
          where: {
            scope: 'SYSTEM'
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });
  });

  it('lists enabled providers for users with masked credentials', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.providerDefinition.findMany.mockResolvedValue([
      {
        id: 'provider_1',
        name: 'Gemini Shared',
        kind: 'GEMINI',
        enabled: true,
        allowUserCredentials: true,
        baseUrl: null,
        credentials: [
          {
            id: 'credential_1',
            scope: 'USER',
            label: 'Personal Key',
            apiKeyPreview: 'sk-t***********1234',
            createdAt: new Date('2026-04-25T02:00:00.000Z'),
            updatedAt: new Date('2026-04-25T02:00:00.000Z')
          }
        ]
      }
    ]);
    mockPrisma.providerCredential.count.mockResolvedValue(1);

    const response = await request('/api/providers', providersGetHandler);

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      providers: [
        {
          id: 'provider_1',
          name: 'Gemini Shared',
          kind: 'gemini',
          enabled: true,
          allowUserCredentials: true,
          baseUrl: null,
          hasSystemCredential: true,
          userCredentials: [
            {
              id: 'credential_1',
              scope: 'user',
              label: 'Personal Key',
              apiKeyPreview: 'sk-t***********1234',
              createdAt: '2026-04-25T02:00:00.000Z',
              updatedAt: '2026-04-25T02:00:00.000Z'
            }
          ]
        }
      ]
    });
  });

  it('includes manual model metadata in provider credential summaries', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(adminSession());
    mockPrisma.providerDefinition.findMany.mockResolvedValue([
      {
        id: 'provider_1',
        name: 'Gemini Shared',
        kind: 'GEMINI',
        enabled: true,
        allowUserCredentials: true,
        baseUrl: null,
        credentials: [
          {
            id: 'credential_1',
            scope: 'SYSTEM',
            label: 'Default',
            apiKeyPreview: 'gem********cret',
            encryptedPayload: encryptProviderCredentialPayload(
              {
                apiKey: 'gemini-secret',
                manualModels: [{ id: 'gemini-3.1-pro-preview', label: 'Advanced Model' }]
              },
              encryptionKey
            ),
            createdAt: new Date('2026-04-25T02:00:00.000Z'),
            updatedAt: new Date('2026-04-25T02:00:00.000Z')
          }
        ]
      }
    ]);

    const response = await request('/api/providers', providersGetHandler);

    expect(response.status).toBe(200);
    expect(response.json.providers[0]?.systemCredentials[0]?.manualModels).toEqual([
      { id: 'gemini-3.1-pro-preview', label: 'Advanced Model' }
    ]);
  });

  it('filters workspace-scoped provider listings to allowed providers', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Team Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-25T08:00:00.000Z'),
      updatedAt: new Date('2026-04-25T08:00:00.000Z'),
      members: [{ role: 'EDITOR' }]
    });
    mockPrisma.workspaceProviderPolicy.findMany.mockResolvedValue([
      {
        providerDefinitionId: 'provider_1',
        allowedModelIdsJson: null
      }
    ]);
    mockPrisma.providerDefinition.findMany.mockResolvedValue([
      {
        id: 'provider_1',
        name: 'Gemini Shared',
        kind: 'GEMINI',
        enabled: true,
        allowUserCredentials: true,
        baseUrl: null,
        credentials: []
      }
    ]);
    mockPrisma.providerCredential.count.mockResolvedValue(1);

    const response = await request(
      '/api/providers?workspaceId=workspace_shared',
      providersGetHandler,
      {},
      '/api/providers'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.providerDefinition.findMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        id: {
          in: ['provider_1']
        }
      },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
      include: {
        credentials: {
          where: {
            ownerUserId: 'user_1'
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });
    expect(response.json.providers).toHaveLength(1);
    expect(response.json.providers[0]?.id).toBe('provider_1');
  });

  it('stores provider credentials encrypted at rest', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_1',
      enabled: true,
      allowUserCredentials: true
    });
    mockPrisma.providerCredential.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'credential_1',
      scope: data.scope,
      label: data.label,
      apiKeyPreview: data.apiKeyPreview,
      createdAt: new Date('2026-04-25T03:00:00.000Z'),
      updatedAt: new Date('2026-04-25T03:00:00.000Z')
    }));

    const response = await request('/api/provider-credentials', providerCredentialsPostHandler, {
      method: 'POST',
      body: {
        providerDefinitionId: 'provider_1',
        label: 'Personal Key',
        apiKey: 'sk-test-secret-1234',
        organizationId: 'org_123'
      }
    });

    expect(response.status).toBe(201);
    const createInput = mockPrisma.providerCredential.create.mock.calls[0]?.[0]?.data;
    expect(createInput.providerDefinitionId).toBe('provider_1');
    expect(createInput.ownerUserId).toBe('user_1');
    expect(createInput.scope).toBe('USER');
    expect(createInput.apiKeyPreview).toBe('sk-t***********1234');
    expect(String(createInput.encryptedPayload)).not.toContain('sk-test-secret-1234');
    expect(response.json).toEqual({
      ok: true,
      credential: {
        id: 'credential_1',
        scope: 'user',
        label: 'Personal Key',
        apiKeyPreview: 'sk-t***********1234',
        createdAt: '2026-04-25T03:00:00.000Z',
        updatedAt: '2026-04-25T03:00:00.000Z'
      }
    });
  });

  it('requires global admin access for system credentials', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_1',
      enabled: true,
      allowUserCredentials: true
    });

    const response = await request('/api/provider-credentials', providerCredentialsPostHandler, {
      method: 'POST',
      body: {
        providerDefinitionId: 'provider_1',
        label: 'System Key',
        apiKey: 'sk-test-secret-1234',
        scope: 'system'
      }
    });

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe(
      'Global admin access is required for system provider credentials.'
    );
  });

  it('updates only owned user credentials', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.providerCredential.findUnique.mockResolvedValue({
      id: 'credential_1',
      scope: 'USER',
      ownerUserId: 'user_1',
      label: 'Personal Key',
      encryptedPayload: encryptProviderCredentialPayload(
        {
          apiKey: 'sk-old-secret-9999'
        },
        encryptionKey
      ),
      apiKeyPreview: 'sk-o************9999',
      providerDefinition: {
        enabled: true,
        allowUserCredentials: true
      }
    });
    mockPrisma.providerCredential.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'credential_1',
      scope: 'USER',
      label: data.label,
      apiKeyPreview: data.apiKeyPreview,
      createdAt: new Date('2026-04-25T03:00:00.000Z'),
      updatedAt: new Date('2026-04-25T04:00:00.000Z')
    }));

    const response = await request(
      '/api/provider-credentials/credential_1',
      providerCredentialsPatchHandler,
      {
        method: 'PATCH',
        body: {
          label: 'Rotated Personal Key',
          apiKey: 'sk-rotated-secret-9999'
        }
      },
      '/api/provider-credentials/:credentialId'
    );

    expect(response.status).toBe(200);
    const updateInput = mockPrisma.providerCredential.update.mock.calls[0]?.[0]?.data;
    expect(updateInput.label).toBe('Rotated Personal Key');
    expect(updateInput.apiKeyPreview).toBe('sk-r**************9999');
    expect(String(updateInput.encryptedPayload)).not.toContain('sk-rotated-secret-9999');
  });

  it('reveals stored provider credentials for global admins and writes an audit log', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(adminSession());
    mockPrisma.providerCredential.findUnique.mockResolvedValue({
      id: 'credential_system_1',
      providerDefinitionId: 'provider_1',
      scope: 'SYSTEM',
      ownerUserId: null,
      label: 'Primary System Key',
      encryptedPayload: encryptProviderCredentialPayload(
        {
          apiKey: 'sk-system-secret-9999',
          organizationId: 'org_123',
          customHeaders: {
            'x-project': 'pepetex'
          }
        },
        encryptionKey
      )
    });
    mockPrisma.auditLog.create.mockResolvedValue({
      id: 'audit_1'
    });

    const response = await request(
      '/api/provider-credentials/credential_system_1/reveal',
      providerCredentialRevealHandler,
      {
        method: 'POST'
      },
      '/api/provider-credentials/:credentialId/reveal'
    );

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      ok: true,
      credential: {
        id: 'credential_system_1',
        providerDefinitionId: 'provider_1',
        scope: 'system',
        label: 'Primary System Key',
        apiKey: 'sk-system-secret-9999',
        organizationId: 'org_123',
        customHeaders: {
          'x-project': 'pepetex'
        }
      }
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'admin_1',
        action: 'admin.provider-credential.reveal',
        targetType: 'provider_credential',
        targetId: 'credential_system_1',
        metadata: {
          providerDefinitionId: 'provider_1',
          scope: 'system',
          ownerUserId: null,
          label: 'Primary System Key'
        }
      }
    });
  });

  it('rejects provider credential reveal for non-admin users', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());

    const response = await request(
      '/api/provider-credentials/credential_user_1/reveal',
      providerCredentialRevealHandler,
      {
        method: 'POST'
      },
      '/api/provider-credentials/:credentialId/reveal'
    );

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('Global admin access is required.');
  });

  it('discovers provider models through the Gemini adapter', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_1',
      kind: 'GEMINI',
      enabled: true,
      baseUrl: null,
      updatedAt: new Date('2026-04-25T06:00:00.000Z')
    });
    mockPrisma.providerCredential.findFirst.mockResolvedValue({
      id: 'credential_system_1',
      providerDefinitionId: 'provider_1',
      scope: 'SYSTEM',
      ownerUserId: null,
      updatedAt: new Date('2026-04-25T06:01:00.000Z'),
      encryptedPayload: encryptProviderCredentialPayload(
        {
          apiKey: 'gemini-secret'
        },
        encryptionKey
      )
    });
    mockPrisma.providerModelCache.findFirst.mockResolvedValue(null);
    mockPrisma.providerModelCache.upsert.mockResolvedValue({
      id: 'cache_1'
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        async json() {
          return {
            models: [
              {
                name: 'models/gemini-3.1-flash-lite-preview',
                displayName: 'Gemini 3.1 Flash Lite',
                supportedGenerationMethods: ['generateContent']
              },
              {
                name: 'models/gemini-2.0-pro',
                displayName: 'Gemini 2.0 Pro',
                supportedGenerationMethods: ['generateContent']
              }
            ]
          };
        },
        async text() {
          return '';
        }
      })
    );

    const response = await request(
      '/api/providers/provider_1/models',
      providerModelsGetHandler,
      {
        method: 'GET'
      },
      '/api/providers/:providerId/models'
    );

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      ok: true,
      result: {
        providerId: 'provider_1',
        kind: 'gemini',
        credentialScope: 'system',
        models: [
          {
            id: 'gemini-3.1-flash-lite-preview',
            label: 'Gemini 3.1 Flash Lite',
            supportsFileUpload: true
          },
          {
            id: 'gemini-2.0-pro',
            label: 'Gemini 2.0 Pro',
            supportsFileUpload: true
          }
        ],
        defaultModelId: null
      }
    });
    expect(mockPrisma.providerModelCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          providerDefinitionId: 'provider_1'
        }),
        update: expect.objectContaining({
          modelsJson: [
            {
              id: 'gemini-3.1-flash-lite-preview',
              label: 'Gemini 3.1 Flash Lite',
              supportsFileUpload: true
            },
            {
              id: 'gemini-2.0-pro',
              label: 'Gemini 2.0 Pro',
              supportsFileUpload: true
            }
          ]
        })
      })
    );
  });

  it('serves provider models from cache when a fresh entry exists', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_1',
      kind: 'GEMINI',
      enabled: true,
      baseUrl: null,
      updatedAt: new Date('2026-04-25T06:00:00.000Z')
    });
    mockPrisma.providerCredential.findFirst.mockResolvedValue({
      id: 'credential_system_1',
      providerDefinitionId: 'provider_1',
      scope: 'SYSTEM',
      ownerUserId: null,
      updatedAt: new Date('2026-04-25T06:01:00.000Z'),
      encryptedPayload: encryptProviderCredentialPayload(
        {
          apiKey: 'gemini-secret'
        },
        encryptionKey
      )
    });
    mockPrisma.providerModelCache.findFirst.mockResolvedValue({
      modelsJson: [
        {
          id: 'gemini-3.1-flash-lite-preview',
          label: 'Gemini 3.1 Flash Lite',
          supportsFileUpload: true
        }
      ]
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await request(
      '/api/providers/provider_1/models',
      providerModelsGetHandler,
      {
        method: 'GET'
      },
      '/api/providers/:providerId/models'
    );

    expect(response.status).toBe(200);
    expect(response.json.result.models).toEqual([
      {
        id: 'gemini-3.1-flash-lite-preview',
        label: 'Gemini 3.1 Flash Lite',
        supportsFileUpload: true
      }
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockPrisma.providerModelCache.upsert).not.toHaveBeenCalled();
  });

  it('does not warn about the preferred Gemini default when manual models override discovery', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_1',
      kind: 'GEMINI',
      enabled: true,
      baseUrl: null,
      updatedAt: new Date('2026-04-25T06:00:00.000Z')
    });
    mockPrisma.providerCredential.findFirst.mockResolvedValue({
      id: 'credential_system_1',
      providerDefinitionId: 'provider_1',
      scope: 'SYSTEM',
      ownerUserId: null,
      updatedAt: new Date('2026-04-25T06:01:00.000Z'),
      encryptedPayload: encryptProviderCredentialPayload(
        {
          apiKey: 'gemini-secret',
          manualModels: [{ id: 'gemini-3.1-pro-preview', label: 'Advanced Model' }]
        },
        encryptionKey
      )
    });
    mockPrisma.providerModelCache.findFirst.mockResolvedValue(null);
    mockPrisma.providerModelCache.upsert.mockResolvedValue({ id: 'cache_1' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await request(
      '/api/providers/provider_1/models',
      providerModelsGetHandler,
      {
        method: 'GET'
      },
      '/api/providers/:providerId/models'
    );

    expect(response.status).toBe(200);
    expect(response.json.result.models).toEqual([
      {
        id: 'gemini-3.1-pro-preview',
        label: 'Advanced Model'
      }
    ]);
    expect(response.json.result.defaultModelId).toBe(null);
    expect(response.json.result.configurationError).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('filters provider models to the workspace policy allowlist', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Team Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-25T08:00:00.000Z'),
      updatedAt: new Date('2026-04-25T08:00:00.000Z'),
      members: [{ role: 'EDITOR' }]
    });
    mockPrisma.workspaceProviderPolicy.findMany.mockResolvedValue([
      {
        providerDefinitionId: 'provider_1',
        allowedModelIdsJson: ['gemini-2.0-pro']
      }
    ]);
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_1',
      kind: 'GEMINI',
      enabled: true,
      baseUrl: null,
      updatedAt: new Date('2026-04-25T06:00:00.000Z')
    });
    mockPrisma.providerCredential.findFirst.mockResolvedValue({
      id: 'credential_system_1',
      providerDefinitionId: 'provider_1',
      scope: 'SYSTEM',
      ownerUserId: null,
      updatedAt: new Date('2026-04-25T06:01:00.000Z'),
      encryptedPayload: encryptProviderCredentialPayload(
        {
          apiKey: 'gemini-secret'
        },
        encryptionKey
      )
    });
    mockPrisma.providerModelCache.findFirst.mockResolvedValue(null);
    mockPrisma.providerModelCache.upsert.mockResolvedValue({
      id: 'cache_1'
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        async json() {
          return {
            models: [
              {
                name: 'models/gemini-3.1-flash-lite-preview',
                displayName: 'Gemini 3.1 Flash Lite',
                supportedGenerationMethods: ['generateContent']
              },
              {
                name: 'models/gemini-2.0-pro',
                displayName: 'Gemini 2.0 Pro',
                supportedGenerationMethods: ['generateContent']
              }
            ]
          };
        },
        async text() {
          return '';
        }
      })
    );

    const response = await request(
      '/api/providers/provider_1/models?workspaceId=workspace_shared',
      providerModelsGetHandler,
      {
        method: 'GET'
      },
      '/api/providers/:providerId/models'
    );

    expect(response.status).toBe(200);
    expect(response.json.result.models).toEqual([
      {
        id: 'gemini-2.0-pro',
        label: 'Gemini 2.0 Pro',
        supportsFileUpload: true
      }
    ]);
    expect(response.json.result.defaultModelId).toBe(null);
    expect(response.json.result.configurationError).toBeUndefined();
  });

  it('returns a friendly model-discovery error without raw diagnostics for non-admin users', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_1',
      kind: 'GEMINI',
      enabled: true,
      baseUrl: null,
      updatedAt: new Date('2026-04-25T06:00:00.000Z')
    });
    mockPrisma.providerCredential.findFirst.mockResolvedValue({
      id: 'credential_system_1',
      providerDefinitionId: 'provider_1',
      scope: 'SYSTEM',
      ownerUserId: null,
      updatedAt: new Date('2026-04-25T06:01:00.000Z'),
      encryptedPayload: encryptProviderCredentialPayload(
        {
          apiKey: 'gemini-secret'
        },
        encryptionKey
      )
    });
    mockPrisma.providerModelCache.findFirst.mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        async json() {
          return {};
        },
        async text() {
          return 'invalid api key';
        }
      })
    );

    const response = await request(
      '/api/providers/provider_1/models',
      providerModelsGetHandler,
      {
        method: 'GET'
      },
      '/api/providers/:providerId/models'
    );

    expect(response.status).toBe(502);
    expect(response.json.statusMessage).toBe(
      'PepeteX could not authenticate with this provider during model discovery. Check the configured credentials and retry.'
    );
    expect(response.json.data).toEqual({
      retryable: true
    });
  });

  it('includes raw diagnostics for global admins when model discovery fails', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(adminSession());
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_2',
      kind: 'OPENAI_COMPATIBLE',
      enabled: true,
      baseUrl: 'https://example.com/v1',
      updatedAt: new Date('2026-04-25T06:10:00.000Z')
    });
    mockPrisma.providerCredential.findFirst.mockResolvedValue({
      id: 'credential_system_2',
      providerDefinitionId: 'provider_2',
      scope: 'SYSTEM',
      ownerUserId: null,
      updatedAt: new Date('2026-04-25T06:11:00.000Z'),
      encryptedPayload: encryptProviderCredentialPayload(
        {
          apiKey: 'openai-secret'
        },
        encryptionKey
      )
    });
    mockPrisma.providerModelCache.findFirst.mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        async json() {
          return {};
        },
        async text() {
          return 'rate limit exceeded';
        }
      })
    );

    const response = await request(
      '/api/providers/provider_2/models',
      providerModelsGetHandler,
      {
        method: 'GET'
      },
      '/api/providers/:providerId/models'
    );

    expect(response.status).toBe(503);
    expect(response.json.statusMessage).toBe(
      'This provider is rate limiting PepeteX during model discovery. Retry in a moment.'
    );
    expect(response.json.data).toEqual({
      retryable: true,
      providerDiagnostic:
        'OpenAI-compatible model discovery failed with 429 Too Many Requests: rate limit exceeded'
    });
  });

  it('tests provider connectivity through the OpenAI-compatible adapter', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(adminSession());
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_2',
      kind: 'OPENAI_COMPATIBLE',
      enabled: true,
      baseUrl: 'https://example.com/v1',
      updatedAt: new Date('2026-04-25T06:10:00.000Z')
    });
    mockPrisma.providerCredential.findFirst.mockResolvedValue({
      id: 'credential_system_2',
      providerDefinitionId: 'provider_2',
      scope: 'SYSTEM',
      ownerUserId: null,
      updatedAt: new Date('2026-04-25T06:11:00.000Z'),
      encryptedPayload: encryptProviderCredentialPayload(
        {
          apiKey: 'openai-secret'
        },
        encryptionKey
      )
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        async json() {
          return {
            data: [{ id: 'gpt-4.1-mini' }, { id: 'gpt-4.1' }]
          };
        },
        async text() {
          return '';
        }
      })
    );

    const response = await request(
      '/api/providers/provider_2/test',
      providerTestPostHandler,
      {
        method: 'POST',
        body: {}
      },
      '/api/providers/:providerId/test'
    );

    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(true);
    expect(response.json.result.providerId).toBe('provider_2');
    expect(response.json.result.kind).toBe('openai-compatible');
    expect(response.json.result.credentialScope).toBe('system');
    expect(response.json.result.ok).toBe(true);
    expect(response.json.result.message).toBe('OpenAI-compatible connection is healthy.');
    expect(response.json.result.modelCount).toBe(2);
  });

  it('hides raw connection-test diagnostics from non-admin users', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_2',
      kind: 'OPENAI_COMPATIBLE',
      enabled: true,
      baseUrl: 'https://example.com/v1',
      updatedAt: new Date('2026-04-25T06:10:00.000Z')
    });
    mockPrisma.providerCredential.findFirst.mockResolvedValue({
      id: 'credential_system_2',
      providerDefinitionId: 'provider_2',
      scope: 'SYSTEM',
      ownerUserId: null,
      updatedAt: new Date('2026-04-25T06:11:00.000Z'),
      encryptedPayload: encryptProviderCredentialPayload(
        {
          apiKey: 'openai-secret'
        },
        encryptionKey
      )
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        async json() {
          return {};
        },
        async text() {
          return 'invalid api key';
        }
      })
    );

    const response = await request(
      '/api/providers/provider_2/test',
      providerTestPostHandler,
      {
        method: 'POST',
        body: {}
      },
      '/api/providers/:providerId/test'
    );

    expect(response.status).toBe(200);
    expect(response.json.result.ok).toBe(false);
    expect(response.json.result.message).toBe(
      'PepeteX could not authenticate with this provider during connection testing. Check the configured credentials and retry.'
    );
    expect(response.json.result.retryable).toBe(true);
    expect(response.json.result.diagnostic).toBeUndefined();
  });

  it('returns raw connection-test diagnostics to global admins', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(adminSession());
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_2',
      kind: 'OPENAI_COMPATIBLE',
      enabled: true,
      baseUrl: 'https://example.com/v1',
      updatedAt: new Date('2026-04-25T06:10:00.000Z')
    });
    mockPrisma.providerCredential.findFirst.mockResolvedValue({
      id: 'credential_system_2',
      providerDefinitionId: 'provider_2',
      scope: 'SYSTEM',
      ownerUserId: null,
      updatedAt: new Date('2026-04-25T06:11:00.000Z'),
      encryptedPayload: encryptProviderCredentialPayload(
        {
          apiKey: 'openai-secret'
        },
        encryptionKey
      )
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        async json() {
          return {};
        },
        async text() {
          return 'invalid api key';
        }
      })
    );

    const response = await request(
      '/api/providers/provider_2/test',
      providerTestPostHandler,
      {
        method: 'POST',
        body: {}
      },
      '/api/providers/:providerId/test'
    );

    expect(response.status).toBe(200);
    expect(response.json.result.ok).toBe(false);
    expect(response.json.result.retryable).toBe(true);
    expect(response.json.result.diagnostic).toBe(
      'OpenAI-compatible model discovery failed with 401 Unauthorized: invalid api key'
    );
  });

  it('rejects discovery for disabled providers when accessed by non-admin users', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_disabled',
      kind: 'OPENAI_COMPATIBLE',
      enabled: false,
      baseUrl: 'https://example.com/v1',
      updatedAt: new Date('2026-04-25T06:20:00.000Z')
    });

    const response = await request(
      '/api/providers/provider_disabled/models',
      providerModelsGetHandler,
      {
        method: 'GET'
      },
      '/api/providers/:providerId/models'
    );

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('This provider is currently disabled.');
  });

  it('rejects workspace-scoped provider tests for disallowed providers', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Team Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-25T08:00:00.000Z'),
      updatedAt: new Date('2026-04-25T08:00:00.000Z'),
      members: [{ role: 'EDITOR' }]
    });
    mockPrisma.workspaceProviderPolicy.findMany.mockResolvedValue([
      {
        providerDefinitionId: 'provider_allowed',
        allowedModelIdsJson: null
      }
    ]);
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_2',
      kind: 'OPENAI_COMPATIBLE',
      enabled: true,
      baseUrl: 'https://example.com/v1',
      updatedAt: new Date('2026-04-25T06:10:00.000Z')
    });
    mockPrisma.providerCredential.findFirst.mockResolvedValue({
      id: 'credential_system_2',
      providerDefinitionId: 'provider_2',
      scope: 'SYSTEM',
      ownerUserId: null,
      updatedAt: new Date('2026-04-25T06:11:00.000Z'),
      encryptedPayload: encryptProviderCredentialPayload(
        {
          apiKey: 'openai-secret'
        },
        encryptionKey
      )
    });

    const response = await request(
      '/api/providers/provider_2/test',
      providerTestPostHandler,
      {
        method: 'POST',
        body: {
          workspaceId: 'workspace_shared'
        }
      },
      '/api/providers/:providerId/test'
    );

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('This provider is not allowed in the selected workspace.');
  });

  it('estimates provider cost without requiring a stored credential', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_1',
      kind: 'GEMINI',
      enabled: true,
      baseUrl: null
    });

    const response = await request(
      '/api/providers/provider_1/cost-estimate',
      providerCostEstimatePostHandler,
      {
        method: 'POST',
        body: {
          model: 'gemini-3.1-flash-lite-preview',
          inputTokens: 120_000,
          outputTokens: 8_000
        }
      },
      '/api/providers/:providerId/cost-estimate'
    );

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      ok: true,
      result: {
        providerId: 'provider_1',
        kind: 'gemini',
        supported: true,
        estimatedCostUsd: 0.042,
        currency: 'USD',
        basis: 'Gemini 3.1 Flash-Lite Preview standard pricing.'
      }
    });
    expect(mockPrisma.providerCredential.findFirst).not.toHaveBeenCalled();
  });

  it('rejects workspace-scoped cost estimates for disallowed models', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());
    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace_shared',
      name: 'Team Workspace',
      type: 'SHARED',
      createdAt: new Date('2026-04-25T08:00:00.000Z'),
      updatedAt: new Date('2026-04-25T08:00:00.000Z'),
      members: [{ role: 'EDITOR' }]
    });
    mockPrisma.workspaceProviderPolicy.findMany.mockResolvedValue([
      {
        providerDefinitionId: 'provider_1',
        allowedModelIdsJson: ['gemini-2.0-pro']
      }
    ]);
    mockPrisma.providerDefinition.findUnique.mockResolvedValue({
      id: 'provider_1',
      kind: 'GEMINI',
      enabled: true,
      baseUrl: null
    });

    const response = await request(
      '/api/providers/provider_1/cost-estimate',
      providerCostEstimatePostHandler,
      {
        method: 'POST',
        body: {
          workspaceId: 'workspace_shared',
          model: 'gemini-3.1-flash-lite-preview',
          inputTokens: 120_000,
          outputTokens: 8_000
        }
      },
      '/api/providers/:providerId/cost-estimate'
    );

    expect(response.status).toBe(403);
    expect(response.json.statusMessage).toBe('This model is not allowed in the selected workspace.');
  });

  it('validates token counts for provider cost estimates', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(userSession());

    const response = await request(
      '/api/providers/provider_1/cost-estimate',
      providerCostEstimatePostHandler,
      {
        method: 'POST',
        body: {
          model: 'gpt-5.4-mini',
          inputTokens: -1,
          outputTokens: 5
        }
      },
      '/api/providers/:providerId/cost-estimate'
    );

    expect(response.status).toBe(400);
    expect(response.json.statusMessage).toBe('inputTokens must be a non-negative integer.');
  });
});

function adminSession() {
  return {
    sessionId: 'session_admin',
    user: {
      id: 'admin_1',
      email: 'admin@example.com',
      globalRole: 'GLOBAL_ADMIN',
      profile: null
    }
  };
}

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

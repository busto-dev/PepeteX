import { createServer } from 'node:http';

import { createApp, createRouter, toNodeListener } from 'h3';
import type { EventHandler } from 'h3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  deck: {
    findFirst: vi.fn()
  },
  referenceFile: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    delete: vi.fn(),
    update: vi.fn()
  },
  assetUsage: {
    create: vi.fn()
  }
}));

const mockStorageAdapter = vi.hoisted(() => ({
  putObject: vi.fn(),
  getObject: vi.fn(),
  deleteObject: vi.fn()
}));

const mockUploadProviderReferenceFile = vi.hoisted(() => vi.fn());
const mockDeleteProviderReferenceFile = vi.hoisted(() => vi.fn());

vi.mock('@pepetex/db', async () => {
  const actual = await vi.importActual<typeof import('@pepetex/db')>('@pepetex/db');

  return {
    ...actual,
    prisma: mockPrisma
  };
});

vi.mock('@pepetex/config', () => ({
  loadConfig: vi.fn(() => ({
    nodeEnv: 'test',
    gcsBucket: 'pepetex-dev',
    redisUrl: 'redis://localhost:6379',
    databaseUrl: 'postgresql://test',
    gcsKeyfileJson: undefined,
    firstAdminEmail: undefined,
    firstAdminPasswordHash: undefined,
    providerCredentialEncryptionKey: 'a'.repeat(64),
    maxUploadFileBytes: 31457280,
    referenceFileRetentionDays: 30
  }))
}));

vi.mock('@pepetex/storage', async () => {
  const actual = await vi.importActual<typeof import('@pepetex/storage')>('@pepetex/storage');

  return {
    ...actual,
    createObjectStorageAdapter: vi.fn(() => mockStorageAdapter)
  };
});

const mockGetAuthenticatedSession = vi.hoisted(() => vi.fn());

vi.mock('../utils/auth', () => ({
  getAuthenticatedSession: mockGetAuthenticatedSession
}));

vi.mock('../utils/providers', () => ({
  uploadProviderReferenceFile: mockUploadProviderReferenceFile,
  deleteProviderReferenceFile: mockDeleteProviderReferenceFile
}));

import deckReferenceFilesPostHandler from './decks/[deckId]/reference-files.post';
import deckReferenceFilesGetHandler from './decks/[deckId]/reference-files.get';
import deckReferenceFileDeleteHandler from './decks/[deckId]/reference-files/[referenceFileId].delete';
import deckReferenceFileProviderBridgePostHandler from './decks/[deckId]/reference-files/[referenceFileId]/provider-bridge.post';
import deckReferenceFileUsagePostHandler from './decks/[deckId]/reference-files/[referenceFileId]/usage.post';

describe('/api/decks/:deckId/reference-files', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    delete (
      globalThis as typeof globalThis & {
        __pepetexObjectStorageAdapters?: unknown;
      }
    ).__pepetexObjectStorageAdapters;
  });

  it('uploads a deck-scoped reference file for an authenticated workspace member', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.deck.findFirst.mockResolvedValue({
      id: 'deck_1'
    });
    mockStorageAdapter.putObject.mockResolvedValue({
      bucket: 'pepetex-dev',
      objectPath: 'decks/deck_1/references/2026-04-25/upload.txt',
      contentType: 'text/plain',
      sizeBytes: 5
    });
    mockPrisma.referenceFile.create.mockResolvedValue({
      id: 'reference_1',
      deckId: 'deck_1',
      purpose: 'REFERENCE',
      assetRole: null,
      originalFilename: 'notes.txt',
      mimeType: 'text/plain',
      extension: 'txt',
      sizeBytes: 5,
      pageCount: null,
      imageWidth: null,
      imageHeight: null,
      storageBucket: 'pepetex-dev',
      storageObjectPath: 'decks/deck_1/references/2026-04-25/upload.txt',
      providerFileId: null,
      providerDefinitionId: null,
      expiresAt: new Date('2026-05-25T00:00:00.000Z'),
      createdAt: new Date('2026-04-25T00:00:00.000Z'),
      updatedAt: new Date('2026-04-25T00:00:00.000Z')
    });

    const response = await requestMultipart(
      '/api/decks/deck_1/reference-files',
      deckReferenceFilesPostHandler,
      createFormDataWithFile(
        new File([new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])], 'notes.txt', {
          type: 'text/plain'
        })
      ),
      '/api/decks/:deckId/reference-files'
    );

    expect(response.status).toBe(201);
    expect(mockPrisma.deck.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'deck_1',
        workspace: {
          members: {
            some: {
              userId: 'user_1'
            }
          }
        }
      },
      select: {
        id: true
      }
    });
    expect(mockStorageAdapter.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'text/plain',
        metadata: {
          deckId: 'deck_1',
          uploadedByUserId: 'user_1'
        }
      })
    );
    expect(mockPrisma.referenceFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deckId: 'deck_1',
        uploadedByUserId: 'user_1',
        purpose: 'REFERENCE',
        originalFilename: 'notes.txt',
        mimeType: 'text/plain',
        extension: 'txt',
        sizeBytes: 5,
        pageCount: null
      })
    });
    expect(response.json.referenceFile).toMatchObject({
      id: 'reference_1',
      deckId: 'deck_1',
      purpose: 'REFERENCE',
      assetRole: null,
      originalFilename: 'notes.txt',
      mimeType: 'text/plain',
      extension: 'txt',
      pageCount: null,
      providerFileId: null,
      providerDefinitionId: null
    });
  });

  it('lists deck-scoped reference files for an authenticated workspace member', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.deck.findFirst.mockResolvedValue({
      id: 'deck_1'
    });
    mockPrisma.referenceFile.findMany.mockResolvedValue([
      createAccessibleReferenceFile(),
      createAccessibleReferenceFile({
        id: 'reference_2',
        originalFilename: 'chart.png',
        mimeType: 'image/png',
        extension: 'png',
        sizeBytes: 42_000,
        pageCount: null,
        imageWidth: 1440,
        imageHeight: 900,
        storageObjectPath: 'decks/deck_1/references/2026-04-25/chart.png',
        createdAt: new Date('2026-04-25T00:30:00.000Z'),
        updatedAt: new Date('2026-04-25T00:30:00.000Z')
      })
    ]);

    const response = await requestJson(
      '/api/decks/deck_1/reference-files',
      deckReferenceFilesGetHandler,
      'GET',
      '/api/decks/:deckId/reference-files'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.deck.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'deck_1',
        workspace: {
          members: {
            some: {
              userId: 'user_1'
            }
          }
        }
      },
      select: {
        id: true
      }
    });
    expect(mockPrisma.referenceFile.findMany).toHaveBeenCalledWith({
      where: {
        deckId: 'deck_1',
        purpose: 'REFERENCE'
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        deckId: true,
        purpose: true,
        assetRole: true,
        originalFilename: true,
        mimeType: true,
        extension: true,
        sizeBytes: true,
        pageCount: true,
        imageWidth: true,
        imageHeight: true,
        storageBucket: true,
        storageObjectPath: true,
        providerFileId: true,
        providerDefinitionId: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true
      }
    });
    const referenceFiles = response.json.referenceFiles as Array<Record<string, unknown>>;
    expect(referenceFiles).toHaveLength(2);
    expect(referenceFiles[1]).toMatchObject({
      id: 'reference_2',
      originalFilename: 'chart.png',
      mimeType: 'image/png',
      imageWidth: 1440,
      imageHeight: 900
    });
  });

  it('rejects uploads for missing deck access', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.deck.findFirst.mockResolvedValue(null);

    const response = await requestMultipart(
      '/api/decks/deck_missing/reference-files',
      deckReferenceFilesPostHandler,
      createFormDataWithFile(
        new File([new Uint8Array([0x74, 0x65, 0x78, 0x74])], 'notes.txt', {
          type: 'text/plain'
        })
      ),
      '/api/decks/:deckId/reference-files'
    );

    expect(response.status).toBe(404);
    expect(response.json.statusMessage).toBe('Deck not found.');
    expect(mockStorageAdapter.putObject).not.toHaveBeenCalled();
  });

  it('rejects unsupported file types before writing to storage', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.deck.findFirst.mockResolvedValue({
      id: 'deck_1'
    });

    const response = await requestMultipart(
      '/api/decks/deck_1/reference-files',
      deckReferenceFilesPostHandler,
      createFormDataWithFile(
        new File([new Uint8Array([0x01, 0x02, 0x03])], 'payload.exe', {
          type: 'application/octet-stream'
        })
      ),
      '/api/decks/:deckId/reference-files'
    );

    expect(response.status).toBe(400);
    expect(response.json.statusMessage).toBe(
      'PepeteX supports only PDF, TXT, Markdown, CSV, PNG, JPG, and WebP reference files.'
    );
    expect(mockStorageAdapter.putObject).not.toHaveBeenCalled();
    expect(mockPrisma.referenceFile.create).not.toHaveBeenCalled();
  });

  it('deletes a deck-scoped reference file for an authenticated workspace member', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.referenceFile.findFirst.mockResolvedValue(createAccessibleReferenceFile({
      providerFileId: 'file-bridge-1',
      providerDefinitionId: 'provider_1',
      deck: {
        workspaceId: 'workspace_1'
      }
    }));
    mockPrisma.referenceFile.delete.mockResolvedValue({
      id: 'reference_1'
    });

    const response = await requestJson(
      '/api/decks/deck_1/reference-files/reference_1',
      deckReferenceFileDeleteHandler,
      'DELETE',
      '/api/decks/:deckId/reference-files/:referenceFileId'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.referenceFile.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'reference_1',
        deckId: 'deck_1',
        deck: {
          workspace: {
            members: {
              some: {
                userId: 'user_1'
              }
            }
          }
        }
      },
      select: {
        id: true,
        deckId: true,
        purpose: true,
        assetRole: true,
        originalFilename: true,
        mimeType: true,
        extension: true,
        sizeBytes: true,
        pageCount: true,
        imageWidth: true,
        imageHeight: true,
        storageBucket: true,
        storageObjectPath: true,
        providerFileId: true,
        providerDefinitionId: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        deck: {
          select: {
            workspaceId: true
          }
        }
      }
    });
    expect(mockPrisma.referenceFile.delete).toHaveBeenCalledWith({
      where: {
        id: 'reference_1'
      }
    });
    expect(mockDeleteProviderReferenceFile).toHaveBeenCalledWith(
      'provider_1',
      'user_1',
      false,
      {
        providerFileId: 'file-bridge-1',
        workspaceId: 'workspace_1'
      }
    );
    expect(mockStorageAdapter.deleteObject).toHaveBeenCalledWith({
      objectPath: 'decks/deck_1/references/2026-04-25/upload.txt',
      ignoreIfMissing: true
    });
    expect(response.json).toEqual({ ok: true });
  });

  it('returns not found when deleting an inaccessible reference file', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.referenceFile.findFirst.mockResolvedValue(null);

    const response = await requestJson(
      '/api/decks/deck_1/reference-files/reference_missing',
      deckReferenceFileDeleteHandler,
      'DELETE',
      '/api/decks/:deckId/reference-files/:referenceFileId'
    );

    expect(response.status).toBe(404);
    expect(response.json.statusMessage).toBe('Reference file not found.');
    expect(mockPrisma.referenceFile.delete).not.toHaveBeenCalled();
    expect(mockStorageAdapter.deleteObject).not.toHaveBeenCalled();
  });

  it('returns success even if object storage cleanup fails after the app record is deleted', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.referenceFile.findFirst.mockResolvedValue(createAccessibleReferenceFile({
      deck: {
        workspaceId: 'workspace_1'
      }
    }));
    mockPrisma.referenceFile.delete.mockResolvedValue({
      id: 'reference_1'
    });
    mockStorageAdapter.deleteObject.mockRejectedValueOnce(new Error('gcs delete failed'));

    const response = await requestJson(
      '/api/decks/deck_1/reference-files/reference_1',
      deckReferenceFileDeleteHandler,
      'DELETE',
      '/api/decks/:deckId/reference-files/:referenceFileId'
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.referenceFile.delete).toHaveBeenCalledOnce();
    expect(response.json).toEqual({ ok: true });
  });

  it('bridges a deck reference file to the selected provider and records provider bridge usage', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.referenceFile.findFirst.mockResolvedValue(createAccessibleReferenceFile({
      deck: {
        workspaceId: 'workspace_1'
      }
    }));
    mockStorageAdapter.getObject.mockResolvedValue({
      body: new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]),
      contentType: 'text/plain',
      sizeBytes: 5
    });
    mockUploadProviderReferenceFile.mockResolvedValue({
      providerId: 'provider_1',
      kind: 'gemini',
      credentialScope: 'user',
      providerFileId: 'files/provider-123'
    });
    mockPrisma.referenceFile.update.mockResolvedValue(createAccessibleReferenceFile({
      providerFileId: 'files/provider-123',
      providerDefinitionId: 'provider_1'
    }));
    mockPrisma.assetUsage.create.mockResolvedValue({
      id: 'usage_1',
      referenceFileId: 'reference_1',
      context: 'provider_bridge',
      contextId: 'provider_1',
      createdAt: new Date('2026-04-25T00:10:00.000Z')
    });

    const response = await requestJson(
      '/api/decks/deck_1/reference-files/reference_1/provider-bridge',
      deckReferenceFileProviderBridgePostHandler,
      'POST',
      '/api/decks/:deckId/reference-files/:referenceFileId/provider-bridge',
      {
        providerId: 'provider_1',
        credentialId: 'credential_1'
      }
    );

    expect(response.status).toBe(200);
    expect(mockStorageAdapter.getObject).toHaveBeenCalledWith({
      objectPath: 'decks/deck_1/references/2026-04-25/upload.txt'
    });
    expect(mockUploadProviderReferenceFile).toHaveBeenCalledWith(
      'provider_1',
      'user_1',
      false,
      {
        filename: 'notes.txt',
        mimeType: 'text/plain',
        content: new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]),
        workspaceId: 'workspace_1',
        credentialId: 'credential_1'
      }
    );
    expect(mockPrisma.referenceFile.update).toHaveBeenCalledWith({
      where: {
        id: 'reference_1'
      },
      data: {
        providerDefinitionId: 'provider_1',
        providerFileId: 'files/provider-123'
      }
    });
    expect(mockPrisma.assetUsage.create).toHaveBeenCalledWith({
      data: {
        referenceFileId: 'reference_1',
        context: 'provider_bridge',
        contextId: 'provider_1'
      }
    });
    expect(response.json.referenceFile).toMatchObject({
      id: 'reference_1',
      providerFileId: 'files/provider-123',
      providerDefinitionId: 'provider_1'
    });
    expect(response.json.providerFile).toMatchObject({
      providerId: 'provider_1',
      providerFileId: 'files/provider-123'
    });
    expect(response.json.usage).toMatchObject({
      id: 'usage_1',
      context: 'provider_bridge',
      contextId: 'provider_1'
    });
  });

  it('records generation usage for a deck reference file', async () => {
    mockGetAuthenticatedSession.mockResolvedValue(createSession());
    mockPrisma.referenceFile.findFirst.mockResolvedValue(createAccessibleReferenceFile());
    mockPrisma.assetUsage.create.mockResolvedValue({
      id: 'usage_generation_1',
      referenceFileId: 'reference_1',
      context: 'generation',
      contextId: 'generation_123',
      createdAt: new Date('2026-04-25T00:15:00.000Z')
    });

    const response = await requestJson(
      '/api/decks/deck_1/reference-files/reference_1/usage',
      deckReferenceFileUsagePostHandler,
      'POST',
      '/api/decks/:deckId/reference-files/:referenceFileId/usage',
      {
        generationId: 'generation_123'
      }
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.assetUsage.create).toHaveBeenCalledWith({
      data: {
        referenceFileId: 'reference_1',
        context: 'generation',
        contextId: 'generation_123'
      }
    });
    expect(response.json.usage).toMatchObject({
      id: 'usage_generation_1',
      context: 'generation',
      contextId: 'generation_123'
    });
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

function createAccessibleReferenceFile(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'reference_1',
    deckId: 'deck_1',
    purpose: 'REFERENCE',
    assetRole: null,
    originalFilename: 'notes.txt',
    mimeType: 'text/plain',
    extension: 'txt',
    sizeBytes: 5,
    pageCount: null,
    imageWidth: null,
    imageHeight: null,
    storageBucket: 'pepetex-dev',
    storageObjectPath: 'decks/deck_1/references/2026-04-25/upload.txt',
    providerFileId: null,
    providerDefinitionId: null,
    expiresAt: new Date('2026-05-25T00:00:00.000Z'),
    createdAt: new Date('2026-04-25T00:00:00.000Z'),
    updatedAt: new Date('2026-04-25T00:00:00.000Z'),
    ...overrides
  };
}

function createFormDataWithFile(file: File): FormData {
  const formData = new FormData();
  formData.set('file', file);
  return formData;
}

async function requestMultipart(
  path: string,
  handler: EventHandler,
  formData: FormData,
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

    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      body: formData
    });

    return {
      status: response.status,
      json: (await response.json()) as Record<string, unknown>
    };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

async function requestJson(
  path: string,
  handler: EventHandler,
  method: string,
  routePath = path,
  body?: unknown
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

    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      ...(body !== undefined
        ? {
            headers: {
              'content-type': 'application/json'
            },
            body: JSON.stringify(body)
          }
        : {})
    });

    return {
      status: response.status,
      json: (await response.json()) as Record<string, unknown>
    };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

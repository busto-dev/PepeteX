import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @pepetex/db
vi.mock('@pepetex/db', () => ({
  prisma: {
    deck: { findFirst: vi.fn() },
    exportedFile: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn()
    },
    exportJobToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
    }
  }
}));

vi.mock('@pepetex/config', () => ({
  loadConfig: vi.fn(() => ({
    nodeEnv: 'test',
    gcsBucket: 'pepetex-test',
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

vi.mock('@pepetex/rbac', () => ({
  canEditDeck: vi.fn(() => true)
}));

vi.mock('@pepetex/storage', () => ({
  createObjectStorageAdapter: vi.fn(() => ({
    createSignedReadUrl: vi.fn().mockResolvedValue('https://signed-url.example.com/file.pptx'),
    getObject: vi.fn().mockResolvedValue({
      body: new Uint8Array([80, 75, 3, 4]),
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      sizeBytes: 4
    })
  }))
}));

import { prisma } from '@pepetex/db';

describe('createExportJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a queued export record before the worker runs', async () => {
    (prisma.deck.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'deck_1',
      workspaceId: 'ws_1',
      title: 'Test Deck',
      revisions: [{ id: 'rev_1', revisionNumber: 1 }]
    });
    (prisma.exportJobToken.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.exportedFile.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'export_1' });

    const { createExportJob } = await import('../utils/exports');
    const result = await createExportJob({
      deckId: 'deck_1',
      userId: 'user_1',
      workspaceRole: 'EDITOR',
      internalBaseUrl: 'http://localhost:3000',
      jobId: 'job_1',
      format: 'pptx'
    });

    expect(result.exportedFileId).toBe('export_1');
    expect(prisma.exportedFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deckId: 'deck_1',
        revisionId: 'rev_1',
        exportedByUserId: 'user_1',
        jobId: 'job_1',
        sizeBytes: 0,
        status: 'QUEUED'
      })
    });
  });
});

describe('listDeckExports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty list when deck has no exports', async () => {
    (prisma.deck.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'deck_1',
      workspaceId: 'ws_1',
      title: 'Test Deck'
    });
    (prisma.exportedFile.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { listDeckExports } = await import('../utils/exports');
    const result = await listDeckExports({ deckId: 'deck_1', userId: 'user_1' });
    expect(result).toEqual([]);
  });

  it('throws 404 when deck not found or inaccessible', async () => {
    (prisma.deck.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { listDeckExports } = await import('../utils/exports');
    await expect(listDeckExports({ deckId: 'deck_missing', userId: 'user_1' })).rejects.toMatchObject({
      statusCode: 404
    });
  });
});

describe('getExportJobStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps persisted export statuses to client job statuses', async () => {
    (prisma.exportedFile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'export_1',
      jobId: 'job_1',
      fileName: 'presentation.pptx',
      sizeBytes: 0,
      status: 'QUEUED',
      fallbackReason: null,
      exportedByUserId: 'user_1',
      deck: {
        workspace: {
          members: [{ userId: 'user_1', role: 'EDITOR' }]
        }
      }
    });

    const { getExportJobStatus } = await import('../utils/exports');
    const result = await getExportJobStatus({ jobId: 'job_1', userId: 'user_1' });

    expect(result).toMatchObject({
      jobId: 'job_1',
      exportedFileId: 'export_1',
      status: 'PENDING',
      rawStatus: 'QUEUED',
      downloadUrl: null
    });
  });
});

describe('getExportDownloadUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a signed download URL for a valid export', async () => {
    (prisma.exportedFile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'exp_1',
      deckId: 'deck_1',
      revisionId: 'rev_1',
      gcsBucket: 'pepetex-test',
      gcsPath: 'exports/deck_1/file.pptx',
      fileName: 'presentation.pptx',
      status: 'COMPLETED',
      exportedByUserId: 'user_1',
      deck: {
        workspace: {
          members: [{ userId: 'user_1', role: 'EDITOR' }]
        }
      }
    });

    const { getExportDownloadUrl } = await import('../utils/exports');
    const result = await getExportDownloadUrl({ exportedFileId: 'exp_1', userId: 'user_1' });
    expect(result.downloadUrl).toContain('signed-url.example.com');
    expect(result.fileName).toBe('presentation.pptx');
  });

  it('throws 403 when user is not a workspace member', async () => {
    (prisma.exportedFile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'exp_1',
      deckId: 'deck_1',
      revisionId: 'rev_1',
      gcsBucket: 'pepetex-test',
      gcsPath: 'exports/deck_1/file.pptx',
      fileName: 'presentation.pptx',
      status: 'COMPLETED',
      exportedByUserId: 'other_user',
      deck: {
        workspace: {
          members: []
        }
      }
    });

    const { getExportDownloadUrl } = await import('../utils/exports');
    await expect(
      getExportDownloadUrl({ exportedFileId: 'exp_1', userId: 'user_1' })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns export bytes for proxied downloads without requiring GCS signing', async () => {
    (prisma.exportedFile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'exp_1',
      deckId: 'deck_1',
      revisionId: 'rev_1',
      gcsBucket: 'pepetex-test',
      gcsPath: 'exports/deck_1/file.pptx',
      fileName: 'presentation.pptx',
      status: 'COMPLETED',
      exportedByUserId: 'user_1',
      deck: {
        workspace: {
          members: [{ userId: 'user_1', role: 'EDITOR' }]
        }
      }
    });

    const { getExportDownloadFile } = await import('../utils/exports');
    const result = await getExportDownloadFile({ exportedFileId: 'exp_1', userId: 'user_1' });
    expect(result.fileName).toBe('presentation.pptx');
    expect(result.contentType).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect([...result.body]).toEqual([80, 75, 3, 4]);
  });
});

describe('runExportDryRun', () => {
  it('validates a null deck and returns slideCount 0', async () => {
    const { runExportDryRun } = await import('@pepetex/export');
    const result = runExportDryRun(null);
    expect(result.slideCount).toBe(0);
  });
});

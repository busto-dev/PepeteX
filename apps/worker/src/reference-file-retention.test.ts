import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ObjectStorageAdapter } from '@pepetex/storage';
import type { ExpireReferenceFilesJobPayload } from '@pepetex/queue';

import {
  expireReferenceFiles,
  runExpireReferenceFilesJob
} from './reference-file-retention';

const findMany = vi.fn();
const deleteReferenceFile = vi.fn();
const deleteObject = vi.fn();
const warn = vi.fn();

describe('expireReferenceFiles', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('deletes expired reference files from storage and then the database', async () => {
    findMany.mockResolvedValue([
      {
        id: 'reference_1',
        storageBucket: 'pepetex-dev',
        storageObjectPath: 'decks/deck_1/references/expired-1.pdf'
      },
      {
        id: 'reference_2',
        storageBucket: 'pepetex-dev',
        storageObjectPath: 'decks/deck_1/references/expired-2.png'
      }
    ]);
    deleteReferenceFile.mockResolvedValue({});
    deleteObject.mockResolvedValue(undefined);

    const result = await expireReferenceFiles({
      now: new Date('2026-04-25T08:00:00.000Z'),
      limit: 25,
      prismaClient: createPrismaClientMock(),
      getObjectStorageAdapter: createObjectStorageAdapterFactory(),
      logger: {
        warn
      }
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          lte: new Date('2026-04-25T08:00:00.000Z')
        }
      },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: 25,
      select: {
        id: true,
        storageBucket: true,
        storageObjectPath: true
      }
    });
    expect(deleteObject).toHaveBeenNthCalledWith(1, {
      objectPath: 'decks/deck_1/references/expired-1.pdf',
      ignoreIfMissing: true
    });
    expect(deleteReferenceFile).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'reference_1'
      }
    });
    expect(deleteObject).toHaveBeenNthCalledWith(2, {
      objectPath: 'decks/deck_1/references/expired-2.png',
      ignoreIfMissing: true
    });
    expect(deleteReferenceFile).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'reference_2'
      }
    });
    expect(result).toEqual({
      scannedCount: 2,
      deletedCount: 2,
      failedCount: 0,
      sweepTime: '2026-04-25T08:00:00.000Z'
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the database record when storage deletion fails so the job can retry later', async () => {
    findMany.mockResolvedValue([
      {
        id: 'reference_1',
        storageBucket: 'pepetex-dev',
        storageObjectPath: 'decks/deck_1/references/expired-1.pdf'
      }
    ]);
    deleteObject.mockRejectedValueOnce(new Error('gcs unavailable'));

    const result = await expireReferenceFiles({
      now: new Date('2026-04-25T08:00:00.000Z'),
      prismaClient: createPrismaClientMock(),
      getObjectStorageAdapter: createObjectStorageAdapterFactory(),
      logger: {
        warn
      }
    });

    expect(deleteReferenceFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      scannedCount: 1,
      deletedCount: 0,
      failedCount: 1,
      sweepTime: '2026-04-25T08:00:00.000Z'
    });
    expect(warn).toHaveBeenCalledWith('Failed to expire reference file.', {
      referenceFileId: 'reference_1',
      storageBucket: 'pepetex-dev',
      storageObjectPath: 'decks/deck_1/references/expired-1.pdf',
      error: 'gcs unavailable'
    });
  });

  it('uses the cleanup job payload requestedAt and limit when running from BullMQ', async () => {
    findMany.mockResolvedValue([]);

    const payload: ExpireReferenceFilesJobPayload = {
      jobId: 'job_1',
      workspaceId: 'system',
      actorUserId: 'system',
      idempotencyKey: 'cleanup-reference-files-2026-04-25T09:15:00.000Z',
      requestedAt: '2026-04-25T09:15:00.000Z',
      limit: 5
    };

    const result = await runExpireReferenceFilesJob(payload, {
      prismaClient: createPrismaClientMock(),
      getObjectStorageAdapter: createObjectStorageAdapterFactory(),
      logger: {
        warn
      }
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          lte: new Date('2026-04-25T09:15:00.000Z')
        }
      },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: 5,
      select: {
        id: true,
        storageBucket: true,
        storageObjectPath: true
      }
    });
    expect(result).toEqual({
      scannedCount: 0,
      deletedCount: 0,
      failedCount: 0,
      sweepTime: '2026-04-25T09:15:00.000Z'
    });
  });
});

function createPrismaClientMock() {
  return {
    referenceFile: {
      findMany,
      delete: deleteReferenceFile
    }
  };
}

function createObjectStorageAdapterFactory() {
  const adapter: ObjectStorageAdapter = {
    kind: 'gcs',
    bucket: 'pepetex-dev',
    putObject: vi.fn(),
    getObject: vi.fn(),
    deleteObject,
    createSignedReadUrl: vi.fn()
  };

  return vi.fn(() => adapter);
}

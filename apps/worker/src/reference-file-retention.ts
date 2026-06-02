import { prisma } from '@pepetex/db';
import {
  type ObjectStorageAdapter
} from '@pepetex/storage';
import type { ExpireReferenceFilesJobPayload } from '@pepetex/queue';

import { getCachedObjectStorageAdapter } from './object-storage';

const DEFAULT_EXPIRE_REFERENCE_FILES_LIMIT = 100;

export interface ExpireReferenceFilesResult {
  scannedCount: number;
  deletedCount: number;
  failedCount: number;
  sweepTime: string;
}

interface ExpiredReferenceFileRecord {
  id: string;
  storageBucket: string;
  storageObjectPath: string;
}

interface ReferenceFilePrismaLike {
  referenceFile: {
    findMany(args: {
      where: {
        expiresAt: {
          lte: Date;
        };
      };
      orderBy: Array<{
        expiresAt: 'asc';
      } | {
        id: 'asc';
      }>;
      take: number;
      select: {
        id: true;
        storageBucket: true;
        storageObjectPath: true;
      };
    }): Promise<ExpiredReferenceFileRecord[]>;
    delete(args: {
      where: {
        id: string;
      };
    }): Promise<unknown>;
  };
}

export interface ExpireReferenceFilesOptions {
  now?: Date;
  limit?: number;
  prismaClient?: ReferenceFilePrismaLike;
  getObjectStorageAdapter?: (bucket: string) => ObjectStorageAdapter;
  logger?: Pick<Console, 'warn'>;
}

export async function expireReferenceFiles(
  options: ExpireReferenceFilesOptions = {}
): Promise<ExpireReferenceFilesResult> {
  const now = options.now ?? new Date();
  const limit = normalizeLimit(options.limit);
  const prismaClient = options.prismaClient ?? prisma;
  const logger = options.logger ?? console;
  const getObjectStorageAdapter =
    options.getObjectStorageAdapter ?? getCachedObjectStorageAdapter;
  const expiredReferenceFiles = await prismaClient.referenceFile.findMany({
    where: {
      expiresAt: {
        lte: now
      }
    },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: {
      id: true,
      storageBucket: true,
      storageObjectPath: true
    }
  });

  let deletedCount = 0;
  let failedCount = 0;

  for (const referenceFile of expiredReferenceFiles) {
    try {
      await getObjectStorageAdapter(referenceFile.storageBucket).deleteObject({
        objectPath: referenceFile.storageObjectPath,
        ignoreIfMissing: true
      });
      await prismaClient.referenceFile.delete({
        where: {
          id: referenceFile.id
        }
      });
      deletedCount += 1;
    } catch (error) {
      failedCount += 1;
      logger.warn('Failed to expire reference file.', {
        referenceFileId: referenceFile.id,
        storageBucket: referenceFile.storageBucket,
        storageObjectPath: referenceFile.storageObjectPath,
        error: getErrorMessage(error)
      });
    }
  }

  return {
    scannedCount: expiredReferenceFiles.length,
    deletedCount,
    failedCount,
    sweepTime: now.toISOString()
  };
}

export async function runExpireReferenceFilesJob(
  payload: ExpireReferenceFilesJobPayload,
  options: Omit<ExpireReferenceFilesOptions, 'now' | 'limit'> = {}
): Promise<ExpireReferenceFilesResult> {
  return expireReferenceFiles({
    ...options,
    now: resolveRequestedAt(payload.requestedAt),
    ...(payload.limit !== undefined ? { limit: payload.limit } : {})
  });
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_EXPIRE_REFERENCE_FILES_LIMIT;
  }

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Reference-file cleanup limit must be a positive integer.');
  }

  return value;
}

function resolveRequestedAt(value: string): Date {
  const requestedAt = new Date(value);

  if (Number.isNaN(requestedAt.getTime())) {
    throw new Error('Reference-file cleanup job requestedAt must be a valid ISO timestamp.');
  }

  return requestedAt;
}
function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'Unknown cleanup failure.';
}

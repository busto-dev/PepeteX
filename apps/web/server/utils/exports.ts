import { randomBytes, randomUUID } from 'node:crypto';

import { createError } from 'h3';

import { prisma } from '@pepetex/db';
import { canEditDeck } from '@pepetex/rbac';

import { loadConfig } from '@pepetex/config';

import { getCachedObjectStorageAdapter } from './object-storage';

const EXPORT_TOKEN_TTL_MINUTES = 10;
const PEPETEX_VERSION = '1.0.0';

export type ExportFormatValue = 'pptx' | 'pdf';

const EXPORT_FORMAT_DETAILS: Record<ExportFormatValue, {
  extension: 'pptx' | 'pdf';
  contentType: string;
  dbFormat: 'PPTX' | 'PDF';
}> = {
  pptx: {
    extension: 'pptx',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    dbFormat: 'PPTX'
  },
  pdf: {
    extension: 'pdf',
    contentType: 'application/pdf',
    dbFormat: 'PDF'
  }
};

export function getExportFormatDetails(format: ExportFormatValue) {
  return EXPORT_FORMAT_DETAILS[format];
}

export async function createExportJob(input: {
  deckId: string;
  userId: string;
  workspaceRole: string;
  internalBaseUrl: string;
  jobId: string;
  format: ExportFormatValue;
}): Promise<{
  exportedFileId: string;
  exportJobTokenId: string;
  exportToken: string;
  revisionId: string;
  gcsBucket: string;
  gcsPath: string;
  fileName: string;
  pepetexVersion: string;
  format: ExportFormatValue;
}> {
  if (!canEditDeck(input.workspaceRole as Parameters<typeof canEditDeck>[0])) {
    throw createError({ statusCode: 403, message: 'Permission denied' });
  }

  const deck = await prisma.deck.findFirst({
    where: { id: input.deckId },
    include: {
      revisions: {
        orderBy: { revisionNumber: 'desc' },
        take: 1
      }
    }
  });

  if (!deck) {
    throw createError({ statusCode: 404, message: 'Deck not found' });
  }

  const latestRevision = deck.revisions[0];
  if (!latestRevision) {
    throw createError({ statusCode: 400, message: 'Deck has no revisions to export' });
  }

  const config = loadConfig(process.env);
  const gcsBucket = config.gcsBucket;
  const exportToken: string = randomBytes(32).toString('hex');
  const tokenId = randomUUID();
  const expiresAt = new Date(Date.now() + EXPORT_TOKEN_TTL_MINUTES * 60 * 1000);

  const safeTitle = deck.title.replace(/[^a-z0-9\-_ ]/gi, '').trim() || 'presentation';
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const formatDetails = EXPORT_FORMAT_DETAILS[input.format];
  const fileName = `${safeTitle}-${timestamp}.${formatDetails.extension}`;
  const gcsPath = `exports/${deck.workspaceId}/${deck.id}/${tokenId}/${fileName}`;

  await prisma.exportJobToken.create({
    data: {
      id: tokenId,
      token: exportToken,
      deckId: input.deckId,
      revisionId: latestRevision.id,
      actorUserId: input.userId,
      expiresAt
    }
  });

  const exportedFile = await prisma.exportedFile.create({
    data: {
      deckId: input.deckId,
      revisionId: latestRevision.id,
      gcsBucket,
      gcsPath,
      fileName,
      sizeBytes: 0,
      format: formatDetails.dbFormat,
      exportedByUserId: input.userId,
      jobId: input.jobId,
      pepetexVersion: PEPETEX_VERSION,
      status: 'QUEUED'
    }
  });

  return {
    exportedFileId: exportedFile.id,
    exportJobTokenId: tokenId,
    exportToken,
    revisionId: latestRevision.id,
    gcsBucket,
    gcsPath,
    fileName,
    pepetexVersion: PEPETEX_VERSION,
    format: input.format
  };
}

export async function listDeckExports(input: { deckId: string; userId: string }) {
  const deck = await prisma.deck.findFirst({
    where: {
      id: input.deckId,
      workspace: { members: { some: { userId: input.userId } } }
    }
  });
  if (!deck) {
    throw createError({ statusCode: 404, message: 'Deck not found' });
  }

  const exports = await prisma.exportedFile.findMany({
    where: { deckId: input.deckId },
    orderBy: { exportedAt: 'desc' },
    take: 50
  });

  return exports.map((e) => ({
    id: e.id,
    deckId: e.deckId,
    revisionId: e.revisionId,
    fileName: e.fileName,
    sizeBytes: e.sizeBytes,
    status: e.status,
    format: e.format,
    isFallback: e.isFallback,
    fallbackReason: e.fallbackReason,
    pepetexVersion: e.pepetexVersion,
    createdAt: e.exportedAt.toISOString(),
    exportedAt: e.exportedAt.toISOString(),
    fileSize: e.sizeBytes,
    exportedByUserId: e.exportedByUserId
  }));
}

export async function getExportJobStatus(input: { jobId: string; userId: string }) {
  const exportRecord = await prisma.exportedFile.findFirst({
    where: { jobId: input.jobId },
    include: {
      deck: {
        include: {
          workspace: {
            include: {
              members: { where: { userId: input.userId } }
            }
          }
        }
      }
    }
  });

  if (!exportRecord) {
    throw createError({ statusCode: 404, statusMessage: 'Export job not found' });
  }

  const isMember = exportRecord.deck.workspace.members.length > 0;
  const isOwner = exportRecord.exportedByUserId === input.userId;
  if (!isMember && !isOwner) {
    throw createError({ statusCode: 403, statusMessage: 'Permission denied' });
  }

  return {
    jobId: input.jobId,
    exportedFileId: exportRecord.id,
    status: toClientExportStatus(exportRecord.status),
    rawStatus: exportRecord.status,
    fileName: exportRecord.fileName,
    fileSize: exportRecord.sizeBytes,
    errorMessage: exportRecord.fallbackReason ?? null,
    downloadUrl: exportRecord.status === 'COMPLETED'
      ? `/api/exports/${exportRecord.id}/download`
      : null
  };
}

export async function markExportJobFailed(jobId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.exportedFile.updateMany({
    where: {
      jobId,
      status: { in: ['QUEUED', 'RUNNING'] }
    },
    data: {
      status: 'FAILED',
      fallbackReason: message
    }
  });
}

function toClientExportStatus(status: string): 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' {
  if (status === 'QUEUED') return 'PENDING';
  if (status === 'RUNNING') return 'PROCESSING';
  if (status === 'COMPLETED') return 'COMPLETED';
  return 'FAILED';
}

export async function getExportDownloadUrl(input: {
  exportedFileId: string;
  userId: string;
}): Promise<{ downloadUrl: string; fileName: string }> {
  const exportRecord = await getAuthorizedExportRecordForDownload(input);

  const storage = getCachedObjectStorageAdapter(exportRecord.gcsBucket);

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min
  const downloadUrl = await storage.createSignedReadUrl({
    objectPath: exportRecord.gcsPath,
    expiresAt
  });

  return { downloadUrl, fileName: exportRecord.fileName };
}

export async function getExportDownloadFile(input: {
  exportedFileId: string;
  userId: string;
}): Promise<{
  body: Uint8Array;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}> {
  const exportRecord = await getAuthorizedExportRecordForDownload(input);
  const storage = getCachedObjectStorageAdapter(exportRecord.gcsBucket);
  const object = await storage.getObject({ objectPath: exportRecord.gcsPath });

  // Prefer the format persisted on ExportedFile over the object's stored
  // contentType — the record is the canonical source of truth, and an
  // unexpected storage-side contentType would otherwise mislead the browser.
  const fallbackContentType =
    exportRecord.format === 'PDF'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  return {
    body: object.body,
    fileName: exportRecord.fileName,
    contentType: object.contentType ?? fallbackContentType,
    sizeBytes: object.sizeBytes
  };
}

async function getAuthorizedExportRecordForDownload(input: {
  exportedFileId: string;
  userId: string;
}) {
  const exportRecord = await prisma.exportedFile.findUnique({
    where: { id: input.exportedFileId },
    include: { deck: { include: { workspace: { include: { members: { where: { userId: input.userId } } } } } } }
  });

  if (!exportRecord) {
    throw createError({ statusCode: 404, message: 'Export not found' });
  }

  const isMember = exportRecord.deck.workspace.members.length > 0;
  const isOwner = exportRecord.exportedByUserId === input.userId;
  if (!isMember && !isOwner) {
    throw createError({ statusCode: 403, message: 'Permission denied' });
  }

  if (exportRecord.status !== 'COMPLETED') {
    throw createError({ statusCode: 409, message: 'Export is not ready for download' });
  }

  return exportRecord;
}

export async function runExportDryRunForDeck(input: {
  deckId: string;
  userId: string;
}): Promise<{
  ok: boolean;
  slideCount: number;
  errors: Array<{ slideId: string; code: string; message: string }>;
  warnings: Array<{ slideId: string; code: string; message: string }>;
}> {
  const deck = await prisma.deck.findFirst({
    where: {
      id: input.deckId,
      workspace: { members: { some: { userId: input.userId } } }
    }
  });
  if (!deck) {
    throw createError({ statusCode: 404, message: 'Deck not found' });
  }

  const { runExportDryRun } = await import('@pepetex/export');
  return runExportDryRun(deck.contentJson);
}

// Exposed for worker usage to create an ExportedFile record
export async function createExportedFileRecord(input: {
  deckId: string;
  revisionId: string;
  gcsBucket: string;
  gcsPath: string;
  fileName: string;
  sizeBytes: number;
  exportedByUserId: string;
  jobId?: string;
  isFallback?: boolean;
  fallbackReason?: string;
  pepetexVersion?: string;
}): Promise<string> {
  const record = await prisma.exportedFile.create({
    data: {
      deckId: input.deckId,
      revisionId: input.revisionId,
      gcsBucket: input.gcsBucket,
      gcsPath: input.gcsPath,
      fileName: input.fileName,
      sizeBytes: input.sizeBytes,
      exportedByUserId: input.exportedByUserId,
      jobId: input.jobId,
      isFallback: input.isFallback ?? false,
      fallbackReason: input.fallbackReason,
      pepetexVersion: input.pepetexVersion,
      status: 'COMPLETED'
    }
  });
  return record.id;
}

export async function markExportTokenUsed(tokenId: string): Promise<void> {
  await prisma.exportJobToken.update({
    where: { id: tokenId },
    data: { usedAt: new Date() }
  });
}

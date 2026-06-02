import { createError, defineEventHandler, getRequestHeader, getRouterParam } from 'h3';

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { loadConfig } from '@pepetex/config';
import { exportPptxQueueName, type ExportPptxJobPayload } from '@pepetex/queue';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../utils/authorization';
import { getWorkspaceForUser } from '../../../../utils/workspaces';
import { getDeckDetail } from '../../../../utils/decks';
import { createExportJob, markExportJobFailed } from '../../../../utils/exports';
import { randomUUID } from 'node:crypto';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const deckId = getRouterParam(event, 'deckId');
  if (!deckId) throw createError({ statusCode: 400, message: 'Missing deckId' });

  const deckDetail = await getDeckDetail(deckId, session.user.id);
  const workspace = await getWorkspaceForUser(deckDetail.workspaceId, session.user.id);
  if (!workspace) throw createError({ statusCode: 403, message: 'Access denied' });

  const config = loadConfig(process.env);
  const host = getRequestHeader(event, 'host') ?? 'localhost:3000';
  const protocol = host.startsWith('localhost') ? 'http' : 'https';
  const internalBaseUrl = process.env.INTERNAL_EXPORT_BASE_URL?.trim() || `${protocol}://${host}`;

  const jobId = randomUUID();

  const exportData = await createExportJob({
    deckId,
    userId: session.user.id,
    workspaceRole: workspace.currentUserRole,
    internalBaseUrl,
    jobId,
    format: 'pptx'
  });

  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue<ExportPptxJobPayload>(exportPptxQueueName, { connection: redis });

  const payload: ExportPptxJobPayload = {
    jobId,
    workspaceId: deckDetail.workspaceId,
    actorUserId: session.user.id,
    deckId,
    revisionId: exportData.revisionId,
    idempotencyKey: exportData.exportJobTokenId,
    requestedAt: new Date().toISOString(),
    exportJobTokenId: exportData.exportJobTokenId,
    exportToken: exportData.exportToken,
    deckTitle: deckDetail.title,
    internalExportBaseUrl: internalBaseUrl,
    gcsBucket: exportData.gcsBucket,
    gcsPath: exportData.gcsPath,
    fileName: exportData.fileName,
    pepetexVersion: exportData.pepetexVersion
  };

  try {
    await queue.add('export-pptx', payload, {
      jobId,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 }
    });
  } catch (error) {
    await markExportJobFailed(jobId, error);
    throw error;
  } finally {
    await redis.quit();
  }

  return {
    jobId,
    exportedFileId: exportData.exportedFileId,
    exportJobTokenId: exportData.exportJobTokenId,
    fileName: exportData.fileName,
    status: 'queued'
  };
});

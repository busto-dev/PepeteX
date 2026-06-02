import { randomUUID } from 'node:crypto';

import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';

import { loadConfig } from '@pepetex/config';
import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { createDeck } from '../../../utils/decks';
import { getExample, resolveWorkspaceProviderForKind } from '../../../utils/examples';
import { getCachedObjectStorageAdapter } from '../../../utils/object-storage';
import { getWorkspaceForUser } from '../../../utils/workspaces';

interface InstantiateBody {
  workspaceId?: unknown;
  title?: unknown;
}

export interface InstantiateExampleResult {
  deckId: string;
  initialGenerationSettings: {
    manualInstruction: string;
    textProviderId: string | null;
    textModelId: string | null;
    customPromptId: string | null;
    designSystemId: string | null;
    languageCode: string;
    enableImageGeneration: boolean;
    imageProviderId: string | null;
    imageModelId: string | null;
  };
}

export default defineEventHandler(async (event): Promise<InstantiateExampleResult> => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const exampleId = getRouterParam(event, 'exampleId')?.trim() ?? '';
  if (!exampleId) {
    throw createError({ statusCode: 400, statusMessage: 'Example id is required.' });
  }

  const body = ((await readBody(event)) ?? {}) as InstantiateBody;
  const workspaceId =
    typeof body.workspaceId === 'string' && body.workspaceId.trim()
      ? body.workspaceId.trim()
      : null;
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspaceId is required.' });
  }

  await getWorkspaceForUser(workspaceId, session.user.id);

  const example = await getExample(exampleId);
  if (!example.promptEn.trim()) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Template prompt is empty. Edit the template and fill Prompt (English) before using it.'
    });
  }

  const requestedTitle =
    typeof body.title === 'string' && body.title.trim()
      ? body.title.trim()
      : example.title;

  const [textProviderId, imageProviderId] = await Promise.all([
    resolveWorkspaceProviderForKind(workspaceId, example.textProviderKind, {
      preferredModelId: example.textModelId,
      actorUserId: session.user.id,
      isGlobalAdmin: session.user.globalRole === 'GLOBAL_ADMIN',
      requirePreferredModel: !!example.textModelId
    }),
    example.imageEnabled
      ? resolveWorkspaceProviderForKind(workspaceId, example.imageProviderKind, {
          preferredModelId: example.imageModelId,
          actorUserId: session.user.id,
          isGlobalAdmin: session.user.globalRole === 'GLOBAL_ADMIN',
          requirePreferredModel: !!example.imageModelId
        })
      : Promise.resolve(null)
  ]);

  if (example.textModelId && !textProviderId) {
    throw createError({
      statusCode: 422,
      statusMessage: `Template text model "${example.textModelId}" is not available in this workspace. Check the template model and workspace provider policy.`
    });
  }

  if (example.imageEnabled && example.imageModelId && !imageProviderId) {
    throw createError({
      statusCode: 422,
      statusMessage: `Template image model "${example.imageModelId}" is not available in this workspace. Check the template image provider settings.`
    });
  }

  const deck = await createDeck(workspaceId, session.user.id, { title: requestedTitle });

  await cloneTemplateFilesToDeck(example.referenceFiles, deck.id, session.user.id);

  return {
    deckId: deck.id,
    initialGenerationSettings: {
      manualInstruction: example.promptEn,
      textProviderId,
      textModelId: example.textModelId,
      customPromptId: example.customPromptId,
      designSystemId: example.designSystemId,
      languageCode: 'en',
      enableImageGeneration: example.imageEnabled,
      imageProviderId,
      imageModelId: example.imageModelId
    }
  };
});

async function cloneTemplateFilesToDeck(
  files: Array<{
    purpose: 'REFERENCE' | 'ASSET';
    assetRole: 'LOGO' | 'IMAGE' | 'FONT' | 'OTHER' | null;
    originalFilename: string;
    mimeType: string;
    extension: string;
    sizeBytes: number;
    pageCount: number | null;
    imageWidth: number | null;
    imageHeight: number | null;
    storageBucket: string;
    storageObjectPath: string;
  }>,
  deckId: string,
  userId: string
): Promise<void> {
  if (files.length === 0) return;

  const config = loadConfig(process.env);
  const expiresAt = new Date(
    Date.now() + config.referenceFileRetentionDays * 24 * 60 * 60 * 1000
  );

  for (const file of files) {
    const sourceStorage = getCachedObjectStorageAdapter(file.storageBucket);
    let body: Uint8Array;
    try {
      const stored = await sourceStorage.getObject({ objectPath: file.storageObjectPath });
      body = stored.body;
    } catch {
      // Skip files that no longer exist in storage.
      continue;
    }

    const folder = file.purpose === 'ASSET' ? 'assets' : 'references';
    const day = new Date().toISOString().slice(0, 10);
    const destinationPath = `decks/${deckId}/${folder}/${day}/${randomUUID()}.${file.extension}`;
    const destinationStorage = getCachedObjectStorageAdapter(config.gcsBucket);

    const stored = await destinationStorage.putObject({
      objectPath: destinationPath,
      body,
      contentType: file.mimeType,
      contentDisposition: `inline; filename="${file.originalFilename.replace(/["\r\n]/g, '_')}"`,
      metadata: { deckId, uploadedByUserId: userId }
    });

    try {
      await prisma.referenceFile.create({
        data: {
          deckId,
          uploadedByUserId: userId,
          purpose: file.purpose,
          assetRole: file.purpose === 'ASSET' ? file.assetRole ?? 'OTHER' : null,
          originalFilename: file.originalFilename,
          mimeType: file.mimeType,
          extension: file.extension,
          sizeBytes: file.sizeBytes,
          pageCount: file.pageCount,
          imageWidth: file.imageWidth,
          imageHeight: file.imageHeight,
          storageBucket: stored.bucket,
          storageObjectPath: stored.objectPath,
          expiresAt
        }
      });
    } catch {
      try {
        await destinationStorage.deleteObject({
          objectPath: stored.objectPath,
          ignoreIfMissing: true
        });
      } catch {
        // best effort
      }
    }
  }
}

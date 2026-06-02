import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';

import { prisma } from '@pepetex/db';
import { loadConfig } from '@pepetex/config';
import IORedis from 'ioredis';

import { getAuthenticatedSession } from '../../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../../utils/authorization';
import { submitGenerationRun } from '../../../../../utils/generation-runs';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const deckId = getRouterParam(event, 'deckId')?.trim();
  if (!deckId) throw createError({ statusCode: 400, statusMessage: 'Missing deckId.' });

  const imageId = getRouterParam(event, 'imageId')?.trim();
  if (!imageId) throw createError({ statusCode: 400, statusMessage: 'Missing imageId.' });

  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    select: { workspaceId: true }
  });
  if (!deck) throw createError({ statusCode: 404, statusMessage: 'Deck not found.' });

  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId: deck.workspaceId, userId: session.user.id }
    },
    select: { role: true }
  });
  if (!member) throw createError({ statusCode: 403, statusMessage: 'Access denied.' });

  // Load the existing generated image (include its generation run for provider info)
  const image = await prisma.generatedImage.findFirst({
    where: { id: imageId, deckId },
    include: {
      generationRun: {
        select: { imageProviderId: true, imageModelId: true }
      }
    }
  });
  if (!image) throw createError({ statusCode: 404, statusMessage: 'Generated image not found.' });

  const imageProviderId = image.generationRun?.imageProviderId ?? null;
  if (!imageProviderId) {
    throw createError({ statusCode: 422, statusMessage: 'Original image has no associated provider — cannot regenerate.' });
  }

  // Optional: override prompt via body
  const body = await readBody(event).catch(() => ({})) as Record<string, unknown>;
  const overridePrompt =
    typeof body?.prompt === 'string' && body.prompt.trim() ? body.prompt.trim() : null;

  const config = loadConfig(process.env);
  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

  const run = await submitGenerationRun(
    session.user.id,
    {
      kind: 'REGENERATE_IMAGE',
      deckId,
      workspaceId: deck.workspaceId,
      imageProviderId,
      imageModelId: image.generationRun?.imageModelId ?? image.model ?? undefined,
      imageEnabled: true,
      manualInstruction: overridePrompt ?? image.prompt ?? undefined,
      targetSlideId: image.slideId ?? undefined,
      languageCode: 'en'
    },
    redis
  );

  await redis.quit();

  return run;
});

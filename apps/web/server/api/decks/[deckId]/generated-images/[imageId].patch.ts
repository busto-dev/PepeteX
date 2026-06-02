import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';

import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../utils/authorization';

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

  const body = await readBody(event) as Record<string, unknown>;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : null;
  if (!prompt) {
    throw createError({ statusCode: 400, statusMessage: 'prompt is required.' });
  }

  const image = await prisma.generatedImage.findFirst({
    where: { id: imageId, deckId }
  });
  if (!image) throw createError({ statusCode: 404, statusMessage: 'Generated image not found.' });

  const updated = await prisma.generatedImage.update({
    where: { id: imageId },
    data: { prompt },
    select: {
      id: true,
      deckId: true,
      generationRunId: true,
      slideId: true,
      elementId: true,
      prompt: true,
      revisedPrompt: true,
      model: true,
      providerKind: true,
      gcsBucket: true,
      gcsPath: true,
      mimeType: true,
      width: true,
      height: true,
      status: true,
      friendlyError: true,
      createdAt: true,
      updatedAt: true
    }
  });

  return updated;
});

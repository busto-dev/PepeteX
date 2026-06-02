import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3';

import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const deckId = getRouterParam(event, 'deckId')?.trim();
  if (!deckId) throw createError({ statusCode: 400, statusMessage: 'Missing deckId.' });

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

  const query = getQuery(event);
  const limit = Math.min(Number(query.limit) || 20, 100);
  const slideId = typeof query.slideId === 'string' ? query.slideId : undefined;

  const images = await prisma.generatedImage.findMany({
    where: {
      deckId,
      ...(slideId ? { slideId } : {}),
      status: 'COMPLETED'
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
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
      createdAt: true
    }
  });

  return { images };
});

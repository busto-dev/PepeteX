import { createError, defineEventHandler, getRouterParam } from 'h3';

import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { getWorkspaceForUser } from '../../../utils/workspaces';
import { getCachedObjectStorageAdapter } from '../../../utils/object-storage';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);
  const deckId = getRouterParam(event, 'deckId') ?? '';

  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    select: {
      id: true,
      workspaceId: true,
      revisions: {
        where: { thumbnailGcsPath: { not: null } },
        select: { thumbnailGcsBucket: true, thumbnailGcsPath: true },
        orderBy: { revisionNumber: 'desc' },
        take: 1
      }
    }
  });

  if (!deck) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found.' });
  }

  await getWorkspaceForUser(deck.workspaceId, session.user.id);

  const thumbnailRevision = deck.revisions[0];

  if (!thumbnailRevision?.thumbnailGcsPath || !thumbnailRevision.thumbnailGcsBucket) {
    return { thumbnailUrl: null };
  }

  const storage = getCachedObjectStorageAdapter(thumbnailRevision.thumbnailGcsBucket);
  const thumbnailUrl = await storage.createSignedReadUrl({
    objectPath: thumbnailRevision.thumbnailGcsPath,
    expiresAt: new Date(Date.now() + 900_000)
  });

  return { thumbnailUrl };
});

import { defineEventHandler, getQuery } from 'h3';

import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireGlobalAdminSession } from '../../../utils/authorization';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const query = getQuery(event);
  const limit = Math.min(Number(query.limit) || 50, 200);

  const runs = await prisma.generationRun.findMany({
    where: { status: 'FAILED' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      deckId: true,
      workspaceId: true,
      kind: true,
      status: true,
      textProviderId: true,
      textModelId: true,
      imageProviderId: true,
      imageModelId: true,
      errorMessage: true,
      startedAt: true,
      completedAt: true,
      createdAt: true
    }
  });

  return { failures: runs };
});

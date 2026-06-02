import { defineEventHandler } from 'h3';

import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireGlobalAdminSession } from '../../utils/authorization';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const [
    userCount,
    workspaceCount,
    deckCount,
    generationRunCount,
    failedRunCount,
    pendingRunCount,
    activeRunCount
  ] = await Promise.all([
    prisma.user.count(),
    prisma.workspace.count(),
    prisma.deck.count(),
    prisma.generationRun.count(),
    prisma.generationRun.count({ where: { status: 'FAILED' } }),
    prisma.generationRun.count({ where: { status: 'PENDING' } }),
    prisma.generationRun.count({ where: { status: 'RUNNING' } })
  ]);

  return {
    userCount,
    workspaceCount,
    deckCount,
    generationRunCount,
    failedRunCount,
    pendingRunCount,
    activeRunCount
  };
});

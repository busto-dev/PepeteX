import { defineEventHandler, getQuery, getRouterParam } from 'h3';

import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const workspaceId = getRouterParam(event, 'workspaceId')?.trim() ?? '';

  // Verify workspace membership
  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId, userId: session.user.id }
    }
  });
  if (!member) {
    return { statusCode: 403, statusMessage: 'Access denied.' };
  }

  const query = getQuery(event);
  const from = typeof query.from === 'string' ? new Date(query.from) : undefined;
  const to = typeof query.to === 'string' ? new Date(query.to) : undefined;

  const where = {
    workspaceId,
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {})
          }
        }
      : {})
  };

  const [
    totalRuns,
    completedRuns,
    failedRuns,
    pendingRuns,
    byKind
  ] = await Promise.all([
    prisma.generationRun.count({ where }),
    prisma.generationRun.count({ where: { ...where, status: 'COMPLETED' } }),
    prisma.generationRun.count({ where: { ...where, status: 'FAILED' } }),
    prisma.generationRun.count({ where: { ...where, status: 'PENDING' } }),
    prisma.generationRun.groupBy({
      by: ['kind'],
      _count: { id: true },
      where
    })
  ]);

  return {
    workspaceId,
    totalRuns,
    completedRuns,
    failedRuns,
    pendingRuns,
    byKind: byKind.map((r) => ({ kind: r.kind, count: r._count.id }))
  };
});

import { defineEventHandler, getQuery } from 'h3';

import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireGlobalAdminSession } from '../../utils/authorization';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const query = getQuery(event);
  const from = typeof query.from === 'string' ? new Date(query.from) : undefined;
  const to = typeof query.to === 'string' ? new Date(query.to) : undefined;
  const workspaceId = typeof query.workspaceId === 'string' ? query.workspaceId : undefined;

  const where = {
    ...(workspaceId ? { workspaceId } : {}),
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
    activeRuns,
    byKind
  ] = await Promise.all([
    prisma.generationRun.count({ where }),
    prisma.generationRun.count({ where: { ...where, status: 'COMPLETED' } }),
    prisma.generationRun.count({ where: { ...where, status: 'FAILED' } }),
    prisma.generationRun.count({ where: { ...where, status: 'PENDING' } }),
    prisma.generationRun.count({ where: { ...where, status: 'RUNNING' } }),
    prisma.generationRun.groupBy({
      by: ['kind'],
      _count: { id: true },
      where
    })
  ]);

  return {
    totalRuns,
    completedRuns,
    failedRuns,
    pendingRuns,
    activeRuns,
    byKind: byKind.map((r) => ({ kind: r.kind, count: r._count.id }))
  };
});

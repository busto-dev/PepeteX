import { defineEventHandler, getQuery } from 'h3';

import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireGlobalAdminSession } from '../../utils/authorization';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const query = getQuery(event);
  const limit = Math.min(Number(query.limit) || 50, 200);
  const cursor = typeof query.cursor === 'string' ? query.cursor : undefined;
  const action = typeof query.action === 'string' ? query.action : undefined;
  const actorUserId = typeof query.actorUserId === 'string' ? query.actorUserId : undefined;
  const from = typeof query.from === 'string' ? new Date(query.from) : undefined;
  const to = typeof query.to === 'string' ? new Date(query.to) : undefined;

  const where = {
    ...(action ? { action } : {}),
    ...(actorUserId ? { actorUserId } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {})
          }
        }
      : {})
  };

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
  });

  const hasMore = logs.length > limit;
  const items = hasMore ? logs.slice(0, limit) : logs;
  const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

  return {
    logs: items,
    nextCursor: nextCursor ?? null,
    hasMore
  };
});

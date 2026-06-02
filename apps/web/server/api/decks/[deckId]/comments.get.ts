import { defineEventHandler, getRouterParam, getQuery } from 'h3';

import type { CommentStatus } from '@pepetex/db';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { listDeckComments } from '../../../utils/comments';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);
  const deckId = getRouterParam(event, 'deckId') ?? '';
  const query = getQuery(event);

  const rawStatuses = typeof query.status === 'string' ? query.status.split(',') : [];
  const validStatuses: CommentStatus[] = rawStatuses.filter((s): s is CommentStatus =>
    ['OPEN', 'SUBMITTED', 'APPLIED', 'RESOLVED', 'REJECTED'].includes(s)
  );
  const slideId = typeof query.slideId === 'string' && query.slideId.trim().length > 0
    ? query.slideId.trim()
    : undefined;

  const comments = await listDeckComments(deckId, session.user.id, {
    ...(validStatuses.length > 0 ? { statuses: validStatuses } : {}),
    ...(slideId !== undefined ? { slideId } : {})
  });

  return { comments };
});

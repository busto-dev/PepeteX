import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../utils/authorization';
import { deleteComment } from '../../../../utils/comments';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);
  const deckId = getRouterParam(event, 'deckId') ?? '';
  const commentId = getRouterParam(event, 'commentId') ?? '';

  await deleteComment(deckId, commentId, session.user.id);

  setResponseStatus(event, 204);
  return null;
});

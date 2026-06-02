import { defineEventHandler, getRouterParam, readBody } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { createComment } from '../../../utils/comments';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);
  const deckId = getRouterParam(event, 'deckId') ?? '';
  const body = await readBody(event);

  const comment = await createComment(deckId, session.user.id, {
    slideId: typeof body?.slideId === 'string' ? body.slideId : null,
    elementIds: Array.isArray(body?.elementIds) ? body.elementIds.filter((id: unknown) => typeof id === 'string') : [],
    text: typeof body?.text === 'string' ? body.text : ''
  });

  return { comment };
});

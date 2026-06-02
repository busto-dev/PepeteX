import { defineEventHandler, getRouterParam, readBody } from 'h3';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../utils/authorization';
import { updateComment } from '../../../../utils/comments';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);
  const deckId = getRouterParam(event, 'deckId') ?? '';
  const commentId = getRouterParam(event, 'commentId') ?? '';
  const body = await readBody(event);

  const updates: { text?: string; slideId?: string | null; elementIds?: string[] } = {};
  if (typeof body?.text === 'string') updates.text = body.text;
  if ('slideId' in (body ?? {})) updates.slideId = typeof body.slideId === 'string' ? body.slideId : null;
  if (Array.isArray(body?.elementIds)) {
    updates.elementIds = body.elementIds.filter((id: unknown) => typeof id === 'string');
  }

  const comment = await updateComment(deckId, commentId, session.user.id, updates);

  return { comment };
});

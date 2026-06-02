import { createError, defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { listDeckExports } from '../../../utils/exports';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const deckId = getRouterParam(event, 'deckId');
  if (!deckId) throw createError({ statusCode: 400, message: 'Missing deckId' });

  const exports = await listDeckExports({ deckId, userId: session.user.id });
  return { exports };
});

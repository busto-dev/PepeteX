import { createError, defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../utils/authorization';
import { runExportDryRunForDeck } from '../../../../utils/exports';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const deckId = getRouterParam(event, 'deckId');
  if (!deckId) throw createError({ statusCode: 400, message: 'Missing deckId' });

  return runExportDryRunForDeck({ deckId, userId: session.user.id });
});

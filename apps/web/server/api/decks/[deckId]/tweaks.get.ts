import { defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { getPendingTweakBatch } from '../../../utils/tweaks';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);
  const deckId = getRouterParam(event, 'deckId') ?? '';

  const batch = await getPendingTweakBatch(deckId, session.user.id);

  return { batch };
});

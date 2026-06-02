import { defineEventHandler, getRouterParam } from 'h3';

import { requireAuthenticatedSession } from '../../utils/authorization';
import { getAuthenticatedSession } from '../../utils/auth';
import { assertManagedDeckId, getDeckDetail } from '../../utils/decks';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const deckId = assertManagedDeckId(getRouterParam(event, 'deckId'));
  const deck = await getDeckDetail(deckId, session.user.id);

  return {
    deck
  };
});

import { defineEventHandler, getRouterParam, readBody } from 'h3';

import { requireAuthenticatedSession } from '../../utils/authorization';
import { getAuthenticatedSession } from '../../utils/auth';
import {
  assertManagedDeckId,
  assertWorkspaceDeckInput,
  updateDeck
} from '../../utils/decks';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const deckId = assertManagedDeckId(getRouterParam(event, 'deckId'));
  const input = assertWorkspaceDeckInput(await readBody(event));
  const deck = await updateDeck(deckId, session.user.id, input);

  return {
    ok: true,
    deck
  };
});

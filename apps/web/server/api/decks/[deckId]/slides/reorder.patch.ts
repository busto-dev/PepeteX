import { defineEventHandler, getRouterParam, readBody } from 'h3';

import { requireAuthenticatedSession } from '../../../../utils/authorization';
import { getAuthenticatedSession } from '../../../../utils/auth';
import {
  assertManagedDeckId,
  assertReorderDeckSlideInput,
  reorderDeckSlide
} from '../../../../utils/decks';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const deckId = assertManagedDeckId(getRouterParam(event, 'deckId'));
  const input = assertReorderDeckSlideInput(await readBody(event));
  const deck = await reorderDeckSlide(deckId, session.user.id, input);

  return {
    ok: true,
    deck
  };
});

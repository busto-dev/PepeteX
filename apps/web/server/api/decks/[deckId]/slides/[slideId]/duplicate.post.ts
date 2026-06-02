import { defineEventHandler, getRouterParam } from 'h3';

import { requireAuthenticatedSession } from '../../../../../utils/authorization';
import { getAuthenticatedSession } from '../../../../../utils/auth';
import {
  assertManagedDeckId,
  assertManagedSlideId,
  duplicateDeckSlide
} from '../../../../../utils/decks';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const deckId = assertManagedDeckId(getRouterParam(event, 'deckId'));
  const slideId = assertManagedSlideId(getRouterParam(event, 'slideId'));
  const deck = await duplicateDeckSlide(deckId, slideId, session.user.id);

  return {
    ok: true,
    deck
  };
});

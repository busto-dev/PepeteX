import { defineEventHandler, getRouterParam } from 'h3';

import { requireAuthenticatedSession } from '../../../../../utils/authorization';
import { getAuthenticatedSession } from '../../../../../utils/auth';
import {
  assertManagedDeckId,
  assertManagedRevisionId,
  restoreDeckRevision
} from '../../../../../utils/decks';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const deckId = assertManagedDeckId(getRouterParam(event, 'deckId'));
  const revisionId = assertManagedRevisionId(getRouterParam(event, 'revisionId'));
  const deck = await restoreDeckRevision(deckId, revisionId, session.user.id);

  return {
    ok: true,
    deck
  };
});

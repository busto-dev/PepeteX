import { defineEventHandler, getRouterParam, readBody } from 'h3';

import { requireAuthenticatedSession } from '../../../utils/authorization';
import { getAuthenticatedSession } from '../../../utils/auth';
import {
  assertDeckWorkspaceOperationInput,
  assertManagedDeckId,
  moveDeckToWorkspace
} from '../../../utils/decks';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const deckId = assertManagedDeckId(getRouterParam(event, 'deckId'));
  const input = assertDeckWorkspaceOperationInput(await readBody(event));
  const deck = await moveDeckToWorkspace(deckId, session.user.id, input);

  return {
    ok: true,
    deck
  };
});

import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3';

import { requireAuthenticatedSession } from '../../../utils/authorization';
import { getAuthenticatedSession } from '../../../utils/auth';
import {
  assertDeckWorkspaceOperationInput,
  assertManagedDeckId,
  forkDeckToWorkspace
} from '../../../utils/decks';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const deckId = assertManagedDeckId(getRouterParam(event, 'deckId'));
  const input = assertDeckWorkspaceOperationInput(await readBody(event));
  const deck = await forkDeckToWorkspace(deckId, session.user.id, input);

  setResponseStatus(event, 201);

  return {
    ok: true,
    deck
  };
});

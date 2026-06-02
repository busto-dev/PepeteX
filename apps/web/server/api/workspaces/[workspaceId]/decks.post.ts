import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3';

import { requireAuthenticatedSession } from '../../../utils/authorization';
import { getAuthenticatedSession } from '../../../utils/auth';
import { assertWorkspaceDeckInput, createDeck } from '../../../utils/decks';
import { assertWorkspaceId } from '../../../utils/workspaces';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const workspaceId = assertWorkspaceId(getRouterParam(event, 'workspaceId'));
  const input = assertWorkspaceDeckInput(await readBody(event));
  const deck = await createDeck(workspaceId, session.user.id, input);

  setResponseStatus(event, 201);

  return {
    ok: true,
    deck
  };
});

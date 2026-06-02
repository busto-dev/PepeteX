import { defineEventHandler, getRouterParam } from 'h3';

import { requireAuthenticatedSession } from '../../../utils/authorization';
import { getAuthenticatedSession } from '../../../utils/auth';
import { listWorkspaceDecks } from '../../../utils/decks';
import { assertWorkspaceId } from '../../../utils/workspaces';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const workspaceId = assertWorkspaceId(getRouterParam(event, 'workspaceId'));

  return {
    decks: await listWorkspaceDecks(workspaceId, session.user.id)
  };
});

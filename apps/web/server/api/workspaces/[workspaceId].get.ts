import { defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireAuthenticatedSession } from '../../utils/authorization';
import { assertWorkspaceId, getWorkspaceForUser } from '../../utils/workspaces';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const workspaceId = assertWorkspaceId(getRouterParam(event, 'workspaceId'));

  return {
    workspace: await getWorkspaceForUser(workspaceId, session.user.id)
  };
});

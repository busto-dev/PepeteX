import { defineEventHandler, getQuery, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../utils/authorization';
import {
  assertWorkspaceId,
  assertWorkspaceMemberCandidateQuery,
  searchWorkspaceMemberCandidates
} from '../../../../utils/workspaces';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const workspaceId = assertWorkspaceId(getRouterParam(event, 'workspaceId'));
  const query = assertWorkspaceMemberCandidateQuery(getQuery(event));

  return {
    users: await searchWorkspaceMemberCandidates(workspaceId, session.user.id, query)
  };
});

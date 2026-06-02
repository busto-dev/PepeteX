import { defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../utils/authorization';
import {
  assertWorkspaceId,
  assertWorkspaceMemberId,
  deleteWorkspaceMember
} from '../../../../utils/workspaces';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const workspaceId = assertWorkspaceId(getRouterParam(event, 'workspaceId'));
  const memberId = assertWorkspaceMemberId(getRouterParam(event, 'memberId'));
  await deleteWorkspaceMember(workspaceId, memberId, session.user.id);

  return {
    ok: true
  };
});

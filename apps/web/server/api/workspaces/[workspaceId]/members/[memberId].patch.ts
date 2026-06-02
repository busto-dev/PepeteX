import { defineEventHandler, getRouterParam, readBody } from 'h3';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../utils/authorization';
import {
  assertUpdateWorkspaceMemberInput,
  assertWorkspaceId,
  assertWorkspaceMemberId,
  updateWorkspaceMember
} from '../../../../utils/workspaces';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const workspaceId = assertWorkspaceId(getRouterParam(event, 'workspaceId'));
  const memberId = assertWorkspaceMemberId(getRouterParam(event, 'memberId'));
  const input = assertUpdateWorkspaceMemberInput(await readBody(event));
  const member = await updateWorkspaceMember(workspaceId, memberId, session.user.id, input);

  return {
    ok: true,
    member
  };
});

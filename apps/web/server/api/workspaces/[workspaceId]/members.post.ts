import { defineEventHandler, getRouterParam, readBody } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import {
  assertCreateWorkspaceMemberInput,
  assertWorkspaceId,
  createWorkspaceMember
} from '../../../utils/workspaces';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const workspaceId = assertWorkspaceId(getRouterParam(event, 'workspaceId'));
  const input = assertCreateWorkspaceMemberInput(await readBody(event));
  const member = await createWorkspaceMember(workspaceId, session.user.id, input);

  event.node.res.statusCode = 201;

  return {
    ok: true,
    member
  };
});

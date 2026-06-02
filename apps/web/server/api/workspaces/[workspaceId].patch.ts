import { defineEventHandler, getRouterParam, readBody } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireAuthenticatedSession } from '../../utils/authorization';
import {
  assertSharedWorkspaceInput,
  assertWorkspaceId,
  updateSharedWorkspace
} from '../../utils/workspaces';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const workspaceId = assertWorkspaceId(getRouterParam(event, 'workspaceId'));
  const input = assertSharedWorkspaceInput(await readBody(event));
  const workspace = await updateSharedWorkspace(workspaceId, session.user.id, input);

  return {
    ok: true,
    workspace
  };
});

import { defineEventHandler, readBody } from 'h3';

import { getAuthenticatedSession } from '../utils/auth';
import { requireAuthenticatedSession } from '../utils/authorization';
import { assertSharedWorkspaceInput, createSharedWorkspace } from '../utils/workspaces';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const input = assertSharedWorkspaceInput(await readBody(event));
  const workspace = await createSharedWorkspace(session.user.id, input);

  event.node.res.statusCode = 201;

  return {
    ok: true,
    workspace
  };
});

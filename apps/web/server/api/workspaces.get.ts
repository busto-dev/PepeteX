import { defineEventHandler } from 'h3';

import { getAuthenticatedSession } from '../utils/auth';
import { requireAuthenticatedSession } from '../utils/authorization';
import { listUserWorkspaces } from '../utils/workspaces';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  return {
    workspaces: await listUserWorkspaces(session.user.id)
  };
});

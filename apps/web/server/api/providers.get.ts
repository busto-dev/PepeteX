import { defineEventHandler, getQuery } from 'h3';

import { getAuthenticatedSession } from '../utils/auth';
import { requireAuthenticatedSession } from '../utils/authorization';
import { listProvidersForUser } from '../utils/providers';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);
  const query = getQuery(event);
  const workspaceId =
    typeof query.workspaceId === 'string' && query.workspaceId.trim()
      ? query.workspaceId.trim()
      : undefined;

  return {
    providers: await listProvidersForUser(
      session.user.id,
      session.user.globalRole === 'GLOBAL_ADMIN',
      workspaceId ? { workspaceId } : {}
    )
  };
});

import { defineEventHandler, getQuery } from 'h3';

import { getAuthenticatedSession } from '../utils/auth';
import { requireAuthenticatedSession } from '../utils/authorization';
import { listDesignSystemsForUser } from '../utils/design-systems';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const query = getQuery(event);
  const workspaceId =
    typeof query.workspaceId === 'string' && query.workspaceId.trim()
      ? query.workspaceId.trim()
      : undefined;

  return {
    designSystems: await listDesignSystemsForUser(
      session.user.id,
      workspaceId ? { workspaceId } : {}
    )
  };
});

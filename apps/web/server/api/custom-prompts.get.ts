import { defineEventHandler, getQuery } from 'h3';

import { getAuthenticatedSession } from '../utils/auth';
import { listCustomPromptsForUser } from '../utils/custom-prompts';
import { requireAuthenticatedSession } from '../utils/authorization';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const query = getQuery(event);
  const workspaceId =
    typeof query.workspaceId === 'string' && query.workspaceId.trim()
      ? query.workspaceId.trim()
      : undefined;

  return {
    customPrompts: await listCustomPromptsForUser(session.user.id, workspaceId ? { workspaceId } : {})
  };
});

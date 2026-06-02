import { defineEventHandler } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { listWorkspaceProviderPolicies } from '../../../utils/workspaces';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  return {
    policies: await listWorkspaceProviderPolicies(
      event.context.params?.workspaceId ?? '',
      session.user.id
    )
  };
});

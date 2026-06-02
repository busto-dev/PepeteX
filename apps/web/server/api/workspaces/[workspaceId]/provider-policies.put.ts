import { defineEventHandler, readBody } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import {
  assertWorkspaceProviderPoliciesInput,
  replaceWorkspaceProviderPolicies
} from '../../../utils/workspaces';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const input = assertWorkspaceProviderPoliciesInput(await readBody(event));

  return {
    ok: true,
    policies: await replaceWorkspaceProviderPolicies(
      event.context.params?.workspaceId ?? '',
      session.user.id,
      input
    )
  };
});

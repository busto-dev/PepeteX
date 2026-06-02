import { defineEventHandler, readBody } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { testProviderConnection } from '../../../utils/providers';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const body = (await readBody(event)) as {
    credentialId?: unknown;
    workspaceId?: unknown;
  } | null;
  const credentialId =
    body &&
    typeof body === 'object' &&
    typeof body.credentialId === 'string' &&
    body.credentialId.trim()
      ? body.credentialId.trim()
      : undefined;
  const workspaceId =
    body &&
    typeof body === 'object' &&
    typeof body.workspaceId === 'string' &&
    body.workspaceId.trim()
      ? body.workspaceId.trim()
      : undefined;

  return {
    ok: true,
    result: await testProviderConnection(
      event.context.params?.providerId,
      session.user.id,
      session.user.globalRole === 'GLOBAL_ADMIN',
      {
        ...(workspaceId ? { workspaceId } : {}),
        ...(credentialId ? { credentialId } : {})
      }
    )
  };
});

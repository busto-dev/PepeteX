import { defineEventHandler } from 'h3';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireGlobalAdminSession } from '../../../../utils/authorization';
import { testProviderConnection } from '../../../../utils/providers';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const providerId = event.context.params?.providerId;

  const result = await testProviderConnection(
    providerId,
    session.user.id,
    true, // isAdmin = true, so system credentials are used
    {}
  );

  return {
    ok: result.ok,
    message: result.message ?? (result.ok ? 'Connection successful' : 'Connection failed'),
  };
});

import { defineEventHandler } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireGlobalAdminSession } from '../../../utils/authorization';
import { revealProviderCredential } from '../../../utils/providers';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const credential = await revealProviderCredential(
    event.context.params?.credentialId,
    session.user.id
  );

  return {
    ok: true,
    credential
  };
});

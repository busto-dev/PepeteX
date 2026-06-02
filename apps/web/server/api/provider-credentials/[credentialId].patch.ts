import { defineEventHandler, readBody } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireAuthenticatedSession } from '../../utils/authorization';
import {
  assertUpsertProviderCredentialInput,
  updateProviderCredential
} from '../../utils/providers';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const credential = await updateProviderCredential(
    event.context.params?.credentialId,
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN',
    assertUpsertProviderCredentialInput(await readBody(event), 'update')
  );

  return {
    ok: true,
    credential
  };
});

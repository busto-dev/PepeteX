import { defineEventHandler, readBody } from 'h3';

import { getAuthenticatedSession } from '../utils/auth';
import { requireAuthenticatedSession } from '../utils/authorization';
import {
  assertUpsertProviderCredentialInput,
  createProviderCredential
} from '../utils/providers';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const credential = await createProviderCredential(
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN',
    assertUpsertProviderCredentialInput(await readBody(event), 'create')
  );

  event.node.res.statusCode = 201;

  return {
    ok: true,
    credential
  };
});

import { defineEventHandler, readBody } from 'h3';

import {
  assertManualAdminPasswordResetInput,
  resetAdminUserPassword
} from '../../../utils/admin-users';
import { getAuthenticatedSession } from '../../../utils/auth';
import { requireGlobalAdminSession } from '../../../utils/authorization';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const input = assertManualAdminPasswordResetInput(await readBody(event));

  await resetAdminUserPassword(input, session.user.id);

  return {
    ok: true
  };
});

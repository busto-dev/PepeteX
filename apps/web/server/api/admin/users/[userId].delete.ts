import { defineEventHandler, getRouterParam, readBody } from 'h3';

import { assertDeleteAdminUserInput, deleteAdminUser } from '../../../utils/admin-users';
import { getAuthenticatedSession } from '../../../utils/auth';
import { requireGlobalAdminSession } from '../../../utils/authorization';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const input = assertDeleteAdminUserInput(getRouterParam(event, 'userId'), await readBody(event));
  await deleteAdminUser(input, session.user.id);

  return {
    ok: true
  };
});

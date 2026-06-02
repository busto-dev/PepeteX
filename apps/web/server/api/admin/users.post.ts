import { defineEventHandler, readBody } from 'h3';

import { createAdminUser, assertCreateAdminUserInput } from '../../utils/admin-users';
import { getAuthenticatedSession } from '../../utils/auth';
import { requireGlobalAdminSession } from '../../utils/authorization';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const input = assertCreateAdminUserInput(await readBody(event));
  const user = await createAdminUser(input, session.user.id);

  event.node.res.statusCode = 201;

  return {
    ok: true,
    user
  };
});

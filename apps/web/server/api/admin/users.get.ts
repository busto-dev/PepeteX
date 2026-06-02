import { defineEventHandler } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireGlobalAdminSession } from '../../utils/authorization';
import { listAdminUsers } from '../../utils/admin-users';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  return {
    users: await listAdminUsers()
  };
});

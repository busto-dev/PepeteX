import { defineEventHandler } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireAuthenticatedSession } from '../../utils/authorization';
import { markAllNotificationsRead } from '../../utils/notifications';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const result = await markAllNotificationsRead(session.user.id);

  return result;
});

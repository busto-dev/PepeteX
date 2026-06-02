import { defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { markNotificationRead } from '../../../utils/notifications';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const notificationId = getRouterParam(event, 'notificationId')?.trim() ?? '';

  const notification = await markNotificationRead(notificationId, session.user.id);

  return notification;
});

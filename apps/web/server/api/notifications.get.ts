import { defineEventHandler, getQuery } from 'h3';

import { getAuthenticatedSession } from '../utils/auth';
import { requireAuthenticatedSession } from '../utils/authorization';
import { listNotifications } from '../utils/notifications';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const query = getQuery(event);
  const limit = typeof query.limit === 'string' ? parseInt(query.limit, 10) : undefined;
  const unreadOnly = query.unreadOnly === 'true' || query.unreadOnly === '1';

  const notifications = await listNotifications(session.user.id, { limit, unreadOnly });

  return { notifications };
});

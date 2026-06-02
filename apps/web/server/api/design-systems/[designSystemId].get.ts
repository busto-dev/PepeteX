import { defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireAuthenticatedSession } from '../../utils/authorization';
import { assertDesignSystemId, getDesignSystemForUser } from '../../utils/design-systems';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  return {
    designSystem: await getDesignSystemForUser(
      assertDesignSystemId(getRouterParam(event, 'designSystemId')),
      session.user.id
    )
  };
});

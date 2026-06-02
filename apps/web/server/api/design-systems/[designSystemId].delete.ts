import { defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireAuthenticatedSession } from '../../utils/authorization';
import { assertDesignSystemId, deleteDesignSystem } from '../../utils/design-systems';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  await deleteDesignSystem(
    assertDesignSystemId(getRouterParam(event, 'designSystemId')),
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN'
  );

  return {
    ok: true
  };
});

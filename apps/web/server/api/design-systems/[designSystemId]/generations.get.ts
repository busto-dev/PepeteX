import { defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { assertCanManageDesignSystemForUser, assertDesignSystemId } from '../../../utils/design-systems';
import { listDesignSystemGenerationRuns } from '../../../utils/design-system-generation-runs';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const designSystemId = assertDesignSystemId(getRouterParam(event, 'designSystemId'));
  await assertCanManageDesignSystemForUser(
    designSystemId,
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN'
  );

  return { runs: await listDesignSystemGenerationRuns(designSystemId) };
});

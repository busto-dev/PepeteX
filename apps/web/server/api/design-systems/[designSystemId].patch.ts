import { defineEventHandler, getRouterParam, readBody } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireAuthenticatedSession } from '../../utils/authorization';
import {
  assertDesignSystemId,
  assertUpdateDesignSystemInput,
  updateDesignSystem
} from '../../utils/design-systems';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  return {
    ok: true,
    designSystem: await updateDesignSystem(
      assertDesignSystemId(getRouterParam(event, 'designSystemId')),
      session.user.id,
      session.user.globalRole === 'GLOBAL_ADMIN',
      assertUpdateDesignSystemInput(await readBody(event))
    )
  };
});

import { defineEventHandler, getRouterParam, readBody } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import {
  assertDesignSystemId,
  assertDuplicateDesignSystemInput,
  duplicateDesignSystem
} from '../../../utils/design-systems';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const designSystem = await duplicateDesignSystem(
    assertDesignSystemId(getRouterParam(event, 'designSystemId')),
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN',
    assertDuplicateDesignSystemInput(await readBody(event))
  );

  event.node.res.statusCode = 201;

  return {
    ok: true,
    designSystem
  };
});

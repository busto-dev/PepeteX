import { defineEventHandler, readBody } from 'h3';

import { getAuthenticatedSession } from '../utils/auth';
import { requireAuthenticatedSession } from '../utils/authorization';
import { assertCreateDesignSystemInput, createDesignSystem } from '../utils/design-systems';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const designSystem = await createDesignSystem(
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN',
    assertCreateDesignSystemInput(await readBody(event))
  );

  event.node.res.statusCode = 201;

  return {
    ok: true,
    designSystem
  };
});

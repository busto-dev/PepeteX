import { defineEventHandler, readBody } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireAuthenticatedSession } from '../../utils/authorization';
import { assertImportDesignSystemInput, importDesignSystem } from '../../utils/design-systems';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const designSystem = await importDesignSystem(
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN',
    assertImportDesignSystemInput(await readBody(event))
  );

  event.node.res.statusCode = 201;

  return {
    ok: true,
    designSystem
  };
});

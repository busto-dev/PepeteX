import { defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { assertDesignSystemId } from '../../../utils/design-systems';
import { listDesignSystemReferenceFiles } from '../../../utils/design-system-reference-files';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const designSystemId = assertDesignSystemId(getRouterParam(event, 'designSystemId'));
  const referenceFiles = await listDesignSystemReferenceFiles(designSystemId, session.user.id);

  return { ok: true, referenceFiles };
});

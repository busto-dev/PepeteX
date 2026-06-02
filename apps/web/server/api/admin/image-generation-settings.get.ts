import { defineEventHandler } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireGlobalAdminSession } from '../../utils/authorization';
import { getGlobalImageGenerationSettings } from '../../utils/image-generation-settings';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  return {
    settings: await getGlobalImageGenerationSettings()
  };
});
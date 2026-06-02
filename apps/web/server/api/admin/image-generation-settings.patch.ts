import { defineEventHandler, readBody } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireGlobalAdminSession } from '../../utils/authorization';
import {
  assertGlobalImageGenerationSettingsInput,
  updateGlobalImageGenerationSettings
} from '../../utils/image-generation-settings';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  return {
    ok: true,
    settings: await updateGlobalImageGenerationSettings(
      assertGlobalImageGenerationSettingsInput(await readBody(event))
    )
  };
});
import { defineEventHandler, readBody } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import {
  assertWorkspaceImageGenerationSettingsInput,
  replaceWorkspaceImageGenerationSettings
} from '../../../utils/image-generation-settings';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const result = await replaceWorkspaceImageGenerationSettings(
    event.context.params?.workspaceId ?? '',
    session.user.id,
    assertWorkspaceImageGenerationSettingsInput(await readBody(event))
  );

  return {
    ok: true,
    ...result
  };
});
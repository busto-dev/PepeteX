import { defineEventHandler } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { getWorkspaceImageGenerationSettings } from '../../../utils/image-generation-settings';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  return await getWorkspaceImageGenerationSettings(
    event.context.params?.workspaceId ?? '',
    session.user.id
  );
});
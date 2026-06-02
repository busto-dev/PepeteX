import { defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireAuthenticatedSession } from '../../utils/authorization';
import { assertCustomPromptId, getCustomPromptForUser } from '../../utils/custom-prompts';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  return {
    customPrompt: await getCustomPromptForUser(
      assertCustomPromptId(getRouterParam(event, 'customPromptId')),
      session.user.id
    )
  };
});

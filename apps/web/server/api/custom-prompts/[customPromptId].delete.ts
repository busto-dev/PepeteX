import { defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireAuthenticatedSession } from '../../utils/authorization';
import { assertCustomPromptId, deleteCustomPrompt } from '../../utils/custom-prompts';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  await deleteCustomPrompt(
    assertCustomPromptId(getRouterParam(event, 'customPromptId')),
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN'
  );

  return {
    ok: true
  };
});

import { defineEventHandler, getRouterParam, readBody } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireAuthenticatedSession } from '../../utils/authorization';
import {
  assertCustomPromptId,
  assertUpdateCustomPromptInput,
  updateCustomPrompt
} from '../../utils/custom-prompts';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const customPrompt = await updateCustomPrompt(
    assertCustomPromptId(getRouterParam(event, 'customPromptId')),
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN',
    assertUpdateCustomPromptInput(await readBody(event))
  );

  return {
    ok: true,
    customPrompt
  };
});

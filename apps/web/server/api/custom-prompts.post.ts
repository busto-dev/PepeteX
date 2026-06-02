import { defineEventHandler, readBody } from 'h3';

import { getAuthenticatedSession } from '../utils/auth';
import { requireAuthenticatedSession } from '../utils/authorization';
import { assertCreateCustomPromptInput, createCustomPrompt } from '../utils/custom-prompts';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const customPrompt = await createCustomPrompt(
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN',
    assertCreateCustomPromptInput(await readBody(event))
  );

  event.node.res.statusCode = 201;

  return {
    ok: true,
    customPrompt
  };
});

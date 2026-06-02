import { defineEventHandler, readBody } from 'h3';

import { assertLoginInput, loginWithPassword } from '../../utils/auth';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const result = await loginWithPassword(event, assertLoginInput(body));

  return {
    ok: true,
    sessionId: result.sessionId,
    user: result.user
  };
});

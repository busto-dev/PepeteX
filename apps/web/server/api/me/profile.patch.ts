import { defineEventHandler, readBody } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireAuthenticatedSession } from '../../utils/authorization';
import { assertUpdateProfileInput, updateProfile } from '../../utils/profile';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const input = assertUpdateProfileInput(await readBody(event));
  const profile = await updateProfile(session.user.id, input);

  return {
    ok: true,
    profile
  };
});

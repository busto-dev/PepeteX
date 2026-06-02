import { defineEventHandler } from 'h3';

import { getAuthenticatedSession } from '../utils/auth';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);

  return {
    authenticated: Boolean(session),
    user: session?.user ?? null
  };
});

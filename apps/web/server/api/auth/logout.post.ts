import { defineEventHandler } from 'h3';

import { logoutCurrentSession } from '../../utils/auth';

export default defineEventHandler(async (event) => {
  await logoutCurrentSession(event);

  return {
    ok: true
  };
});

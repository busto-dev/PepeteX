import { defineEventHandler, readBody } from 'h3';

import {
  assertPasswordResetRequestInput,
  requestPasswordReset
} from '../../../utils/password-reset';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  await requestPasswordReset(assertPasswordResetRequestInput(body));

  return {
    ok: true
  };
});

import { defineEventHandler, readBody } from 'h3';

import {
  assertPasswordResetConfirmationInput,
  confirmPasswordReset
} from '../../../utils/password-reset';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  await confirmPasswordReset(assertPasswordResetConfirmationInput(body));

  return {
    ok: true
  };
});

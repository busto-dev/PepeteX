import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../utils/authorization';
import { updateTweakItem } from '../../../../utils/tweaks';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);
  const deckId = getRouterParam(event, 'deckId') ?? '';
  const tweakItemId = getRouterParam(event, 'tweakItemId') ?? '';
  const body = await readBody(event);

  if (body?.value === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'value is required.' });
  }

  const item = await updateTweakItem(deckId, tweakItemId, session.user.id, body.value);

  return { item };
});

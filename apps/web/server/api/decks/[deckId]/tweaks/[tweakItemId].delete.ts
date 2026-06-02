import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../utils/authorization';
import { deleteTweakItem } from '../../../../utils/tweaks';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);
  const deckId = getRouterParam(event, 'deckId') ?? '';
  const tweakItemId = getRouterParam(event, 'tweakItemId') ?? '';

  await deleteTweakItem(deckId, tweakItemId, session.user.id);

  setResponseStatus(event, 204);
  return null;
});

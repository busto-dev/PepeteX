import { defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import {
  assertDeckId,
  listDeckAssets
} from '../../../utils/reference-files';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  return {
    assets: await listDeckAssets(
      assertDeckId(getRouterParam(event, 'deckId')),
      session.user.id
    )
  };
});

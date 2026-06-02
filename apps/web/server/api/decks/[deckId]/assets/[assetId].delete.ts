import { defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../utils/authorization';
import {
  assertDeckId,
  assertReferenceFileId,
  deleteDeckAsset
} from '../../../../utils/reference-files';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  await deleteDeckAsset(
    assertDeckId(getRouterParam(event, 'deckId')),
    assertReferenceFileId(getRouterParam(event, 'assetId')),
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN'
  );

  return {
    ok: true
  };
});

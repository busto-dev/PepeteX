import { defineEventHandler, getRouterParam, readBody } from 'h3';

import { getAuthenticatedSession } from '../../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../../utils/authorization';
import {
  assertDeckId,
  assertReferenceFileBridgeInput,
  assertReferenceFileId,
  bridgeReferenceFileToProvider
} from '../../../../../utils/reference-files';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const body = await readBody(event);
  const input = assertReferenceFileBridgeInput(body);
  const result = await bridgeReferenceFileToProvider(
    assertDeckId(getRouterParam(event, 'deckId')),
    assertReferenceFileId(getRouterParam(event, 'referenceFileId')),
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN',
    input
  );

  return {
    ok: true,
    ...result
  };
});

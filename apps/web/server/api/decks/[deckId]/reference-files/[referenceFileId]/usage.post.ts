import { defineEventHandler, getRouterParam, readBody } from 'h3';

import { getAuthenticatedSession } from '../../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../../utils/authorization';
import {
  assertDeckId,
  assertGenerationUsageInput,
  assertReferenceFileId,
  recordReferenceFileUsage
} from '../../../../../utils/reference-files';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const body = await readBody(event);
  const input = assertGenerationUsageInput(body);
  const usage = await recordReferenceFileUsage(
    assertDeckId(getRouterParam(event, 'deckId')),
    assertReferenceFileId(getRouterParam(event, 'referenceFileId')),
    session.user.id,
    input.generationId
  );

  return {
    ok: true,
    usage
  };
});

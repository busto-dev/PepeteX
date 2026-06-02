import { defineEventHandler, readBody } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import {
  assertProviderCostEstimateInput,
  estimateProviderCost
} from '../../../utils/providers';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const body = await readBody(event);
  const input = assertProviderCostEstimateInput(body);

  return {
    ok: true,
    result: await estimateProviderCost(
      event.context.params?.providerId,
      session.user.id,
      session.user.globalRole === 'GLOBAL_ADMIN',
      input
    )
  };
});

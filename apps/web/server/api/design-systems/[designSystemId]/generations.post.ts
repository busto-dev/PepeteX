import { defineEventHandler, getRouterParam, readBody } from 'h3';
import IORedis from 'ioredis';

import { loadConfig } from '@pepetex/config';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import {
  assertCanManageDesignSystemForUser,
  assertDesignSystemId,
  getDesignSystemForUser
} from '../../../utils/design-systems';
import {
  assertSubmitDesignSystemGenerationRunInput,
  submitDesignSystemGenerationRun
} from '../../../utils/design-system-generation-runs';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const designSystemId = assertDesignSystemId(getRouterParam(event, 'designSystemId'));
  await assertCanManageDesignSystemForUser(
    designSystemId,
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN'
  );
  const designSystem = await getDesignSystemForUser(designSystemId, session.user.id);

  const body = await readBody(event);
  const input = assertSubmitDesignSystemGenerationRunInput({
    ...body,
    designSystemId,
    workspaceId: designSystem.workspaceId ?? null
  });

  const config = loadConfig(process.env);
  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  try {
    return await submitDesignSystemGenerationRun(session.user.id, input, redis);
  } finally {
    await redis.quit();
  }
});

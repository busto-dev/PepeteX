import { createError, defineEventHandler, getRouterParam } from 'h3';
import IORedis from 'ioredis';

import { loadConfig } from '@pepetex/config';

import { getAuthenticatedSession } from '../../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../../utils/authorization';
import { assertCanManageDesignSystemForUser, assertDesignSystemId } from '../../../../../utils/design-systems';
import { cancelDesignSystemGenerationRun } from '../../../../../utils/design-system-generation-runs';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const designSystemId = assertDesignSystemId(getRouterParam(event, 'designSystemId'));
  const runId = getRouterParam(event, 'runId')?.trim();
  if (!runId) throw createError({ statusCode: 400, statusMessage: 'Missing runId.' });

  await assertCanManageDesignSystemForUser(
    designSystemId,
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN'
  );

  const config = loadConfig(process.env);
  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  try {
    return await cancelDesignSystemGenerationRun(runId, designSystemId, redis);
  } finally {
    await redis.quit();
  }
});

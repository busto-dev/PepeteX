import { defineEventHandler, getRouterParam } from 'h3';
import IORedis from 'ioredis';
import { loadConfig } from '@pepetex/config';
import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../utils/authorization';
import { submitTweakBatch } from '../../../../utils/tweaks';
import {
  resolveDeckRefinementGenerationDefaults,
  submitGenerationRun
} from '../../../../utils/generation-runs';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);
  const deckId = getRouterParam(event, 'deckId') ?? '';

  const defaults = await resolveDeckRefinementGenerationDefaults(deckId, session.user.id);
  const result = await submitTweakBatch(deckId, session.user.id);

  const config = loadConfig(process.env);
  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

  try {
    const generationRun = await submitGenerationRun(
      session.user.id,
      {
        deckId,
        workspaceId: defaults.workspaceId,
        kind: 'AGENT_COMMAND',
        textProviderId: defaults.textProviderId,
        textModelId: defaults.textModelId,
        manualInstruction: 'Apply the submitted tweak batch to this deck.',
        commandContextJson: {
          source: 'tweaks_submit',
          intent: 'apply_tweaks',
          tweakBatchId: result.batchId
        }
      },
      redis
    );

    return { ...result, generationRun };
  } catch (error) {
    await prisma.tweakBatch.updateMany({
      where: { id: result.batchId, deckId, status: 'SUBMITTED' },
      data: { status: 'PENDING', submittedAt: null }
    });
    throw error;
  } finally {
    await redis.quit();
  }
});

import { defineEventHandler, getRouterParam } from 'h3';
import IORedis from 'ioredis';
import { loadConfig } from '@pepetex/config';
import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../utils/authorization';
import { submitComments } from '../../../../utils/comments';
import {
  resolveDeckRefinementGenerationDefaults,
  submitGenerationRun
} from '../../../../utils/generation-runs';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);
  const deckId = getRouterParam(event, 'deckId') ?? '';

  const defaults = await resolveDeckRefinementGenerationDefaults(deckId, session.user.id);
  const result = await submitComments(deckId, session.user.id);

  if (result.submittedCount === 0) {
    return { ...result, generationRun: null };
  }

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
        manualInstruction: 'Apply the submitted comments to this deck.',
        commandContextJson: {
          source: 'comments_submit',
          intent: 'apply_comments',
          commentIds: result.comments.map((comment) => comment.id)
        }
      },
      redis
    );

    return { ...result, generationRun };
  } catch (error) {
    await prisma.comment.updateMany({
      where: {
        id: { in: result.comments.map((comment) => comment.id) },
        deckId,
        status: 'SUBMITTED'
      },
      data: { status: 'OPEN' }
    });
    throw error;
  } finally {
    await redis.quit();
  }
});

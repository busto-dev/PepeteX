import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';

import { prisma } from '@pepetex/db';
import { canEditDeck } from '@pepetex/rbac';

import { getAuthenticatedSession } from '../../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../../utils/authorization';
import { assertAskResumeInput, resumeGenerationRun } from '../../../../../utils/generation-runs';
import IORedis from 'ioredis';
import { loadConfig } from '@pepetex/config';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const deckId = getRouterParam(event, 'deckId')?.trim();
  const runId = getRouterParam(event, 'runId')?.trim();
  if (!deckId) throw createError({ statusCode: 400, statusMessage: 'Missing deckId.' });
  if (!runId) throw createError({ statusCode: 400, statusMessage: 'Missing runId.' });

  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    select: { workspaceId: true }
  });
  if (!deck) throw createError({ statusCode: 404, statusMessage: 'Deck not found.' });

  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId: deck.workspaceId, userId: session.user.id }
    },
    select: { role: true }
  });
  if (!member) throw createError({ statusCode: 403, statusMessage: 'Access denied.' });
  if (!canEditDeck(member.role as Parameters<typeof canEditDeck>[0])) {
    throw createError({ statusCode: 403, statusMessage: 'Editor access required.' });
  }

  const body = await readBody(event);
  const { answer } = assertAskResumeInput(body);

  const config = loadConfig(process.env);
  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  try {
    const run = await resumeGenerationRun(runId, deckId, session.user.id, answer, redis);
    return run;
  } finally {
    await redis.quit();
  }
});

import { Readable } from 'node:stream';
import { createError, defineEventHandler, getRouterParam, sendStream, setHeader } from 'h3';

import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../../utils/authorization';
import { getGenerationRun, type GenerationRunSummary } from '../../../../../utils/generation-runs';

const STREAM_POLL_INTERVAL_MS = 300;
const HEARTBEAT_INTERVAL_MS = 15000;
const TERMINAL_STATUSES: GenerationRunSummary['status'][] = ['COMPLETED', 'FAILED', 'CANCELLED', 'WAITING_ASK'];

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const deckId = getRouterParam(event, 'deckId')?.trim();
  const runId = getRouterParam(event, 'runId')?.trim();
  if (!deckId) throw createError({ statusCode: 400, statusMessage: 'Missing deckId.' });
  if (!runId) throw createError({ statusCode: 400, statusMessage: 'Missing runId.' });
  const resolvedDeckId = deckId;
  const resolvedRunId = runId;

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

  setHeader(event, 'content-type', 'text/event-stream; charset=utf-8');
  setHeader(event, 'cache-control', 'no-cache, no-transform');
  setHeader(event, 'connection', 'keep-alive');
  setHeader(event, 'x-accel-buffering', 'no');

  const stream = new Readable({ read() {} });
  let closed = false;
  let lastSignature = '';
  let lastHeartbeatAt = Date.now();
  let interval: ReturnType<typeof setInterval> | null = null;

  function closeStream() {
    if (closed) return;
    closed = true;
    if (interval !== null) clearInterval(interval);
    interval = null;
    stream.push(null);
  }

  function sendEvent(name: string, data: unknown) {
    if (closed) return;
    stream.push(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function sendHeartbeat() {
    if (closed) return;
    const now = Date.now();
    if (now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
    stream.push(': heartbeat\n\n');
    lastHeartbeatAt = now;
  }

  async function emitRunIfChanged(force = false) {
    if (closed) return;

    const run = await getGenerationRun(resolvedRunId, resolvedDeckId);
    const signature = getGenerationRunStreamSignature(run);
    if (force || signature !== lastSignature) {
      lastSignature = signature;
      sendEvent('generation-run', run);
    } else {
      sendHeartbeat();
    }

    if (TERMINAL_STATUSES.includes(run.status)) {
      sendEvent('done', { status: run.status });
      closeStream();
    }
  }

  event.node.req.on('close', closeStream);
  stream.on('error', closeStream);

  void emitRunIfChanged(true)
    .then(() => {
      if (closed) return;
      interval = setInterval(() => {
        void emitRunIfChanged().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          sendEvent('error', { message });
          closeStream();
        });
      }, STREAM_POLL_INTERVAL_MS);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      sendEvent('error', { message });
      closeStream();
    });

  return sendStream(event, stream);
});

function getGenerationRunStreamSignature(run: GenerationRunSummary): string {
  return JSON.stringify({
    status: run.status,
    updatedAt: run.updatedAt,
    errorMessage: run.errorMessage,
    aiSummary: run.aiSummary,
    resultRevisionId: run.resultRevisionId,
    askQuestion: run.askQuestion,
    askOptionsJson: run.askOptionsJson,
    targetSlideId: run.targetSlideId,
    targetElementId: run.targetElementId,
    commandContextJson: run.commandContextJson,
    todos: run.todos,
    plan: run.plan,
    messages: run.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      metadata: message.metadata,
      createdAt: message.createdAt
    })),
    toolCalls: run.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      label: toolCall.label,
      status: toolCall.status,
      resultJson: toolCall.resultJson,
      errorMessage: toolCall.errorMessage,
      updatedAt: toolCall.updatedAt
    })),
    latestCheckpoint: run.latestCheckpoint
      ? {
          id: run.latestCheckpoint.id,
          status: run.latestCheckpoint.status,
          summary: run.latestCheckpoint.summary,
          createdAt: run.latestCheckpoint.createdAt
        }
      : null
  });
}

import { Readable } from 'node:stream';
import { createError, defineEventHandler, getRouterParam, sendStream, setHeader } from 'h3';

import { getAuthenticatedSession } from '../../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../../utils/authorization';
import { assertCanManageDesignSystemForUser, assertDesignSystemId } from '../../../../../utils/design-systems';
import {
  getDesignSystemGenerationRun,
  type DesignSystemGenerationRunSummary
} from '../../../../../utils/design-system-generation-runs';

const STREAM_POLL_INTERVAL_MS = 300;
const HEARTBEAT_INTERVAL_MS = 15000;
const TERMINAL_STATUSES: DesignSystemGenerationRunSummary['status'][] = ['COMPLETED', 'FAILED', 'CANCELLED', 'WAITING_ASK'];

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
  const resolvedRunId = runId;

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
    const run = await getDesignSystemGenerationRun(resolvedRunId, designSystemId);
    const signature = getStreamSignature(run);
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

function getStreamSignature(run: DesignSystemGenerationRunSummary): string {
  return JSON.stringify({
    status: run.status,
    updatedAt: run.updatedAt,
    errorMessage: run.errorMessage,
    aiSummary: run.aiSummary,
    resultVersionId: run.resultVersionId,
    askQuestion: run.askQuestion,
    askOptionsJson: run.askOptionsJson,
    messages: run.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, metadata: m.metadata, createdAt: m.createdAt })),
    toolCalls: run.toolCalls.map((t) => ({ id: t.id, name: t.name, label: t.label, status: t.status, resultJson: t.resultJson, errorMessage: t.errorMessage, updatedAt: t.updatedAt })),
    latestCheckpoint: run.latestCheckpoint
      ? { id: run.latestCheckpoint.id, status: run.latestCheckpoint.status, summary: run.latestCheckpoint.summary, createdAt: run.latestCheckpoint.createdAt }
      : null
  });
}

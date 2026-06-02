import { randomBytes } from 'node:crypto';

import { createError } from 'h3';
import { prisma, Prisma } from '@pepetex/db';
import type { DesignSystemGenerationRunKind, GenerationRunStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { designSystemGenerationRunQueueName } from '@pepetex/queue';
import { parseChatImageAttachments, type ChatImageAttachment } from './generation-runs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubmitDesignSystemGenerationRunInput {
  designSystemId: string;
  workspaceId?: string | null;
  kind: DesignSystemGenerationRunKind;
  textProviderId?: string;
  textModelId?: string;
  imageEnabled?: boolean;
  imageProviderId?: string;
  imageModelId?: string;
  languageCode?: string;
  manualInstruction?: string;
  feedbackContext?: unknown;
  /** Ephemeral image attachments for vision (not stored as reference files). */
  attachments?: ChatImageAttachment[];
}

export interface DesignSystemGenerationMessageSummary {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'VERIFIER';
  content: string;
  metadata: unknown;
  createdAt: string;
}

export interface DesignSystemGenerationToolCallSummary {
  id: string;
  mastraToolCallId: string | null;
  name: string;
  label: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  inputJson: unknown;
  resultJson: unknown;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesignSystemGenerationCheckpointSummary {
  id: string;
  status: 'DRAFT' | 'VALIDATED' | 'VALIDATION_FAILED' | 'COMMITTED';
  summary: string | null;
  documentJson: unknown;
  validationJson: unknown;
  versionId: string | null;
  createdAt: string;
}

export interface DesignSystemGenerationRunSummary {
  id: string;
  designSystemId: string;
  kind: DesignSystemGenerationRunKind;
  status: GenerationRunStatus;
  textProviderId: string | null;
  textModelId: string | null;
  imageEnabled: boolean;
  imageProviderId: string | null;
  imageModelId: string | null;
  languageCode: string;
  manualInstruction: string | null;
  feedbackContextJson: unknown;
  resultVersionId: string | null;
  aiSummary: string | null;
  errorMessage: string | null;
  mastraResourceId: string | null;
  mastraThreadId: string | null;
  mastraRunId: string | null;
  agentStepCount: number;
  inputTokensUsed: number;
  outputTokensUsed: number;
  askQuestion: string | null;
  askOptionsJson: unknown;
  askAllowManualAnswer: boolean;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: DesignSystemGenerationMessageSummary[];
  toolCalls: DesignSystemGenerationToolCallSummary[];
  latestCheckpoint: DesignSystemGenerationCheckpointSummary | null;
}

const ALLOWED_KINDS: DesignSystemGenerationRunKind[] = ['DS_AGENT_COMMAND', 'DS_FULL_GENERATE'];
const CANCELLABLE_STATUSES: GenerationRunStatus[] = ['PENDING', 'RUNNING', 'WAITING_ASK'];

const timelineInclude = {
  messages: { orderBy: { createdAt: 'asc' as const } },
  toolCalls: { orderBy: { createdAt: 'asc' as const } },
  checkpoints: {
    where: { status: { not: 'VALIDATION_FAILED' as const } },
    orderBy: { createdAt: 'desc' as const },
    take: 1
  }
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function assertSubmitDesignSystemGenerationRunInput(input: unknown): SubmitDesignSystemGenerationRunInput {
  const candidate = input as Partial<SubmitDesignSystemGenerationRunInput> | null;
  if (!candidate || typeof candidate !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Generation run input is required.' });
  }
  const kind = candidate.kind;
  if (!kind || !ALLOWED_KINDS.includes(kind as DesignSystemGenerationRunKind)) {
    throw createError({ statusCode: 400, statusMessage: `kind must be one of: ${ALLOWED_KINDS.join(', ')}.` });
  }
  if (!candidate.textProviderId?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'textProviderId is required.' });
  }
  if (!candidate.textModelId?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'textModelId is required.' });
  }
  if (kind === 'DS_AGENT_COMMAND' && !candidate.manualInstruction?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'manualInstruction is required for DS_AGENT_COMMAND.' });
  }
  return {
    designSystemId: candidate.designSystemId ?? '',
    workspaceId: candidate.workspaceId ?? null,
    kind: kind as DesignSystemGenerationRunKind,
    textProviderId: candidate.textProviderId.trim(),
    textModelId: candidate.textModelId.trim(),
    imageEnabled: candidate.imageEnabled === true,
    imageProviderId: candidate.imageProviderId?.trim() || undefined,
    imageModelId: candidate.imageModelId?.trim() || undefined,
    languageCode: candidate.languageCode?.trim() || 'en',
    manualInstruction: candidate.manualInstruction?.trim() || undefined,
    feedbackContext: candidate.feedbackContext ?? undefined,
    attachments: parseChatImageAttachments(candidate.attachments)
  };
}

export function assertDesignSystemAskResumeInput(input: unknown): { answer: string } {
  const candidate = input as { answer?: unknown } | null;
  if (!candidate || typeof candidate !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Resume input is required.' });
  }
  const answer = typeof candidate.answer === 'string' ? candidate.answer.trim() : JSON.stringify(candidate.answer);
  if (!answer) throw createError({ statusCode: 400, statusMessage: 'answer is required.' });
  return { answer };
}

export function isCancellableDesignSystemGenerationRunStatus(status: GenerationRunStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

type RunRecord = Prisma.DesignSystemGenerationRunGetPayload<{ include: typeof timelineInclude }>;

export function toDesignSystemGenerationRunSummary(run: RunRecord): DesignSystemGenerationRunSummary {
  return {
    id: run.id,
    designSystemId: run.designSystemId,
    kind: run.kind,
    status: run.status,
    textProviderId: run.textProviderId,
    textModelId: run.textModelId,
    imageEnabled: run.imageEnabled,
    imageProviderId: run.imageProviderId,
    imageModelId: run.imageModelId,
    languageCode: run.languageCode,
    manualInstruction: run.manualInstruction,
    feedbackContextJson: run.feedbackContextJson ?? null,
    resultVersionId: run.resultVersionId,
    aiSummary: run.aiSummary,
    errorMessage: run.errorMessage,
    mastraResourceId: run.mastraResourceId,
    mastraThreadId: run.mastraThreadId,
    mastraRunId: run.mastraRunId,
    agentStepCount: run.agentStepCount,
    inputTokensUsed: run.inputTokensUsed,
    outputTokensUsed: run.outputTokensUsed,
    askQuestion: run.status === 'WAITING_ASK' ? run.askQuestion : null,
    askOptionsJson: run.status === 'WAITING_ASK' ? run.askOptionsJson : null,
    askAllowManualAnswer: run.askAllowManualAnswer,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    messages: run.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      metadata: m.metadata ?? null,
      createdAt: m.createdAt.toISOString()
    })),
    toolCalls: run.toolCalls.map((t) => ({
      id: t.id,
      mastraToolCallId: t.mastraToolCallId,
      name: t.name,
      label: t.label,
      status: t.status,
      inputJson: t.inputJson ?? null,
      resultJson: t.resultJson ?? null,
      errorMessage: t.errorMessage,
      startedAt: t.startedAt.toISOString(),
      completedAt: t.completedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString()
    })),
    latestCheckpoint: run.checkpoints[0]
      ? {
          id: run.checkpoints[0].id,
          status: run.checkpoints[0].status,
          summary: run.checkpoints[0].summary,
          documentJson: run.checkpoints[0].documentJson,
          validationJson: run.checkpoints[0].validationJson ?? null,
          versionId: run.checkpoints[0].versionId,
          createdAt: run.checkpoints[0].createdAt.toISOString()
        }
      : null
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function buildInitialUserMessage(input: SubmitDesignSystemGenerationRunInput): string | null {
  const base = input.manualInstruction?.trim()
    || (input.kind === 'DS_FULL_GENERATE' ? 'Generate a complete design system.' : null);
  if (!base) return null;
  if (input.feedbackContext && typeof input.feedbackContext === 'object') {
    return `[Scoped feedback: ${JSON.stringify(input.feedbackContext)}]\n${base}`;
  }
  return base;
}

export async function submitDesignSystemGenerationRun(
  actorUserId: string,
  input: SubmitDesignSystemGenerationRunInput,
  redis: IORedis
): Promise<DesignSystemGenerationRunSummary> {
  const initialUserMessage = buildInitialUserMessage(input);

  const run = await prisma.designSystemGenerationRun.create({
    data: {
      designSystemId: input.designSystemId,
      workspaceId: input.workspaceId ?? null,
      createdByUserId: actorUserId,
      kind: input.kind,
      status: 'PENDING',
      textProviderId: input.textProviderId ?? null,
      textModelId: input.textModelId ?? null,
      imageEnabled: input.imageEnabled ?? false,
      imageProviderId: input.imageProviderId ?? null,
      imageModelId: input.imageModelId ?? null,
      languageCode: input.languageCode ?? 'en',
      manualInstruction: input.manualInstruction ?? null,
      feedbackContextJson: input.feedbackContext != null ? (input.feedbackContext as Prisma.InputJsonValue) : Prisma.DbNull,
      ...(initialUserMessage || (input.attachments && input.attachments.length > 0)
        ? {
            messages: {
              create: {
                role: 'USER',
                content: initialUserMessage ?? 'Use the attached image(s).',
                ...(input.attachments && input.attachments.length > 0
                  ? { metadata: { attachments: input.attachments } as unknown as Prisma.InputJsonValue }
                  : {})
              }
            }
          }
        : {})
    },
    include: timelineInclude
  });

  const queue = new Queue(designSystemGenerationRunQueueName, { connection: redis });
  try {
    await queue.add(
      'design-system-agent-run',
      {
        jobId: randomBytes(8).toString('hex'),
        workspaceId: input.workspaceId ?? '',
        actorUserId,
        idempotencyKey: randomBytes(16).toString('hex'),
        requestedAt: new Date().toISOString(),
        designSystemGenerationRunId: run.id
      },
      { attempts: 2, backoff: { type: 'exponential', delay: 5000 }, jobId: `ds-gen-run-${run.id}` }
    );
  } finally {
    await queue.close();
  }

  return toDesignSystemGenerationRunSummary(run);
}

export async function listDesignSystemGenerationRuns(designSystemId: string, limit = 20): Promise<DesignSystemGenerationRunSummary[]> {
  const runs = await prisma.designSystemGenerationRun.findMany({
    where: { designSystemId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: timelineInclude
  });
  return runs.map(toDesignSystemGenerationRunSummary);
}

export async function getDesignSystemGenerationRun(runId: string, designSystemId: string): Promise<DesignSystemGenerationRunSummary> {
  const run = await prisma.designSystemGenerationRun.findFirst({
    where: { id: runId, designSystemId },
    include: timelineInclude
  });
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Generation run not found.' });
  return toDesignSystemGenerationRunSummary(run);
}

export async function resumeDesignSystemGenerationRun(
  runId: string,
  designSystemId: string,
  actorUserId: string,
  answer: string,
  redis: IORedis
): Promise<DesignSystemGenerationRunSummary> {
  const run = await prisma.designSystemGenerationRun.findFirst({ where: { id: runId, designSystemId } });
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Generation run not found.' });
  if (run.status !== 'WAITING_ASK') {
    throw createError({ statusCode: 409, statusMessage: 'Generation run is not waiting for an answer.' });
  }

  const updated = await prisma.designSystemGenerationRun.update({
    where: { id: runId },
    data: {
      status: 'PENDING',
      pendingAskAnswer: answer,
      askQuestion: null,
      askOptionsJson: Prisma.DbNull,
      messages: { create: { role: 'USER', content: answer } }
    },
    include: timelineInclude
  });

  const queue = new Queue(designSystemGenerationRunQueueName, { connection: redis });
  try {
    await queue.add(
      'design-system-agent-run',
      {
        jobId: randomBytes(8).toString('hex'),
        workspaceId: run.workspaceId ?? '',
        actorUserId,
        idempotencyKey: randomBytes(16).toString('hex'),
        requestedAt: new Date().toISOString(),
        designSystemGenerationRunId: runId
      },
      { attempts: 2, backoff: { type: 'exponential', delay: 5000 }, jobId: `ds-gen-run-resume-${runId}-${Date.now()}` }
    );
  } finally {
    await queue.close();
  }

  return toDesignSystemGenerationRunSummary(updated);
}

export async function cancelDesignSystemGenerationRun(
  runId: string,
  designSystemId: string,
  redis?: IORedis
): Promise<DesignSystemGenerationRunSummary> {
  const run = await prisma.designSystemGenerationRun.findFirst({ where: { id: runId, designSystemId }, include: timelineInclude });
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Generation run not found.' });
  if (run.status === 'CANCELLED') return toDesignSystemGenerationRunSummary(run);
  if (!isCancellableDesignSystemGenerationRunStatus(run.status)) {
    throw createError({ statusCode: 409, statusMessage: `Generation run cannot be cancelled from status ${run.status}.` });
  }

  if (redis && run.status === 'PENDING') {
    const queue = new Queue(designSystemGenerationRunQueueName, { connection: redis });
    try {
      const job = await queue.getJob(`ds-gen-run-${run.id}`);
      await job?.remove().catch(() => undefined);
    } finally {
      await queue.close();
    }
  }

  await prisma.designSystemGenerationToolCall.updateMany({
    where: { runId, status: 'RUNNING' },
    data: { status: 'FAILED', completedAt: new Date(), errorMessage: 'Generation cancelled by user.' }
  });

  const updated = await prisma.designSystemGenerationRun.update({
    where: { id: runId },
    data: {
      status: 'CANCELLED',
      completedAt: new Date(),
      errorMessage: 'Generation cancelled by user.',
      pendingAskAnswer: null,
      askQuestion: null,
      askOptionsJson: Prisma.DbNull,
      messages: { create: { role: 'SYSTEM', content: 'Generation was cancelled by user request.', metadata: { kind: 'generation_cancelled' } } }
    },
    include: timelineInclude
  });
  return toDesignSystemGenerationRunSummary(updated);
}

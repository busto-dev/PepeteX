import { createError } from 'h3';
import { prisma, Prisma } from '@pepetex/db';
import type { GenerationRunKind, GenerationRunStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { generationRunQueueName } from '@pepetex/queue';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '@pepetex/config';
import { canEditDeck } from '@pepetex/rbac';

const config = loadConfig(process.env);

export type SubmitGenerationRunKind = 'AGENT_COMMAND' | 'GENERATE_IMAGE' | 'REGENERATE_IMAGE';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubmitGenerationRunInput {
  deckId: string;
  workspaceId: string;
  kind: SubmitGenerationRunKind;
  textProviderId?: string;
  textModelId?: string;
  imageEnabled?: boolean;
  imageProviderId?: string;
  imageModelId?: string;
  customPromptId?: string;
  designSystemId?: string;
  languageCode?: string;
  manualInstruction?: string;
  targetSlideId?: string;
  targetElementId?: string;
  slideInstruction?: string;
  commandContextJson?: unknown;
  /** Ephemeral image attachments for vision (not stored as reference files). */
  attachments?: ChatImageAttachment[];
}

export interface ChatImageAttachment {
  mimeType: string;
  dataBase64: string;
}

const MAX_CHAT_IMAGE_ATTACHMENTS = 6;
const MAX_CHAT_IMAGE_BASE64_LENGTH = 12_000_000; // ~9 MB decoded per image

export function parseChatImageAttachments(input: unknown): ChatImageAttachment[] {
  if (!Array.isArray(input)) return [];
  const result: ChatImageAttachment[] = [];
  for (const entry of input.slice(0, MAX_CHAT_IMAGE_ATTACHMENTS)) {
    if (!entry || typeof entry !== 'object') continue;
    const mimeType = (entry as { mimeType?: unknown }).mimeType;
    let dataBase64 = (entry as { dataBase64?: unknown }).dataBase64;
    if (typeof dataBase64 === 'string' && dataBase64.startsWith('data:')) {
      dataBase64 = dataBase64.slice(dataBase64.indexOf(',') + 1);
    }
    if (
      typeof mimeType === 'string' &&
      mimeType.startsWith('image/') &&
      typeof dataBase64 === 'string' &&
      dataBase64.length > 0 &&
      dataBase64.length <= MAX_CHAT_IMAGE_BASE64_LENGTH
    ) {
      result.push({ mimeType, dataBase64 });
    }
  }
  return result;
}

export interface GenerationRunSummary {
  id: string;
  deckId: string;
  kind: GenerationRunKind;
  status: GenerationRunStatus;
  textProviderId: string | null;
  textModelId: string | null;
  imageEnabled: boolean;
  imageProviderId: string | null;
  imageModelId: string | null;
  customPromptId: string | null;
  designSystemId: string | null;
  languageCode: string;
  manualInstruction: string | null;
  targetSlideId: string | null;
  targetElementId: string | null;
  commandContextJson: unknown;
  resultRevisionId: string | null;
  aiSummary: string | null;
  errorMessage: string | null;
  mastraResourceId: string | null;
  mastraThreadId: string | null;
  mastraRunId: string | null;
  agentTraceId: string | null;
  agentMode: string | null;
  agentStepCount: number;
  inputTokensUsed: number;
  outputTokensUsed: number;
  // ASK mode fields (only present when status === WAITING_ASK)
  askQuestion: string | null;
  askOptionsJson: unknown;
  askAllowManualAnswer: boolean;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: GenerationMessageSummary[];
  toolCalls: GenerationToolCallSummary[];
  latestCheckpoint: GenerationCheckpointSummary | null;
}

export interface GenerationMessageSummary {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'VERIFIER';
  content: string;
  metadata: unknown;
  createdAt: string;
}

export interface GenerationToolCallSummary {
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

export interface GenerationCheckpointSummary {
  id: string;
  status: 'DRAFT' | 'VALIDATED' | 'VALIDATION_FAILED' | 'COMMITTED';
  summary: string | null;
  deckJson: unknown;
  validationJson: unknown;
  revisionId: string | null;
  createdAt: string;
}

export interface DeckRefinementGenerationDefaults {
  workspaceId: string;
  textProviderId: string;
  textModelId: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const ALLOWED_KINDS: GenerationRunKind[] = [
  'AGENT_COMMAND',
  'GENERATE_IMAGE',
  'REGENERATE_IMAGE'
];

const LEGACY_TEXT_GENERATION_KINDS: GenerationRunKind[] = [
  'FULL_DECK',
  'SINGLE_SLIDE',
  'REGENERATE_SLIDE',
  'APPLY_COMMENTS',
  'APPLY_TWEAKS'
];

const TEXT_GENERATION_KINDS: GenerationRunKind[] = ['AGENT_COMMAND'];

const CANCELLABLE_STATUSES: GenerationRunStatus[] = ['PENDING', 'RUNNING', 'WAITING_ASK'];
const INITIAL_GENERATION_DEDUPE_STATUSES: GenerationRunStatus[] = ['PENDING', 'RUNNING', 'WAITING_ASK', 'COMPLETED'];

const generationRunTimelineInclude = {
  messages: { orderBy: { createdAt: 'asc' as const } },
  toolCalls: { orderBy: { createdAt: 'asc' as const } },
  checkpoints: {
    where: { status: { not: 'VALIDATION_FAILED' as const } },
    orderBy: { createdAt: 'desc' as const },
    take: 1
  }
};

export function assertSubmitGenerationRunInput(input: unknown): SubmitGenerationRunInput {
  const candidate = input as Partial<SubmitGenerationRunInput> | null;

  if (!candidate || typeof candidate !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Generation run input is required.' });
  }

  const kind = candidate.kind;
  if (LEGACY_TEXT_GENERATION_KINDS.includes(kind as GenerationRunKind)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Legacy text generation kind ${kind} is no longer accepted. Submit AGENT_COMMAND with commandContextJson.intent instead.`
    });
  }

  if (!kind || !ALLOWED_KINDS.includes(kind as GenerationRunKind)) {
    throw createError({
      statusCode: 400,
      statusMessage: `kind must be one of: ${ALLOWED_KINDS.join(', ')}.`
    });
  }

  if (
    (kind === 'GENERATE_IMAGE' || kind === 'REGENERATE_IMAGE') &&
    !candidate.imageProviderId
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'imageProviderId is required for image generation.'
    });
  }

  assertRequiredTextGenerationSelection(
    kind as GenerationRunKind,
    candidate.textProviderId,
    candidate.textModelId
  );

  return {
    kind: kind as SubmitGenerationRunKind,
    deckId: candidate.deckId ?? '',
    workspaceId: candidate.workspaceId ?? '',
    textProviderId: candidate.textProviderId?.trim() || undefined,
    textModelId: candidate.textModelId?.trim() || undefined,
    imageEnabled: candidate.imageEnabled === true,
    imageProviderId: candidate.imageProviderId?.trim() || undefined,
    imageModelId: candidate.imageModelId?.trim() || undefined,
    customPromptId: candidate.customPromptId?.trim() || undefined,
    designSystemId: candidate.designSystemId?.trim() || undefined,
    languageCode: candidate.languageCode?.trim() || 'en',
    manualInstruction: candidate.manualInstruction?.trim() || undefined,
    targetSlideId: candidate.targetSlideId?.trim() || undefined,
    targetElementId: candidate.targetElementId?.trim() || undefined,
    commandContextJson: candidate.commandContextJson ?? undefined,
    slideInstruction: candidate.slideInstruction?.trim() || undefined,
    attachments: parseChatImageAttachments(candidate.attachments)
  };
}

export function assertAskResumeInput(
  input: unknown
): { answer: string } {
  const candidate = input as { answer?: unknown } | null;
  if (!candidate || typeof candidate !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Resume input is required.' });
  }
  const answer =
    typeof candidate.answer === 'string' ? candidate.answer.trim() : JSON.stringify(candidate.answer);
  if (!answer) {
    throw createError({ statusCode: 400, statusMessage: 'answer is required.' });
  }
  return { answer };
}

export function isCancellableGenerationRunStatus(status: GenerationRunStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}

function assertRequiredTextGenerationSelection(
  kind: GenerationRunKind,
  textProviderId?: string | null,
  textModelId?: string | null
): void {
  if (!TEXT_GENERATION_KINDS.includes(kind)) {
    return;
  }

  if (!textProviderId?.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'textProviderId is required for text generation.'
    });
  }

  if (!textModelId?.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'textModelId is required for text generation.'
    });
  }
}

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

export function toGenerationRunSummary(run: {
  id: string;
  deckId: string;
  kind: GenerationRunKind;
  status: GenerationRunStatus;
  textProviderId: string | null;
  textModelId: string | null;
  imageEnabled: boolean;
  imageProviderId: string | null;
  imageModelId: string | null;
  customPromptId: string | null;
  designSystemId: string | null;
  languageCode: string;
  manualInstruction: string | null;
  targetSlideId: string | null;
  targetElementId: string | null;
  commandContextJson: unknown;
  resultRevisionId: string | null;
  aiSummary: string | null;
  errorMessage: string | null;
  mastraResourceId: string | null;
  mastraThreadId: string | null;
  mastraRunId: string | null;
  agentTraceId: string | null;
  agentMode: string | null;
  agentStepCount: number;
  inputTokensUsed: number;
  outputTokensUsed: number;
  askQuestion: string | null;
  askOptionsJson: unknown;
  askAllowManualAnswer: boolean;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  messages?: Array<{
    id: string;
    role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'VERIFIER';
    content: string;
    metadata: unknown;
    createdAt: Date;
  }>;
  toolCalls?: Array<{
    id: string;
    mastraToolCallId: string | null;
    name: string;
    label: string;
    status: 'RUNNING' | 'COMPLETED' | 'FAILED';
    inputJson: unknown;
    resultJson: unknown;
    errorMessage: string | null;
    startedAt: Date;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  checkpoints?: Array<{
    id: string;
    status: 'DRAFT' | 'VALIDATED' | 'VALIDATION_FAILED' | 'COMMITTED';
    summary: string | null;
    deckJson: unknown;
    validationJson: unknown;
    revisionId: string | null;
    createdAt: Date;
  }>;
}): GenerationRunSummary {
  return {
    id: run.id,
    deckId: run.deckId,
    kind: run.kind,
    status: run.status,
    textProviderId: run.textProviderId,
    textModelId: run.textModelId,
    imageEnabled: run.imageEnabled,
    imageProviderId: run.imageProviderId,
    imageModelId: run.imageModelId,
    customPromptId: run.customPromptId,
    designSystemId: run.designSystemId,
    languageCode: run.languageCode,
    manualInstruction: run.manualInstruction,
    targetSlideId: run.targetSlideId,
    targetElementId: run.targetElementId,
    commandContextJson: run.commandContextJson ?? null,
    resultRevisionId: run.resultRevisionId,
    aiSummary: run.aiSummary,
    errorMessage: run.errorMessage,
    mastraResourceId: run.mastraResourceId,
    mastraThreadId: run.mastraThreadId,
    mastraRunId: run.mastraRunId,
    agentTraceId: run.agentTraceId,
    agentMode: run.agentMode,
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
    messages: (run.messages ?? []).map(toGenerationMessageSummary),
    toolCalls: (run.toolCalls ?? []).map(toGenerationToolCallSummary),
    latestCheckpoint: run.checkpoints?.[0]
      ? toGenerationCheckpointSummary(run.checkpoints[0])
      : null
  };
}

function toGenerationMessageSummary(message: {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'VERIFIER';
  content: string;
  metadata: unknown;
  createdAt: Date;
}): GenerationMessageSummary {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    metadata: message.metadata ?? null,
    createdAt: message.createdAt.toISOString()
  };
}

function toGenerationToolCallSummary(toolCall: {
  id: string;
  mastraToolCallId: string | null;
  name: string;
  label: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  inputJson: unknown;
  resultJson: unknown;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): GenerationToolCallSummary {
  return {
    id: toolCall.id,
    mastraToolCallId: toolCall.mastraToolCallId,
    name: toolCall.name,
    label: toolCall.label,
    status: toolCall.status,
    inputJson: toolCall.inputJson ?? null,
    resultJson: toolCall.resultJson ?? null,
    errorMessage: toolCall.errorMessage,
    startedAt: toolCall.startedAt.toISOString(),
    completedAt: toolCall.completedAt?.toISOString() ?? null,
    createdAt: toolCall.createdAt.toISOString(),
    updatedAt: toolCall.updatedAt.toISOString()
  };
}

function toGenerationCheckpointSummary(checkpoint: {
  id: string;
  status: 'DRAFT' | 'VALIDATED' | 'VALIDATION_FAILED' | 'COMMITTED';
  summary: string | null;
  deckJson: unknown;
  validationJson: unknown;
  revisionId: string | null;
  createdAt: Date;
}): GenerationCheckpointSummary {
  return {
    id: checkpoint.id,
    status: checkpoint.status,
    summary: checkpoint.summary,
    deckJson: checkpoint.deckJson,
    validationJson: checkpoint.validationJson ?? null,
    revisionId: checkpoint.revisionId,
    createdAt: checkpoint.createdAt.toISOString()
  };
}

export async function resolveDeckRefinementGenerationDefaults(
  deckId: string,
  actorUserId: string
): Promise<DeckRefinementGenerationDefaults> {
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    select: {
      workspaceId: true,
      lastUsedTextProviderId: true,
      lastUsedTextModelId: true
    }
  });

  if (!deck) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found.' });
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId: deck.workspaceId, userId: actorUserId }
    },
    select: { role: true }
  });

  if (!membership) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied.' });
  }

  if (!canEditDeck(membership.role as Parameters<typeof canEditDeck>[0])) {
    throw createError({ statusCode: 403, statusMessage: 'Editor access required.' });
  }

  let textProviderId = deck.lastUsedTextProviderId;
  let textModelId = deck.lastUsedTextModelId;

  if (!textProviderId || !textModelId) {
    const lastCompletedRun = await prisma.generationRun.findFirst({
      where: {
        deckId,
        status: 'COMPLETED',
        textProviderId: { not: null },
        textModelId: { not: null }
      },
      select: {
        textProviderId: true,
        textModelId: true
      },
      orderBy: { createdAt: 'desc' }
    });

    textProviderId = textProviderId ?? lastCompletedRun?.textProviderId ?? null;
    textModelId = textModelId ?? lastCompletedRun?.textModelId ?? null;
  }

  if (!textProviderId || !textModelId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Apply comments/tweaks requires a previous successful generation with a selected text provider and model.'
    });
  }

  return {
    workspaceId: deck.workspaceId,
    textProviderId,
    textModelId
  };
}

export async function submitGenerationRun(
  actorUserId: string,
  input: SubmitGenerationRunInput,
  redis: IORedis
): Promise<GenerationRunSummary> {
  assertRequiredTextGenerationSelection(input.kind, input.textProviderId, input.textModelId);
  const initialUserMessage = buildInitialUserMessage(input);
  const initialGenerationKey = getHomepageInitialGenerationKey(input.commandContextJson);

  if (initialGenerationKey) {
    const existingRun = await prisma.generationRun.findFirst({
      where: {
        deckId: input.deckId,
        kind: input.kind,
        status: { in: INITIAL_GENERATION_DEDUPE_STATUSES },
        commandContextJson: {
          path: ['initialGenerationKey'],
          equals: initialGenerationKey
        }
      },
      orderBy: { createdAt: 'asc' },
      include: generationRunTimelineInclude
    });

    if (existingRun) return toGenerationRunSummary(existingRun);
  }

  // Enforce max images per deck for image generation kinds
  if (input.kind === 'GENERATE_IMAGE' || input.kind === 'REGENERATE_IMAGE') {
    const existingCount = await prisma.generatedImage.count({
      where: { deckId: input.deckId, status: 'COMPLETED' }
    });
    if (existingCount >= config.maxImagesPerDeck) {
      throw createError({
        statusCode: 422,
        statusMessage: `Max images per deck (${config.maxImagesPerDeck}) reached. Delete existing images before generating more.`
      });
    }
  }

  const run = await prisma.generationRun.create({
    data: {
      deckId: input.deckId,
      workspaceId: input.workspaceId,
      createdByUserId: actorUserId,
      kind: input.kind,
      status: 'PENDING',
      textProviderId: input.textProviderId ?? null,
      textModelId: input.textModelId ?? null,
      imageEnabled: input.imageEnabled ?? false,
      imageProviderId: input.imageProviderId ?? null,
      imageModelId: input.imageModelId ?? null,
      customPromptId: input.customPromptId ?? null,
      designSystemId: input.designSystemId ?? null,
      languageCode: input.languageCode ?? 'en',
      manualInstruction: input.manualInstruction ?? null,
      targetSlideId: input.targetSlideId ?? null,
      targetElementId: input.targetElementId ?? null,
      slideInstruction: input.slideInstruction ?? null,
      commandContextJson: input.commandContextJson != null
        ? input.commandContextJson as Prisma.InputJsonValue
        : Prisma.DbNull,
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
    include: generationRunTimelineInclude
  });

  const queue = new Queue(generationRunQueueName, { connection: redis });
  const idempotencyKey = randomBytes(16).toString('hex');

  await queue.add(
    'generation-run',
    {
      jobId: randomBytes(8).toString('hex'),
      workspaceId: input.workspaceId,
      actorUserId,
      deckId: input.deckId,
      idempotencyKey,
      requestedAt: new Date().toISOString(),
      generationRunId: run.id
    },
    {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      jobId: `gen-run-${run.id}`
    }
  );

  await queue.close();

  return toGenerationRunSummary(run);
}

export async function listGenerationRuns(
  deckId: string,
  limit = 20
): Promise<GenerationRunSummary[]> {
  const runs = await prisma.generationRun.findMany({
    where: { deckId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: generationRunTimelineInclude
  });

  return runs.map(toGenerationRunSummary);
}

export async function getGenerationRun(
  runId: string,
  deckId: string
): Promise<GenerationRunSummary> {
  const run = await prisma.generationRun.findFirst({
    where: { id: runId, deckId },
    include: generationRunTimelineInclude
  });

  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'Generation run not found.' });
  }

  return toGenerationRunSummary(run);
}

export async function resumeGenerationRun(
  runId: string,
  deckId: string,
  actorUserId: string,
  answer: string,
  redis: IORedis
): Promise<GenerationRunSummary> {
  const run = await prisma.generationRun.findFirst({
    where: { id: runId, deckId }
  });

  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'Generation run not found.' });
  }

  if (run.status !== 'WAITING_ASK') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Generation run is not waiting for an answer.'
    });
  }

  // Store the answer and re-queue as PENDING.
  const updated = await prisma.generationRun.update({
    where: { id: runId },
    data: {
      status: 'PENDING',
      pendingAskAnswer: answer,
      // Clear ask state so the worker treats it as a fresh resume.
      askQuestion: null,
      askOptionsJson: Prisma.DbNull,
      messages: {
        create: {
          role: 'USER',
          content: answer
        }
      }
    },
    include: generationRunTimelineInclude
  });

  const queue = new Queue(generationRunQueueName, { connection: redis });
  await queue.add(
    'generation-run',
    {
      jobId: randomBytes(8).toString('hex'),
      workspaceId: run.workspaceId,
      actorUserId,
      deckId,
      idempotencyKey: randomBytes(16).toString('hex'),
      requestedAt: new Date().toISOString(),
      generationRunId: runId
    },
    {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      jobId: `gen-run-resume-${runId}-${Date.now()}`
    }
  );

  await queue.close();

  return toGenerationRunSummary(updated);
}

export async function cancelGenerationRun(
  runId: string,
  deckId: string,
  redis?: IORedis
): Promise<GenerationRunSummary> {
  const run = await prisma.generationRun.findFirst({
    where: { id: runId, deckId },
    include: generationRunTimelineInclude
  });

  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'Generation run not found.' });
  }

  if (run.status === 'CANCELLED') {
    return toGenerationRunSummary(run);
  }

  if (!isCancellableGenerationRunStatus(run.status)) {
    throw createError({
      statusCode: 409,
      statusMessage: `Generation run cannot be cancelled from status ${run.status}.`
    });
  }

  await restoreSubmittedRefinementState(run);

  if (redis && run.status === 'PENDING') {
    const queue = new Queue(generationRunQueueName, { connection: redis });
    try {
      const job = await queue.getJob(`gen-run-${run.id}`);
      await job?.remove().catch(() => undefined);
    } finally {
      await queue.close();
    }
  }

  await prisma.generationToolCall.updateMany({
    where: { runId, status: 'RUNNING' },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      errorMessage: 'Generation cancelled by user.'
    }
  });

  const updated = await prisma.generationRun.update({
    where: { id: runId },
    data: {
      status: 'CANCELLED',
      completedAt: new Date(),
      errorMessage: 'Generation cancelled by user.',
      pendingAskAnswer: null,
      askQuestion: null,
      askOptionsJson: Prisma.DbNull,
      messages: {
        create: {
          role: 'SYSTEM',
          content: 'Generation was cancelled by user request.',
          metadata: { kind: 'generation_cancelled' }
        }
      }
    },
    include: generationRunTimelineInclude
  });

  return toGenerationRunSummary(updated);
}

async function restoreSubmittedRefinementState(run: {
  kind: string;
  deckId: string;
  manualInstruction: string | null;
  commandContextJson: unknown;
}): Promise<void> {
  const commentIds = getSubmittedCommentIds(run);
  if (commentIds.length > 0) {

    await prisma.comment.updateMany({
      where: {
        deckId: run.deckId,
        id: { in: commentIds },
        status: 'SUBMITTED'
      },
      data: { status: 'OPEN' }
    });
    return;
  }

  const batchId = getSubmittedTweakBatchId(run);
  if (batchId) {
    await prisma.tweakBatch.updateMany({
      where: {
        deckId: run.deckId,
        id: batchId,
        status: 'SUBMITTED'
      },
      data: { status: 'PENDING', submittedAt: null }
    });
  }
}

function getSubmittedCommentIds(run: {
  kind: string;
  manualInstruction: string | null;
  commandContextJson: unknown;
}): string[] {
  const context = parseCommandContext(run.commandContextJson);
  if (context?.intent === 'apply_comments' && Array.isArray(context.commentIds)) {
    return context.commentIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  }

  return run.kind === 'APPLY_COMMENTS' ? parseSubmittedCommentIds(run.manualInstruction) : [];
}

function getSubmittedTweakBatchId(run: {
  kind: string;
  manualInstruction: string | null;
  commandContextJson: unknown;
}): string | null {
  const context = parseCommandContext(run.commandContextJson);
  if (context?.intent === 'apply_tweaks' && typeof context.tweakBatchId === 'string' && context.tweakBatchId.trim()) {
    return context.tweakBatchId;
  }

  return run.kind === 'APPLY_TWEAKS' ? parseSubmittedTweakBatchId(run.manualInstruction) : null;
}

function parseCommandContext(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseSubmittedCommentIds(value: string | null): string[] {
  const parsed = parseJsonObject(value);
  const comments = Array.isArray(parsed?.comments) ? parsed.comments : [];
  return comments
    .map((comment) => comment && typeof comment === 'object' ? (comment as { id?: unknown }).id : null)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
}

function parseSubmittedTweakBatchId(value: string | null): string | null {
  const parsed = parseJsonObject(value);
  return typeof parsed?.batchId === 'string' && parsed.batchId.trim() ? parsed.batchId : null;
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function getHomepageInitialGenerationKey(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  return record.source === 'homepage_initial_generation' && typeof record.initialGenerationKey === 'string'
    ? record.initialGenerationKey
    : null;
}

function buildInitialUserMessage(input: SubmitGenerationRunInput): string | null {
  if (input.manualInstruction?.trim()) {
    return input.manualInstruction.trim();
  }

  if (input.kind === 'GENERATE_IMAGE' || input.kind === 'REGENERATE_IMAGE') {
    return 'Generate an image for this deck.';
  }

  return null;
}

import { randomBytes } from 'node:crypto';

import {
  createPepeteXMastra,
  createPepeteXDesignSystemAgentRequestContext,
  createPepeteXDesignSystemMastraMemoryIds,
  type PepeteXDesignSystemAssetImageResult,
  type PepeteXDesignSystemAssetInfo,
  type PepeteXDesignSystemFinishResult,
  type PepeteXDesignSystemMutationResult,
  type PepeteXDesignSystemReferenceFile,
  type PepeteXDesignSystemToolRuntime,
  type PepeteXDesignSystemValidationResult,
  type DesignSystemUpsertBucketInput,
  type DesignSystemUpsertSubCategoryInput,
  type DesignSystemWriteItemInput,
  type DesignSystemDeleteInput,
  type DesignSystemGenerateAssetInput
} from '@pepetex/ai';
import { MASTRA_RESOURCE_ID_KEY, MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { loadConfig } from '@pepetex/config';
import {
  defaultDesignSystemBuckets,
  normalizeDesignSystemDocumentV2,
  repairDesignSystemDocumentV2,
  summarizeDesignSystemDocumentV2,
  type DesignSystemBucket,
  type DesignSystemBucketKind,
  type DesignSystemDocumentV2,
  type DesignSystemSubCategory
} from '@pepetex/design-systems';
import { prisma, Prisma } from '@pepetex/db';
import type { DesignSystemGenerationRun } from '@prisma/client';
import {
  createAgentLanguageModel,
  decryptProviderCredentialPayload,
  getModelInputTokenLimit,
  textProviderKindFromPrisma,
  type TextProviderKind
} from '@pepetex/providers';
import {
  imageGenerateQueueName,
  type DesignSystemGenerationRunJobPayload,
  type ImageGenerateJobPayload
} from '@pepetex/queue';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { getCachedObjectStorageAdapter } from './object-storage';
import { buildAgentStreamMessage, parseImageAttachments, type AgentMediaAttachment } from './agent-attachments';

const config = loadConfig(process.env);
const MAX_DS_REFERENCE_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_DS_REFERENCE_ATTACHMENT_FILE_BYTES = 8 * 1024 * 1024;
const PROMPT_COMPACTION_OUTPUT_TOKEN_RESERVE = 65_536;
const PROMPT_COMPACTION_SAFETY_MARGIN_RATIO = 0.08;
const DEFAULT_BUCKET_IDS = new Set(['colors', 'typography', 'spacing', 'components', 'examples', 'assets']);

function requireEncryptionKey(): string {
  const key = config.providerCredentialEncryptionKey;
  if (!key) throw new Error('PROVIDER_CREDENTIAL_ENCRYPTION_KEY is not set.');
  return key;
}

interface DesignSystemAgentState {
  draft: DesignSystemDocumentV2;
  completed: boolean;
  waitingForAsk: boolean;
  resultVersionId: string | null;
  latestCheckpointId: string | null;
  aiSummary: string | null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runDesignSystemAgentRun(payload: DesignSystemGenerationRunJobPayload): Promise<void> {
  const run = await prisma.designSystemGenerationRun.findUnique({
    where: { id: payload.designSystemGenerationRunId }
  });
  if (!run) {
    console.error('DesignSystemGenerationRun not found.', { runId: payload.designSystemGenerationRunId });
    return;
  }
  if (run.status === 'CANCELLED' || run.status === 'COMPLETED') {
    return;
  }

  try {
    await runAgenticDesignSystemRun(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('DesignSystemGenerationRun failed.', { runId: run.id, error: message });
    await prisma.designSystemGenerationRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        errorMessage: message,
        completedAt: new Date(),
        messages: { create: { role: 'SYSTEM', content: `Generation failed: ${message}`, metadata: { kind: 'generation_failed' } } }
      }
    });
  }
}

async function runAgenticDesignSystemRun(run: DesignSystemGenerationRun): Promise<void> {
  if (!run.textProviderId) throw new Error('No text provider configured for this design system run.');
  if (!run.textModelId) throw new Error('No text model configured for this design system run.');

  const designSystem = await prisma.designSystem.findUniqueOrThrow({
    where: { id: run.designSystemId },
    select: {
      name: true,
      description: true,
      versions: {
        orderBy: { versionNumber: 'desc' },
        take: 1,
        select: { documentJson: true }
      }
    }
  });

  const currentDocument = loadDocumentFromVersion(designSystem.versions[0]?.documentJson);
  const draft: DesignSystemDocumentV2 =
    run.kind === 'DS_FULL_GENERATE'
      ? { version: 2, buckets: defaultDesignSystemBuckets() }
      : currentDocument ?? { version: 2, buckets: defaultDesignSystemBuckets() };
  const shouldBuildCompleteSystem =
    run.kind === 'DS_FULL_GENERATE' || summarizeDesignSystemDocumentV2(draft).itemCount === 0;

  const providerCtx = await resolveProviderContext(run.textProviderId);
  const languageModel = createAgentLanguageModel({
    kind: providerCtx.kind,
    model: run.textModelId,
    ctx: { baseUrl: providerCtx.baseUrl, credential: providerCtx.credential }
  });

  const referenceFiles = await loadReferenceFiles(run.designSystemId);
  const assets = await loadAssets(run.designSystemId);
  seedDraftFromUploads(draft, referenceFiles);

  const state: DesignSystemAgentState = {
    draft,
    completed: false,
    waitingForAsk: false,
    resultVersionId: null,
    latestCheckpointId: null,
    aiSummary: null
  };

  const runtime = createDesignSystemAgentRuntime({ run, state, designSystem: { id: run.designSystemId, name: designSystem.name, description: designSystem.description }, referenceFiles, assets });

  const memoryIds = createPepeteXDesignSystemMastraMemoryIds({ designSystemId: run.designSystemId, runId: run.id });

  const requestContext = createPepeteXDesignSystemAgentRequestContext({
    runId: run.id,
    designSystemId: run.designSystemId,
    workspaceId: run.workspaceId ?? undefined,
    actorUserId: run.createdByUserId,
    generationKind: run.kind,
    languageCode: run.languageCode,
    manualInstruction: run.manualInstruction ?? undefined,
    feedbackContext: run.feedbackContextJson ?? undefined,
    referenceFiles,
    assets,
    provider: {
      kind: providerCtx.kind,
      providerId: run.textProviderId,
      modelId: run.textModelId,
      providerName: undefined,
      ctx: { baseUrl: providerCtx.baseUrl, credential: providerCtx.credential }
    },
    languageModel,
    runtime
  });
  requestContext.set(MASTRA_RESOURCE_ID_KEY, memoryIds.resourceId);
  requestContext.set(MASTRA_THREAD_ID_KEY, memoryIds.threadId);

  const runningUpdate = await prisma.designSystemGenerationRun.updateMany({
    where: { id: run.id, status: { not: 'CANCELLED' } },
    data: {
      status: 'RUNNING',
      startedAt: run.startedAt ?? new Date(),
      mastraResourceId: memoryIds.resourceId,
      mastraThreadId: memoryIds.threadId,
      pendingAskAnswer: null,
      askQuestion: null,
      askOptionsJson: Prisma.DbNull
    }
  });
  if (runningUpdate.count === 0) {
    return; // cancelled
  }

  await prisma.designSystemGenerationToolCall.updateMany({
    where: { runId: run.id, status: 'RUNNING' },
    data: { status: 'FAILED', completedAt: new Date(), errorMessage: 'Superseded by a restarted agent attempt.' }
  });

  const mastra = createPepeteXMastra({
    databaseUrl: config.databaseUrl,
    disableTelemetry: config.disableExternalTelemetry,
    agentMemoryModel: languageModel,
    agentInputTokenLimit: getCompactionBudgetTokens(providerCtx.kind, run.textModelId)
  });
  await mastra.getStorage()?.init();
  const agent = mastra.getAgent('pepeteXDesignSystemStudio');

  const streamOptions = {
    model: languageModel,
    memory: { resource: memoryIds.resourceId, thread: memoryIds.threadId },
    requestContext,
    runId: run.mastraRunId ?? run.id,
    maxSteps: 120,
    savePerStep: true,
    toolCallConcurrency: 1,
    autoResumeSuspendedTools: false
  };

  const isResume = !!run.pendingAskAnswer;
  const resumeToolCallId = isResume && run.mastraRunId ? await getLatestSuspendedToolCallId(run.id) : undefined;
  const promptText = buildDesignSystemPrompt(run, designSystem.name, draft, isResume, referenceFiles, assets, shouldBuildCompleteSystem);
  const designSystemAttachments = isResume ? [] : await loadDesignSystemReferenceAttachments(run.designSystemId);
  const imageAttachments = isResume ? [] : await loadRunImageAttachments(run.id);
  const initialMessage = buildAgentStreamMessage(promptText, [...designSystemAttachments, ...imageAttachments]);
  const stream = isResume && run.mastraRunId
    ? await agent.resumeStream(
        { answer: run.pendingAskAnswer },
        { ...streamOptions, ...(resumeToolCallId ? { toolCallId: resumeToolCallId } : {}) }
      )
    : await agent.stream(initialMessage, streamOptions);

  const streamRecord = stream as unknown as Record<string, unknown>;
  const mastraRunId = typeof streamRecord.runId === 'string' ? streamRecord.runId : run.mastraRunId ?? run.id;
  const agentTraceId = typeof streamRecord.traceId === 'string' ? streamRecord.traceId : undefined;
  await prisma.designSystemGenerationRun.update({
    where: { id: run.id },
    data: { mastraRunId, ...(agentTraceId ? { agentTraceId } : {}) }
  });

  await mirrorStream(run.id, stream, state);

  const refreshed = await prisma.designSystemGenerationRun.findUnique({ where: { id: run.id }, select: { status: true } });
  if (state.waitingForAsk || refreshed?.status === 'WAITING_ASK' || refreshed?.status === 'CANCELLED') {
    return;
  }

  if (!state.completed) {
    // The agent stopped without committing. Surface as failed; the draft is preserved
    // in the latest checkpoint so the user can resume the chat.
    await prisma.designSystemGenerationRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        errorMessage: 'The agent stopped before committing a new version. Send another message to continue.',
        completedAt: new Date()
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Runtime — in-memory draft mutation + DB checkpoints + version commit
// ---------------------------------------------------------------------------

function createDesignSystemAgentRuntime(input: {
  run: DesignSystemGenerationRun;
  state: DesignSystemAgentState;
  designSystem: { id: string; name: string; description: string | null };
  referenceFiles: PepeteXDesignSystemReferenceFile[];
  assets: PepeteXDesignSystemAssetInfo[];
}): PepeteXDesignSystemToolRuntime {
  const { run, state } = input;

  async function checkpoint(summary: string): Promise<string> {
    const cp = await prisma.designSystemGenerationCheckpoint.create({
      data: {
        runId: run.id,
        status: 'DRAFT',
        summary,
        documentJson: state.draft as unknown as Prisma.InputJsonValue
      },
      select: { id: true }
    });
    state.latestCheckpointId = cp.id;
    return cp.id;
  }

  function okMutation(summary: string, checkpointId: string, warnings: string[] = []): PepeteXDesignSystemMutationResult {
    return { ok: true, errors: [], warnings, document: state.draft, summary, checkpointId };
  }
  function rejectMutation(errors: string[]): PepeteXDesignSystemMutationResult {
    return { ok: false, errors, warnings: [], document: state.draft, summary: 'Rejected: ' + errors.join('; ') };
  }

  return {
    getDraftDocument: () => state.draft,
    getDesignSystemMeta: () => input.designSystem,
    listReferenceFiles: () => input.referenceFiles,
    readReferenceFile: async (referenceFileId) => readReferenceFileContent(input.run.designSystemId, referenceFileId),
    listAssets: () => input.assets,

    upsertBucket: async (data: DesignSystemUpsertBucketInput) => {
      const id = (data.id ?? slugify(data.label)).trim();
      if (DEFAULT_BUCKET_IDS.has(id)) {
        const existing = state.draft.buckets.find((b) => b.id === id);
        if (existing) {
          existing.label = data.label;
          if (data.description !== undefined) existing.description = data.description ?? null;
          const cp = await checkpoint(data.summary ?? `Updated bucket ${existing.label}`);
          return okMutation(`Updated bucket "${existing.label}".`, cp);
        }
      }
      const existing = state.draft.buckets.find((b) => b.id === id);
      if (existing) {
        existing.label = data.label;
        existing.kind = data.kind as DesignSystemBucketKind;
        if (data.description !== undefined) existing.description = data.description ?? null;
      } else {
        state.draft.buckets.push({
          id,
          kind: data.kind as DesignSystemBucketKind,
          label: data.label,
          description: data.description ?? null,
          subCategories: []
        });
      }
      const validation = validateDraft(state.draft);
      if (!validation.ok) return rejectMutation(validation.errors);
      const cp = await checkpoint(data.summary ?? `Added bucket ${data.label}`);
      return okMutation(`Saved bucket "${data.label}".`, cp);
    },

    upsertSubCategory: async (data: DesignSystemUpsertSubCategoryInput) => {
      const bucket = state.draft.buckets.find((b) => b.id === data.bucketId);
      if (!bucket) return rejectMutation([`Bucket "${data.bucketId}" not found.`]);
      const id = (data.id ?? slugify(data.label)).trim();
      const existing = bucket.subCategories.find((s) => s.id === id);
      if (existing) {
        existing.label = data.label;
        if (data.description !== undefined) existing.description = data.description ?? null;
      } else {
        bucket.subCategories.push({ id, label: data.label, description: data.description ?? null, items: [] });
      }
      const validation = validateDraft(state.draft);
      if (!validation.ok) return rejectMutation(validation.errors);
      const cp = await checkpoint(data.summary ?? `Saved sub-category ${data.label}`);
      return okMutation(`Saved sub-category "${data.label}" in ${bucket.label}.`, cp);
    },

    writeItem: async (data: DesignSystemWriteItemInput) => {
      const bucket = state.draft.buckets.find((b) => b.id === data.bucketId);
      if (!bucket) return rejectMutation([`Bucket "${data.bucketId}" not found.`]);
      const sub = bucket.subCategories.find((s) => s.id === data.subCategoryId);
      if (!sub) return rejectMutation([`Sub-category "${data.subCategoryId}" not found in bucket "${data.bucketId}".`]);

      // Validate the single item by normalizing a one-item probe document.
      let normalizedItem: Record<string, unknown>;
      try {
        const probe = normalizeDesignSystemDocumentV2(
          { version: 2, buckets: [{ id: bucket.id, kind: bucket.kind, label: bucket.label, description: null, subCategories: [{ id: sub.id, label: sub.label, description: null, items: [data.item] }] }] },
          { enforceQuality: true }
        );
        normalizedItem = probe.buckets[0]!.subCategories[0]!.items[0] as unknown as Record<string, unknown>;
      } catch (error) {
        return rejectMutation([error instanceof Error ? error.message : String(error)]);
      }

      const itemId = String(normalizedItem.id);
      const existingIndex = sub.items.findIndex((it) => it.id === itemId);
      if (existingIndex >= 0) {
        sub.items[existingIndex] = normalizedItem as never;
      } else {
        sub.items.push(normalizedItem as never);
      }
      const validation = validateDraft(state.draft);
      if (!validation.ok) {
        // roll back the insert
        if (existingIndex >= 0) sub.items[existingIndex] = normalizedItem as never;
        else sub.items.pop();
        return rejectMutation(validation.errors);
      }
      const cp = await checkpoint(data.summary ?? `Wrote item ${itemId}`);
      return okMutation(`Saved item "${normalizedItem.label}" in ${bucket.label} / ${sub.label}.`, cp);
    },

    deleteNode: async (data: DesignSystemDeleteInput) => {
      const bucketIndex = state.draft.buckets.findIndex((b) => b.id === data.bucketId);
      if (bucketIndex < 0) return rejectMutation([`Bucket "${data.bucketId}" not found.`]);
      const bucket = state.draft.buckets[bucketIndex]!;

      if (data.itemId && data.subCategoryId) {
        // Single-item delete: low-risk and recoverable from a prior version.
        const sub = bucket.subCategories.find((s) => s.id === data.subCategoryId);
        if (!sub) return rejectMutation([`Sub-category "${data.subCategoryId}" not found.`]);
        sub.items = sub.items.filter((it) => it.id !== data.itemId);
      } else if (data.subCategoryId) {
        const sub = bucket.subCategories.find((s) => s.id === data.subCategoryId);
        if (!sub) return rejectMutation([`Sub-category "${data.subCategoryId}" not found.`]);
        // Deleting a populated sub-category is destructive — require explicit user approval.
        if (sub.items.length > 0 && !(await hasApprovedInRun(run.id))) {
          return rejectMutation([
            `Deleting sub-category "${sub.label}" would remove ${sub.items.length} existing item(s). This is destructive: call request_approval and proceed only after the user approves.`
          ]);
        }
        bucket.subCategories = bucket.subCategories.filter((s) => s.id !== data.subCategoryId);
      } else {
        if (DEFAULT_BUCKET_IDS.has(bucket.id)) {
          return rejectMutation([`Bucket "${bucket.id}" is a default bucket and cannot be deleted; clear its sub-categories instead.`]);
        }
        const itemCount = bucket.subCategories.reduce((n, s) => n + s.items.length, 0);
        if (itemCount > 0 && !(await hasApprovedInRun(run.id))) {
          return rejectMutation([
            `Deleting bucket "${bucket.label}" would remove ${itemCount} existing item(s). This is destructive: call request_approval and proceed only after the user approves.`
          ]);
        }
        state.draft.buckets.splice(bucketIndex, 1);
      }
      const cp = await checkpoint(data.summary ?? 'Deleted node');
      return okMutation('Deleted the requested node.', cp);
    },

    generateAssetImage: async (data: DesignSystemGenerateAssetInput) => enqueueAssetImage(run, state, data, checkpoint),

    validateDocument: async () => validateDraft(state.draft),

    finishGeneration: async ({ summary }) => commitVersion(run, state, summary)
  };
}

function validateDraft(draft: DesignSystemDocumentV2): PepeteXDesignSystemValidationResult {
  try {
    const normalized = normalizeDesignSystemDocumentV2(draft, { enforceQuality: true });
    return { ok: true, errors: [], warnings: [], document: normalized };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)], warnings: [] };
  }
}

async function commitVersion(
  run: DesignSystemGenerationRun,
  state: DesignSystemAgentState,
  summary: string
): Promise<PepeteXDesignSystemFinishResult> {
  const repaired = repairDesignSystemDocumentV2(state.draft);
  if (!repaired) {
    const validation = validateDraft(state.draft);
    return { completed: false, ok: false, errors: validation.errors.length ? validation.errors : ['Document could not be normalized for commit.'], warnings: [], summary };
  }
  state.draft = repaired.document;

  const version = await prisma.$transaction(async (tx) => {
    const ds = await tx.designSystem.findUniqueOrThrow({
      where: { id: run.designSystemId },
      select: { currentVersionNumber: true }
    });
    const nextVersionNumber = ds.currentVersionNumber + 1;
    const updated = await tx.designSystem.update({
      where: { id: run.designSystemId },
      data: {
        currentVersionNumber: nextVersionNumber,
        versions: {
          create: {
            versionNumber: nextVersionNumber,
            label: `Studio version ${nextVersionNumber}`,
            summary,
            documentJson: state.draft as unknown as Prisma.InputJsonValue,
            createdByUserId: run.createdByUserId
          }
        }
      },
      select: { versions: { where: { versionNumber: nextVersionNumber }, select: { id: true, versionNumber: true } } }
    });
    const v = updated.versions[0];
    if (!v) throw new Error('Saved design-system version could not be found.');
    return v;
  });

  state.completed = true;
  state.resultVersionId = version.id;
  state.aiSummary = summary;

  if (state.latestCheckpointId) {
    await prisma.designSystemGenerationCheckpoint.update({
      where: { id: state.latestCheckpointId },
      data: { status: 'COMMITTED', versionId: version.id }
    }).catch(() => undefined);
  }

  await prisma.designSystemGenerationRun.update({
    where: { id: run.id },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      resultVersionId: version.id,
      aiSummary: summary
    }
  });

  return { completed: true, ok: true, errors: [], warnings: [], summary, versionId: version.id, versionNumber: version.versionNumber };
}

// ---------------------------------------------------------------------------
// Asset image generation
// ---------------------------------------------------------------------------

async function enqueueAssetImage(
  run: DesignSystemGenerationRun,
  state: DesignSystemAgentState,
  data: DesignSystemGenerateAssetInput,
  checkpoint: (summary: string) => Promise<string>
): Promise<PepeteXDesignSystemAssetImageResult> {
  if (!run.imageProviderId || !run.imageModelId) {
    return { status: 'failed', message: 'Image generation is not enabled for this run (no image provider/model selected).' };
  }
  const bucket = state.draft.buckets.find((b) => b.id === data.bucketId);
  if (!bucket) return { status: 'failed', message: `Bucket "${data.bucketId}" not found.` };
  const sub = bucket.subCategories.find((s) => s.id === data.subCategoryId);
  if (!sub) return { status: 'failed', message: `Sub-category "${data.subCategoryId}" not found.` };

  const providerDef = await prisma.providerDefinition.findUnique({
    where: { id: run.imageProviderId },
    select: { kind: true }
  });
  if (!providerDef) return { status: 'failed', message: 'Image provider not found.' };

  const generated = await prisma.generatedImage.create({
    data: {
      designSystemId: run.designSystemId,
      designSystemGenerationRunId: run.id,
      prompt: data.prompt,
      model: run.imageModelId,
      providerKind: String(providerDef.kind),
      status: 'PENDING',
      createdByUserId: run.createdByUserId
    },
    select: { id: true }
  });

  const itemId = slugify(`${data.assetKind}-${data.label}-${generated.id.slice(0, 6)}`);
  sub.items.push({
    id: itemId,
    label: data.label,
    assetKind: data.assetKind,
    source: 'generated',
    referenceFileId: null,
    generatedImageId: generated.id,
    prompt: data.prompt,
    mimeType: null,
    width: null,
    height: null,
    description: null
  } as never);
  await checkpoint(`Requested ${data.assetKind} image "${data.label}"`);

  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue<ImageGenerateJobPayload>(imageGenerateQueueName, { connection: redis });
  try {
    await queue.add('image-generate', {
      jobId: randomBytes(8).toString('hex'),
      workspaceId: run.workspaceId ?? '',
      actorUserId: run.createdByUserId,
      idempotencyKey: randomBytes(16).toString('hex'),
      requestedAt: new Date().toISOString(),
      designSystemGenerationRunId: run.id,
      designSystemId: run.designSystemId,
      generatedImageId: generated.id,
      prompt: data.prompt,
      model: run.imageModelId,
      providerKind: String(providerDef.kind),
      count: 1,
      gcsBucket: config.gcsBucket,
      gcsObjectPrefix: `design-systems/${run.designSystemId}/assets`
    });
  } finally {
    await queue.close();
    await redis.quit();
  }

  return { status: 'queued', generatedImageId: generated.id };
}

// ---------------------------------------------------------------------------
// Stream mirror (writes to the DesignSystemGeneration* tables)
// ---------------------------------------------------------------------------

async function mirrorStream(
  runId: string,
  stream: { fullStream: unknown },
  state: DesignSystemAgentState
): Promise<void> {
  const activeToolCalls = new Map<string, string>();
  let assistantText = '';
  let assistantMessageId: string | null = null;
  let lastFlushAt = 0;
  let lastFlushLen = 0;

  function reset(): void {
    assistantText = '';
    assistantMessageId = null;
    lastFlushAt = 0;
    lastFlushLen = 0;
  }

  async function flush(final = false, force = false): Promise<void> {
    const content = final ? assistantText.trim() : assistantText.trimStart();
    if (!content.trim()) return;
    const now = Date.now();
    const shouldFlush = final || force || !assistantMessageId || now - lastFlushAt >= 750 || content.length - lastFlushLen >= 240;
    if (!shouldFlush) return;
    const metadata = { kind: 'agent_stream_text', streaming: !final };
    if (!assistantMessageId) {
      const msg = await prisma.designSystemGenerationMessage.create({
        data: { runId, role: 'ASSISTANT', content, metadata: metadata as unknown as Prisma.InputJsonValue },
        select: { id: true }
      });
      assistantMessageId = msg.id;
    } else {
      await prisma.designSystemGenerationMessage.update({
        where: { id: assistantMessageId },
        data: { content, metadata: metadata as unknown as Prisma.InputJsonValue }
      });
    }
    lastFlushAt = now;
    lastFlushLen = content.length;
  }

  async function closeBubble(): Promise<void> {
    await flush(true, true);
    reset();
  }

  await assertNotCancelled(runId);

  for await (const chunk of stream.fullStream as AsyncIterable<{ type?: string; payload?: unknown }>) {
    await assertNotCancelled(runId);
    const payload = chunk.payload as Record<string, unknown> | undefined;

    if ((chunk.type === 'text-delta' || chunk.type === 'routing-agent-text-delta') && payload && typeof payload.text === 'string') {
      assistantText += payload.text;
      await flush();
      continue;
    }

    if (chunk.type === 'tool-call' && payload) {
      await closeBubble();
      const toolCallId = String(payload.toolCallId ?? '');
      const toolName = String(payload.toolName ?? 'tool');
      const dbId = await startToolCall(runId, toolName, getToolLabel(toolName), payload.args, toolCallId || undefined);
      if (toolCallId) activeToolCalls.set(toolCallId, dbId);
      continue;
    }

    if (chunk.type === 'tool-result' && payload) {
      await closeBubble();
      const toolCallId = String(payload.toolCallId ?? '');
      const toolName = String(payload.toolName ?? 'tool');
      const dbId = activeToolCalls.get(toolCallId) ?? await startToolCall(runId, toolName, getToolLabel(toolName), payload.args, toolCallId || undefined);
      const status = getToolResultStatus(payload.result, payload.isError);
      const errorMessage = payload.isError
        ? String(payload.result ?? 'Tool execution failed.')
        : status === 'FAILED'
          ? getToolResultErrorMessage(payload.result)
          : undefined;
      await finishToolCall(dbId, status, payload.result, errorMessage);
      continue;
    }

    if (chunk.type === 'tool-error' && payload) {
      await closeBubble();
      const toolCallId = String(payload.toolCallId ?? '');
      const toolName = String(payload.toolName ?? 'tool');
      const message = payload.error instanceof Error ? payload.error.message : String(payload.error ?? 'Tool execution failed.');
      const dbId = activeToolCalls.get(toolCallId) ?? await startToolCall(runId, toolName, getToolLabel(toolName), undefined, toolCallId || undefined);
      await finishToolCall(dbId, 'FAILED', undefined, message);
      continue;
    }

    if ((chunk.type === 'tool-call-suspended' || chunk.type === 'agent-execution-suspended') && payload) {
      await closeBubble();
      const toolCallId = String(payload.toolCallId ?? '');
      const toolName = String(payload.toolName ?? 'request_clarification');
      const dbId = activeToolCalls.get(toolCallId) ?? await startToolCall(runId, toolName, getToolLabel(toolName), payload.args, toolCallId || undefined);
      await finishToolCall(dbId, 'COMPLETED', { status: 'waiting_ask', suspendPayload: payload.suspendPayload });
      state.waitingForAsk = true;
      await suspendWithAsk(runId, (payload.suspendPayload ?? payload) as Record<string, unknown>);
      continue;
    }

    if (chunk.type === 'step-finish' && payload) {
      const usage = extractUsageTokens((payload.output as Record<string, unknown> | undefined)?.usage ?? payload.totalUsage);
      await prisma.designSystemGenerationRun.update({
        where: { id: runId },
        data: {
          agentStepCount: { increment: 1 },
          inputTokensUsed: { increment: usage.inputTokens },
          outputTokensUsed: { increment: usage.outputTokens }
        }
      });
      continue;
    }

    if (chunk.type === 'error' && payload) {
      const error = payload.error instanceof Error ? payload.error : new Error(String(payload.error ?? 'Mastra stream error.'));
      throw error;
    }
  }

  await closeBubble();
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

class DesignSystemRunCancelledError extends Error {}

async function assertNotCancelled(runId: string): Promise<void> {
  const run = await prisma.designSystemGenerationRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (run?.status === 'CANCELLED') throw new DesignSystemRunCancelledError('Design system run cancelled.');
}

async function startToolCall(runId: string, name: string, label: string, input?: unknown, mastraToolCallId?: string): Promise<string> {
  if (mastraToolCallId) {
    const existing = await prisma.designSystemGenerationToolCall.findFirst({ where: { runId, mastraToolCallId }, select: { id: true } });
    if (existing) {
      await prisma.designSystemGenerationToolCall.update({
        where: { id: existing.id },
        data: { name, label, status: 'RUNNING', completedAt: null, errorMessage: null, ...(input !== undefined ? { inputJson: input as Prisma.InputJsonValue } : {}) }
      });
      return existing.id;
    }
  }
  const created = await prisma.designSystemGenerationToolCall.create({
    data: { runId, name, label, status: 'RUNNING', ...(mastraToolCallId ? { mastraToolCallId } : {}), ...(input !== undefined ? { inputJson: input as Prisma.InputJsonValue } : {}) },
    select: { id: true }
  });
  return created.id;
}

async function finishToolCall(id: string, status: 'COMPLETED' | 'FAILED', result?: unknown, errorMessage?: string): Promise<void> {
  await prisma.designSystemGenerationToolCall.update({
    where: { id },
    data: { status, completedAt: new Date(), ...(result !== undefined ? { resultJson: result as Prisma.InputJsonValue } : {}), ...(errorMessage ? { errorMessage } : {}) }
  });
}

async function suspendWithAsk(runId: string, suspendPayload: Record<string, unknown>): Promise<void> {
  const question = String(suspendPayload.question ?? suspendPayload.reason ?? 'Clarification needed.');
  await prisma.designSystemGenerationMessage.create({
    data: { runId, role: 'ASSISTANT', content: question, metadata: { kind: 'ask', reason: suspendPayload.reason ?? null } as unknown as Prisma.InputJsonValue }
  });
  await prisma.designSystemGenerationRun.update({
    where: { id: runId },
    data: {
      status: 'WAITING_ASK',
      askQuestion: question,
      askOptionsJson: suspendPayload.options != null ? (suspendPayload.options as Prisma.InputJsonValue) : Prisma.DbNull,
      askAllowManualAnswer: suspendPayload.allowManualAnswer !== false
    }
  });
}

function getToolLabel(toolName: string): string {
  switch (toolName) {
    case 'request_clarification': return 'Asking a clarification';
    case 'request_approval': return 'Requesting approval';
    case 'read_design_system_state': return 'Reading design system state';
    case 'list_reference_files': return 'Listing reference files';
    case 'read_reference_file': return 'Reading a reference file';
    case 'list_assets': return 'Listing assets';
    case 'upsert_bucket': return 'Saving a bucket';
    case 'upsert_subcategory': return 'Saving a sub-category';
    case 'write_item': return 'Writing an item';
    case 'generate_asset_image': return 'Generating a brand image';
    case 'delete_node': return 'Deleting a node';
    case 'validate_design_system': return 'Validating the design system';
    case 'finish_generation': return 'Committing a new version';
    case 'updateWorkingMemory': return 'Updating agent memory';
    default: return toolName.replace(/_/g, ' ');
  }
}

function getToolResultStatus(result: unknown, isError: unknown): 'COMPLETED' | 'FAILED' {
  if (isError) return 'FAILED';
  if (!result || typeof result !== 'object') return 'COMPLETED';
  const record = result as Record<string, unknown>;
  if (record.ok === false || record.completed === false) return 'FAILED';
  return 'COMPLETED';
}

function getToolResultErrorMessage(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const record = result as Record<string, unknown>;
  if (Array.isArray(record.errors) && record.errors.length > 0) return record.errors.map((e) => String(e)).join('; ');
  if (typeof record.error === 'string') return record.error;
  if (typeof record.message === 'string') return record.message;
  return undefined;
}

function extractUsageTokens(usage: unknown): { inputTokens: number; outputTokens: number } {
  if (!usage || typeof usage !== 'object') return { inputTokens: 0, outputTokens: 0 };
  const record = usage as Record<string, unknown>;
  const inputTokens = Number(record.inputTokens ?? record.promptTokens ?? 0);
  const outputTokens = Number(record.outputTokens ?? record.completionTokens ?? 0);
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0
  };
}

/**
 * Code-enforced safety gate: true only if the user explicitly approved a destructive
 * action earlier in this run (a completed request_approval tool call with approved=true).
 * This does not rely on the model obeying instructions — destructive deletes are blocked
 * at the runtime layer until a real approval is recorded.
 */
async function hasApprovedInRun(runId: string): Promise<boolean> {
  const toolCall = await prisma.designSystemGenerationToolCall.findFirst({
    where: { runId, name: 'request_approval', status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    select: { resultJson: true }
  });
  const result = toolCall?.resultJson as { approved?: boolean } | null;
  return result?.approved === true;
}

async function getLatestSuspendedToolCallId(runId: string): Promise<string | undefined> {
  const toolCall = await prisma.designSystemGenerationToolCall.findFirst({
    where: { runId, name: { in: ['request_clarification', 'request_approval'] }, mastraToolCallId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { mastraToolCallId: true }
  });
  return toolCall?.mastraToolCallId ?? undefined;
}

/** Ephemeral image attachments stored on the run's most recent USER message (vision). */
async function loadRunImageAttachments(runId: string) {
  const message = await prisma.designSystemGenerationMessage.findFirst({
    where: { runId, role: 'USER' },
    orderBy: { createdAt: 'desc' },
    select: { metadata: true }
  });
  return parseImageAttachments(message?.metadata);
}

// ---------------------------------------------------------------------------
// Loaders + small utilities
// ---------------------------------------------------------------------------

function loadDocumentFromVersion(documentJson: unknown): DesignSystemDocumentV2 | null {
  if (!documentJson) return null;
  try {
    return normalizeDesignSystemDocumentV2(documentJson, { enforceQuality: false });
  } catch {
    return null;
  }
}

async function loadReferenceFiles(designSystemId: string): Promise<PepeteXDesignSystemReferenceFile[]> {
  const files = await prisma.designSystemReferenceFile.findMany({
    where: { designSystemId },
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: {
      id: true, purpose: true, assetRole: true, role: true, originalFilename: true, mimeType: true, sizeBytes: true,
      pageCount: true,
      imageWidth: true, imageHeight: true
    }
  });
  return files.map((file) => ({
    id: file.id,
    purpose: file.purpose,
    assetRole: file.assetRole,
    role: file.role,
    originalFilename: file.originalFilename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    pageCount: file.pageCount,
    imageWidth: file.imageWidth,
    imageHeight: file.imageHeight,
    usageHint: buildDesignSystemStudioReferenceUsageHint({
      purpose: file.purpose,
      assetRole: file.assetRole,
      role: file.role,
      mimeType: file.mimeType
    })
  }));
}

async function loadDesignSystemReferenceAttachments(designSystemId: string): Promise<AgentMediaAttachment[]> {
  const files = await prisma.designSystemReferenceFile.findMany({
    where: {
      designSystemId,
      OR: [
        { mimeType: { startsWith: 'image/' } },
        { mimeType: 'application/pdf' }
      ]
    },
    orderBy: { createdAt: 'asc' },
    take: 12,
    select: {
      id: true,
      purpose: true,
      assetRole: true,
      role: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      storageBucket: true,
      storageObjectPath: true
    }
  });

  let attachedBytes = 0;
  const attachments: AgentMediaAttachment[] = [];

  for (const file of files) {
    if (!isNativeDesignSystemReferenceAttachment(file)) continue;
    if (file.sizeBytes > MAX_DS_REFERENCE_ATTACHMENT_FILE_BYTES) continue;
    if (attachedBytes + file.sizeBytes > MAX_DS_REFERENCE_ATTACHMENT_BYTES) break;

    try {
      const object = await getCachedObjectStorageAdapter(file.storageBucket).getObject({
        objectPath: file.storageObjectPath
      });
      attachedBytes += object.body.byteLength;
      attachments.push({
        kind: file.mimeType.startsWith('image/') ? 'image' : 'file',
        filename: file.originalFilename,
        mimeType: file.mimeType,
        dataBase64: Buffer.from(object.body).toString('base64')
      });
    } catch (error) {
      console.warn('Design-system reference could not be attached to agent input.', {
        designSystemId,
        fileId: file.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return attachments;
}

function isNativeDesignSystemReferenceAttachment(file: {
  purpose: string;
  assetRole: string | null;
  role: string;
  mimeType: string;
}): boolean {
  if (file.mimeType === 'application/pdf') return file.purpose === 'REFERENCE';
  if (!file.mimeType.startsWith('image/')) return false;
  if (file.purpose === 'REFERENCE') return true;
  return file.purpose === 'ASSET' && (file.assetRole === 'LOGO' || file.assetRole === 'IMAGE' || file.role === 'logo' || file.role === 'brand-image');
}

function buildDesignSystemStudioReferenceUsageHint(file: {
  purpose: string;
  assetRole: string | null;
  role: string;
  mimeType: string;
}): string {
  if (file.assetRole === 'FONT' || file.role === 'font') {
    return 'Uploaded font asset. Create typography items that set fontAssetId to this file id and use a matching fontFamily; PepeteX injects the font face.';
  }
  if (file.purpose === 'ASSET' && (file.assetRole === 'LOGO' || file.role === 'logo')) {
    return 'Uploaded logo asset. Add it to the Assets bucket with source "reference" and referenceFileId, and use it in brand-critical example slides when appropriate.';
  }
  if (file.purpose === 'ASSET' && (file.assetRole === 'IMAGE' || file.role === 'brand-image')) {
    return 'Uploaded brand image asset. Add it to the Assets bucket with source "reference" and referenceFileId, and use it as a reusable brand visual when appropriate.';
  }
  if (file.mimeType.startsWith('image/')) {
    return 'Reference image attached directly to the model for visual brand analysis. Use it for colors, layout, motif, and asset guidance.';
  }
  if (file.mimeType === 'application/pdf') {
    return 'Reference PDF attached directly to the model for native document understanding. Use it for deck style, layout patterns, typography, imagery, and hierarchy.';
  }
  return 'Reference document for brand context.';
}

async function loadAssets(designSystemId: string): Promise<PepeteXDesignSystemAssetInfo[]> {
  const [refs, generated] = await Promise.all([
    prisma.designSystemReferenceFile.findMany({
      where: { designSystemId, purpose: 'ASSET' },
      select: { id: true, mimeType: true, imageWidth: true, imageHeight: true, assetRole: true }
    }),
    prisma.generatedImage.findMany({
      where: { designSystemId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, status: true, mimeType: true, width: true, height: true }
    })
  ]);
  return [
    ...refs.map((r): PepeteXDesignSystemAssetInfo => ({
      id: r.id, source: 'reference', assetKind: r.assetRole ?? null, mimeType: r.mimeType,
      width: r.imageWidth, height: r.imageHeight, available: true
    })),
    ...generated.map((g): PepeteXDesignSystemAssetInfo => ({
      id: g.id, source: 'generated', status: g.status, mimeType: g.mimeType,
      width: g.width, height: g.height, available: g.status === 'COMPLETED'
    }))
  ];
}

function seedDraftFromUploads(
  draft: DesignSystemDocumentV2,
  referenceFiles: PepeteXDesignSystemReferenceFile[]
): void {
  const fontFiles = referenceFiles.filter((file) => file.purpose === 'ASSET' && (file.assetRole === 'FONT' || file.role === 'font'));
  const logoFiles = referenceFiles.filter((file) => file.purpose === 'ASSET' && (file.assetRole === 'LOGO' || file.role === 'logo'));
  const imageFiles = referenceFiles.filter((file) => file.purpose === 'ASSET' && (file.assetRole === 'IMAGE' || file.role === 'brand-image'));

  if (fontFiles.length > 0) {
    const typography = ensureSubCategory(draft, 'typography', 'uploaded-fonts', 'Uploaded Fonts', 'Typography created from uploaded design-system font assets.');
    for (const file of fontFiles) {
      if (typography.items.some((item) => (item as { fontAssetId?: unknown }).fontAssetId === file.id)) continue;
      const family = inferFontFamilyFromFilename(file.originalFilename);
      const weight = inferFontWeightFromFilename(file.originalFilename);
      typography.items.push({
        id: uniqueItemId(typography.items, `font-${slugify(family)}`),
        label: readableLabelFromFilename(file.originalFilename),
        fontFamily: family,
        fontSizePx: defaultFontSizeForWeight(weight),
        fontWeight: weight,
        lineHeight: weight >= 700 ? 1.05 : 1.25,
        fontAssetId: file.id
      } as never);
    }
  }

  if (logoFiles.length > 0) {
    const logos = ensureSubCategory(draft, 'assets', 'uploaded-logos', 'Uploaded Logos', 'Logo files uploaded as reusable design-system assets.');
    for (const file of logoFiles) {
      if (logos.items.some((item) => (item as { referenceFileId?: unknown }).referenceFileId === file.id)) continue;
      logos.items.push({
        id: uniqueItemId(logos.items, `asset-${slugify(file.originalFilename)}`),
        label: readableLabelFromFilename(file.originalFilename),
        assetKind: 'logo',
        source: 'reference',
        referenceFileId: file.id,
        generatedImageId: null,
        prompt: null,
        mimeType: file.mimeType,
        width: file.imageWidth ?? null,
        height: file.imageHeight ?? null,
        description: 'Uploaded logo asset. Prefer on title, divider, and closing slide examples when brand identity is useful.'
      } as never);
    }
  }

  if (imageFiles.length > 0) {
    const images = ensureSubCategory(draft, 'assets', 'uploaded-brand-images', 'Uploaded Brand Images', 'Brand images uploaded as reusable design-system assets.');
    for (const file of imageFiles) {
      if (images.items.some((item) => (item as { referenceFileId?: unknown }).referenceFileId === file.id)) continue;
      images.items.push({
        id: uniqueItemId(images.items, `asset-${slugify(file.originalFilename)}`),
        label: readableLabelFromFilename(file.originalFilename),
        assetKind: 'image',
        source: 'reference',
        referenceFileId: file.id,
        generatedImageId: null,
        prompt: null,
        mimeType: file.mimeType,
        width: file.imageWidth ?? null,
        height: file.imageHeight ?? null,
        description: 'Uploaded brand image asset. Use as a recurring visual motif or supporting illustration when it fits the slide.'
      } as never);
    }
  }
}

function ensureSubCategory(
  draft: DesignSystemDocumentV2,
  bucketId: string,
  subCategoryId: string,
  label: string,
  description: string
): DesignSystemSubCategory {
  let bucket = draft.buckets.find((candidate) => candidate.id === bucketId);
  if (!bucket) {
    const spec = defaultDesignSystemBuckets().find((candidate) => candidate.id === bucketId);
    bucket = spec ?? { id: bucketId, kind: 'custom', label, description: null, subCategories: [] };
    draft.buckets.push(bucket);
  }

  let subCategory = bucket.subCategories.find((candidate) => candidate.id === subCategoryId);
  if (!subCategory) {
    subCategory = { id: subCategoryId, label, description, items: [] };
    bucket.subCategories.push(subCategory);
  }
  return subCategory;
}

function uniqueItemId(items: Array<{ id: string }>, preferredId: string): string {
  const base = preferredId.slice(0, 72) || `item-${randomBytes(3).toString('hex')}`;
  let candidate = base;
  let index = 2;
  while (items.some((item) => item.id === candidate)) {
    candidate = `${base.slice(0, 68)}-${index}`;
    index += 1;
  }
  return candidate;
}

function readableLabelFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || filename;
}

function inferFontFamilyFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80) || 'UploadedBrandFont';
}

function inferFontWeightFromFilename(filename: string): number {
  const normalized = filename.toLowerCase();
  if (normalized.includes('black') || normalized.includes('heavy')) return 900;
  if (normalized.includes('extra') && normalized.includes('bold')) return 800;
  if (normalized.includes('semi') && normalized.includes('bold')) return 600;
  if (normalized.includes('bold')) return 700;
  if (normalized.includes('medium')) return 500;
  if (normalized.includes('light')) return 300;
  if (normalized.includes('thin')) return 200;
  return 400;
}

function defaultFontSizeForWeight(fontWeight: number): number {
  if (fontWeight >= 700) return 56;
  if (fontWeight >= 500) return 40;
  return 24;
}

async function readReferenceFileContent(designSystemId: string, referenceFileId: string): Promise<{ status: 'ok' | 'not_found'; file?: PepeteXDesignSystemReferenceFile; contentBase64?: string; textExcerpt?: string }> {
  const file = await prisma.designSystemReferenceFile.findFirst({
    where: { id: referenceFileId, designSystemId },
    select: { id: true, purpose: true, assetRole: true, role: true, originalFilename: true, mimeType: true, sizeBytes: true, pageCount: true, imageWidth: true, imageHeight: true, storageBucket: true, storageObjectPath: true }
  });
  if (!file) return { status: 'not_found' };
  const info: PepeteXDesignSystemReferenceFile = {
    id: file.id, purpose: file.purpose, assetRole: file.assetRole, role: file.role, originalFilename: file.originalFilename, mimeType: file.mimeType,
    sizeBytes: file.sizeBytes, pageCount: file.pageCount, imageWidth: file.imageWidth, imageHeight: file.imageHeight
  };
  const inlineable = (file.mimeType.startsWith('image/') || file.mimeType.startsWith('text/')) && file.sizeBytes <= MAX_DS_REFERENCE_ATTACHMENT_BYTES;
  if (!inlineable) return { status: 'ok', file: info };
  try {
    const storage = getCachedObjectStorageAdapter(file.storageBucket);
    const object = await storage.getObject({ objectPath: file.storageObjectPath });
    if (file.mimeType.startsWith('text/')) {
      return { status: 'ok', file: info, textExcerpt: new TextDecoder().decode(object.body).slice(0, 4000) };
    }
    return { status: 'ok', file: info, contentBase64: Buffer.from(object.body).toString('base64') };
  } catch {
    return { status: 'ok', file: info };
  }
}

async function resolveProviderContext(providerId: string): Promise<{
  kind: TextProviderKind;
  baseUrl: string | null;
  credential: { apiKey: string; organizationId?: string; projectId?: string; customHeaders?: Record<string, string> };
}> {
  const definition = await prisma.providerDefinition.findUniqueOrThrow({
    where: { id: providerId },
    select: { kind: true, baseUrl: true, credentials: { where: { scope: 'SYSTEM' }, orderBy: { createdAt: 'desc' }, take: 1, select: { encryptedPayload: true } } }
  });
  const encrypted = definition.credentials[0];
  if (!encrypted) throw new Error(`No system credential found for provider ${providerId}.`);
  const payload = decryptProviderCredentialPayload(encrypted.encryptedPayload, requireEncryptionKey());
  return {
    kind: textProviderKindFromPrisma(definition.kind),
    baseUrl: definition.baseUrl,
    credential: {
      apiKey: payload.apiKey,
      ...(payload.organizationId ? { organizationId: payload.organizationId } : {}),
      ...(payload.projectId ? { projectId: payload.projectId } : {}),
      ...(payload.customHeaders ? { customHeaders: payload.customHeaders } : {})
    }
  };
}

function getCompactionBudgetTokens(kind: TextProviderKind, model: string): number {
  const modelLimit = getModelInputTokenLimit(kind, model);
  return Math.max(4_096, modelLimit - PROMPT_COMPACTION_OUTPUT_TOKEN_RESERVE - Math.ceil(modelLimit * PROMPT_COMPACTION_SAFETY_MARGIN_RATIO));
}

function buildDesignSystemPrompt(
  run: DesignSystemGenerationRun,
  name: string,
  draft: DesignSystemDocumentV2,
  isResume: boolean,
  referenceFiles: PepeteXDesignSystemReferenceFile[],
  assets: PepeteXDesignSystemAssetInfo[],
  shouldBuildCompleteSystem: boolean
): string {
  const counts = summarizeDesignSystemDocumentV2(draft);
  const scope = shouldBuildCompleteSystem
    ? `The design system "${name}" is currently empty. Infer scope from the user request: a build/generate request means create a complete, coherent system across the default buckets.`
    : 'Infer scope from the user request: targeted asks change only what was requested; an explicit "rebuild" / "from scratch" request rebuilds the system (use request_approval first).';
  const feedback = run.feedbackContextJson
    ? `\nScoped feedback target: ${JSON.stringify(run.feedbackContextJson)}. Focus edits on this scope.`
    : '';
  const instruction = run.manualInstruction?.trim() || `Create a design system named "${name}".`;
  const resumeNote = isResume ? '\nThe user has answered your clarification; continue immediately.' : '';
  const uploadContext = formatUploadContextForPrompt(referenceFiles, assets);
  return [
    scope,
    `Current draft summary: ${counts.bucketCount} buckets, ${counts.subCategoryCount} sub-categories, ${counts.itemCount} items.`,
    uploadContext,
    feedback,
    resumeNote,
    `\nUser request:\n${instruction}`
  ].join('\n');
}

function formatUploadContextForPrompt(
  referenceFiles: PepeteXDesignSystemReferenceFile[],
  assets: PepeteXDesignSystemAssetInfo[]
): string {
  if (referenceFiles.length === 0 && assets.length === 0) return '';

  const lines = [
    '\nUploaded design-system context:',
    '- Uploaded reference images and PDFs are attached to this Mastra agent turn as native multimodal message parts when they fit the attachment budget. Inspect them directly for visual style, deck structure, typography, colors, layout density, and brand motifs.',
    '- Uploaded logo/image assets must become items in the Assets bucket with source "reference" and their referenceFileId. Use logo assets in example-slide HTML/CSS when brand identity is appropriate.',
    '- Uploaded font assets must become Typography items with fontAssetId set to the uploaded file id. If any font assets exist, do not default to Plus Jakarta Sans or system fonts for the primary typography tokens.'
  ];

  for (const file of referenceFiles) {
    const details = [
      `id=${file.id}`,
      `purpose=${file.purpose ?? 'unknown'}`,
      `role=${file.role ?? 'unknown'}`,
      `assetRole=${file.assetRole ?? 'none'}`,
      `filename=${file.originalFilename}`,
      `mimeType=${file.mimeType}`
    ];
    if (typeof file.pageCount === 'number') details.push(`pageCount=${file.pageCount}`);
    if (typeof file.imageWidth === 'number' && typeof file.imageHeight === 'number') details.push(`dimensions=${file.imageWidth}x${file.imageHeight}`);
    lines.push(`- ${details.join(', ')}`);
  }

  const generatedAssets = assets.filter((asset) => asset.source === 'generated');
  if (generatedAssets.length > 0) {
    lines.push(`- Generated design-system images available: ${generatedAssets.map((asset) => `${asset.id} (${asset.status ?? 'unknown'})`).join(', ')}`);
  }

  return lines.join('\n');
}

function slugify(value: string): string {
  const base = value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return base || `id-${randomBytes(4).toString('hex')}`;
}

// silence unused-type imports retained for documentation of the draft shape
export type { DesignSystemBucket, DesignSystemSubCategory };

import { loadConfig } from '@pepetex/config';
import { MASTRA_RESOURCE_ID_KEY, MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import {
  DeckRevisionSource,
  Prisma,
  prisma,
  type GenerationRun
} from '@pepetex/db';
import {
  createPepeteXAgentRequestContext,
  createPepeteXMastra,
  createPepeteXMastraMemoryIds,
  createPromptLayerCompactionStrategy,
  estimatePromptInputTokensHeuristic,
  generateDeckTitle,
  inspectDeckQuality,
  runCompaction,
  summarizeForContinuity,
  validateAndRepairDeckGenerationResult,
  validateGeneratedDeck,
  assertDeckPatchCoversSubmittedComments,
  collectDeckPatchCoveredCommentIds,
  buildStructuredGenerationAttachments,
  type PepeteXAgentToolRuntime,
  type PepeteXAgentValidationResult,
  type GeneratedDeck,
  type GeneratedDeckFont,
  type GeneratedSlide,
  type DeckGenerationResult,
  type DeckPatch,
  type DeckPatchResult,
  type CompactionEvent
} from '@pepetex/ai';
import {
  normalizeDesignSystemDocumentV2,
  projectV2ToLegacyDocument,
  validateDesignSystemCompliance,
  type DesignSystemDocument,
  type DesignSystemDocumentV2
} from '@pepetex/design-systems';
import {
  allowedElementTypes,
  replaceSlideElementHtml,
  updateSlideElementAttributes,
  updateSlideElementStyle,
  updateSlideTextElement,
  validateGeneratedDeckContract
} from '@pepetex/html-contract';
import { renderDeckVisuals } from './render-slide-visuals.js';
import {
  assemblePrompt,
  formatDesignSystemV2Instruction,
  getPepeteXAgentToolContract,
  getPepeteXAppBehaviorContract,
  getPepeteXPatchOperationContract,
  getPepeteXRunModeContract,
  type PromptAssemblyInput,
  type ReferenceFilePromptInput
} from '@pepetex/prompts';
import {
  createAgentLanguageModel,
  createTextProviderAdapter,
  decryptProviderCredentialPayload,
  getModelInputTokenLimit,
  inferCLIProxyRouteKind,
  textProviderKindFromPrisma,
  type ProviderCredentialPayload,
  type TextProviderKind,
  type TokenCountResult
} from '@pepetex/providers';
import {
  generationRunPhaseQueueName,
  type GenerationRunJobPayload,
  type GenerationRunPhase,
  type GenerationRunPhaseJobPayload
} from '@pepetex/queue';
import { getCachedObjectStorageAdapter } from './object-storage';
import { buildAgentStreamMessage, parseImageAttachments, type AgentImageAttachment } from './agent-attachments';

// Caps the per-run agent repair loop. Each rejected draft re-sends the full growing context
// (design-system instruction + conversation), so an agent stuck repeating the same invalid fix
// burns tokens fast. 5 still allows a couple of genuine multi-error corrections.
const MAX_REJECTED_DRAFT_MUTATIONS = 5;
// After this many consecutive identical validation failures, the tool result escalates with the
// allowed element-type list and a directive to change approach, so the model breaks out of a loop.
const REPEATED_DRAFT_ERROR_ESCALATION_THRESHOLD = 2;

const MAX_REFERENCE_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_REFERENCE_ATTACHMENT_FILE_BYTES = 12 * 1024 * 1024;
const MAX_INLINE_RENDERABLE_ASSET_BYTES = 2 * 1024 * 1024;
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const PROMPT_COMPACTION_OUTPUT_TOKEN_RESERVE = 65_536;
const PROMPT_COMPACTION_SAFETY_MARGIN_RATIO = 0.08;

type ReferenceAttachmentMode = 'inline' | 'provider-file';

interface ReferenceAttachmentSupport {
  supported: boolean;
  mode?: ReferenceAttachmentMode;
  reason?: string;
}

interface ReferencePromptProviderContext {
  providerId: string;
  kind: TextProviderKind;
  baseUrl: string | null;
  credential: ProviderCredentialPayload;
}

type DesignSystemReferenceRole = 'logo' | 'brand-image' | 'font' | 'pdf' | 'other';

interface PromptInputBuildResult {
  promptInput: Record<string, unknown>;
  assetUrls: Record<string, string>;
  assets: Array<{
    id: string;
    role: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    imageWidth: number | null;
    imageHeight: number | null;
  }>;
}

interface DesignSystemContextResult {
  instruction: string;
  assetUrls: Record<string, string>;
  assets: Array<{
    id: string;
    role: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    imageWidth: number | null;
    imageHeight: number | null;
    directUseAvailable: boolean;
  }>;
}

interface RenderableAssetRecord {
  id: string;
  mimeType: string;
  sizeBytes: number;
  storageBucket: string;
  storageObjectPath: string;
}

const config = loadConfig(process.env);

function requireEncryptionKey(): string {
  const key = config.providerCredentialEncryptionKey;
  if (!key) throw new Error('PROVIDER_CREDENTIAL_ENCRYPTION_KEY is not set.');
  return key;
}

function asJsonInput(value: GeneratedDeck): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function asUnknownJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function recordGenerationMessage(
  runId: string,
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'VERIFIER',
  content: string,
  metadata?: unknown
): Promise<void> {
  await prisma.generationMessage.create({
    data: {
      runId,
      role,
      content,
      ...(metadata !== undefined ? { metadata: asUnknownJsonInput(metadata) } : {})
    }
  });
}

async function createGenerationMessage(
  runId: string,
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'VERIFIER',
  content: string,
  metadata?: unknown
): Promise<string> {
  const message = await prisma.generationMessage.create({
    data: {
      runId,
      role,
      content,
      ...(metadata !== undefined ? { metadata: asUnknownJsonInput(metadata) } : {})
    },
    select: { id: true }
  });

  return message.id;
}

function toPromptAssemblyInput(raw: Record<string, unknown>): PromptAssemblyInput {
  const result: PromptAssemblyInput = {};
  if (typeof raw.workspaceInstruction === 'string') result.workspaceInstruction = raw.workspaceInstruction;
  if (typeof raw.designSystemInstruction === 'string') result.designSystemInstruction = raw.designSystemInstruction;
  if (typeof raw.customPromptInstruction === 'string') result.customPromptInstruction = raw.customPromptInstruction;
  if (typeof raw.manualInstruction === 'string') result.manualInstruction = raw.manualInstruction;
  if (Array.isArray(raw.referenceFiles)) result.referenceFiles = raw.referenceFiles as ReferenceFilePromptInput[];
  if (typeof raw.deckState === 'string') result.deckState = raw.deckState;
  if (typeof raw.commentsAndTweaks === 'string') result.commentsAndTweaks = raw.commentsAndTweaks;
  return result;
}

function getPromptCompactionBudgetTokens(provider: { kind: TextProviderKind; model: string }): number {
  const modelLimit = getModelInputTokenLimit(provider.kind, provider.model);
  return Math.max(
    4_096,
    modelLimit - PROMPT_COMPACTION_OUTPUT_TOKEN_RESERVE - Math.ceil(modelLimit * PROMPT_COMPACTION_SAFETY_MARGIN_RATIO)
  );
}

async function compactPromptInputForRun(
  run: GenerationRun,
  promptInput: Record<string, unknown>,
  provider: {
    kind: TextProviderKind;
    baseUrl: string | null;
    credential: ProviderCredentialPayload;
    model: string;
  }
): Promise<Record<string, unknown>> {
  const compactablePromptInput = toPromptAssemblyInput(promptInput);
  const budgetTokens = getPromptCompactionBudgetTokens(provider);
  const workflowProvider = {
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    credential: provider.credential,
    model: provider.model
  };

  const countTokens = (input: PromptAssemblyInput) => countPromptInputTokens(input, provider);
  const result = await runCompaction({
    context: compactablePromptInput,
    budgetTokens,
    countTokens,
    strategy: createPromptLayerCompactionStrategy({
      targetSlideIds: getPromptCompactionTargetSlideIds(run)
    }),
    summarize: ({ text, instructions, targetCharacters }) =>
      summarizeForContinuity(workflowProvider, text, instructions, targetCharacters)
  });

  if (result.events.length > 0) {
    const message = buildPromptCompactionMessage(result.events, result.finalTokens, budgetTokens, result.withinBudget);
    await recordGenerationMessage(run.id, 'SYSTEM', message, {
      kind: 'prompt_context_compacted',
      initialTokens: result.initialTokens,
      finalTokens: result.finalTokens,
      budgetTokens,
      events: result.events
    });
    await createPromptCompactionNotification(run, message, result.events, result.finalTokens, budgetTokens);
  }

  if (!result.withinBudget) {
    const message = `Context still exceeds the model token budget after auto-compaction (${result.finalTokens.toLocaleString()} estimated tokens, budget ${budgetTokens.toLocaleString()}). Consider removing reference files or splitting the work into a smaller deck.`;
    await recordGenerationMessage(run.id, 'SYSTEM', message, {
      kind: 'prompt_context_still_over_budget',
      initialTokens: result.initialTokens,
      finalTokens: result.finalTokens,
      budgetTokens
    });
    await createPromptCompactionNotification(run, message, result.events, result.finalTokens, budgetTokens);
  }

  return {
    ...promptInput,
    ...result.context
  };
}

async function countPromptInputTokens(
  promptInput: PromptAssemblyInput,
  provider: {
    kind: TextProviderKind;
    baseUrl: string | null;
    credential: ProviderCredentialPayload;
    model: string;
  }
): Promise<number> {
  const adapter = createTextProviderAdapter(provider.kind);
  const assembled = assemblePrompt(promptInput);
  let countResult: TokenCountResult | null = null;

  if (adapter.countTokens) {
    try {
      countResult = await adapter.countTokens(
        {
          model: provider.model,
          prompt: assembled.userPrompt,
          systemInstruction: assembled.systemInstruction,
          attachments: buildStructuredGenerationAttachments(promptInput.referenceFiles ?? [])
        },
        {
          baseUrl: provider.baseUrl,
          credential: provider.credential
        }
      );
    } catch (error) {
      console.warn('Provider token counting failed; using heuristic prompt token estimate.', {
        providerKind: provider.kind,
        model: provider.model,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (countResult?.supported && typeof countResult.totalTokens === 'number') {
    return countResult.totalTokens;
  }

  return estimatePromptInputTokensHeuristic(promptInput);
}

function getPromptCompactionTargetSlideIds(run: GenerationRun): string[] {
  const slideIds = new Set<string>();
  if (run.targetSlideId) slideIds.add(run.targetSlideId);

  try {
    if (run.kind === 'APPLY_COMMENTS') {
      for (const comment of parseCommentsPayload(run.manualInstruction).comments) {
        if (comment.slideId) slideIds.add(comment.slideId);
      }
    }
    if (run.kind === 'APPLY_TWEAKS') {
      for (const tweak of parseTweaksPayload(run.manualInstruction).tweaks) {
        if (tweak.slideId) slideIds.add(tweak.slideId);
      }
    }
  } catch {
    // Target extraction is best-effort; compaction still preserves the explicit targetSlideId.
  }

  return [...slideIds];
}

function buildPromptCompactionMessage(
  events: CompactionEvent[],
  finalTokens: number,
  budgetTokens: number,
  withinBudget: boolean
): string {
  const details = events.map((event) => event.detail);
  const uniqueDetails = [...new Set(details)];
  const suffix = withinBudget
    ? ` Final context estimate is ${finalTokens.toLocaleString()} tokens within the ${budgetTokens.toLocaleString()} token budget.`
    : ` Final context estimate is ${finalTokens.toLocaleString()} tokens, still above the ${budgetTokens.toLocaleString()} token budget.`;

  return `Context auto-compacted to fit the model token limit: ${uniqueDetails.join('; ')}.${suffix}`;
}

async function createPromptCompactionNotification(
  run: GenerationRun,
  body: string,
  events: CompactionEvent[],
  finalTokens: number,
  budgetTokens: number
): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: run.createdByUserId,
      kind: 'GENERATION_CONTEXT_COMPACTED',
      title: 'Generation context auto-compacted',
      body,
      actionUrl: `/decks/${run.deckId}`,
      metadata: asUnknownJsonInput({
        generationRunId: run.id,
        deckId: run.deckId,
        events,
        finalTokens,
        budgetTokens
      })
    }
  }).catch((error) => {
    console.error('Failed to create prompt compaction notification.', {
      generationRunId: run.id,
      error: error instanceof Error ? error.message : String(error)
    });
  });
}

async function startGenerationToolCall(
  runId: string,
  name: string,
  label: string,
  input?: unknown,
  mastraToolCallId?: string
): Promise<string> {
  if (mastraToolCallId) {
    const existing = await prisma.generationToolCall.findFirst({
      where: { runId, mastraToolCallId },
      select: { id: true }
    });

    if (existing) {
      await prisma.generationToolCall.update({
        where: { id: existing.id },
        data: {
          name,
          label,
          status: 'RUNNING',
          completedAt: null,
          errorMessage: null,
          ...(input !== undefined ? { inputJson: asUnknownJsonInput(input) } : {})
        }
      });
      return existing.id;
    }
  }

  const toolCall = await prisma.generationToolCall.create({
    data: {
      runId,
      name,
      label,
      status: 'RUNNING',
      ...(mastraToolCallId ? { mastraToolCallId } : {}),
      ...(input !== undefined ? { inputJson: asUnknownJsonInput(input) } : {})
    },
    select: { id: true }
  });

  return toolCall.id;
}

async function finishGenerationToolCall(
  toolCallId: string,
  status: 'COMPLETED' | 'FAILED',
  result?: unknown,
  errorMessage?: string
): Promise<void> {
  await prisma.generationToolCall.update({
    where: { id: toolCallId },
    data: {
      status,
      completedAt: new Date(),
      ...(result !== undefined ? { resultJson: asUnknownJsonInput(result) } : {}),
      ...(errorMessage ? { errorMessage } : {})
    }
  });
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
  if (Array.isArray(record.errors) && record.errors.length > 0) {
    return record.errors.map((error) => String(error)).join('; ');
  }

  if (typeof record.error === 'string') return record.error;
  if (typeof record.message === 'string') return record.message;

  return undefined;
}

async function saveGenerationCheckpoint(input: {
  runId: string;
  status: 'DRAFT' | 'VALIDATED' | 'VALIDATION_FAILED' | 'COMMITTED';
  deck: GeneratedDeck;
  summary?: string;
  validation?: unknown;
  revisionId?: string;
}): Promise<string> {
  const checkpoint = await prisma.generationCheckpoint.create({
    data: {
      runId: input.runId,
      status: input.status,
      deckJson: asJsonInput(input.deck),
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.validation !== undefined ? { validationJson: asUnknownJsonInput(input.validation) } : {}),
      ...(input.revisionId ? { revisionId: input.revisionId } : {})
    },
    select: { id: true }
  });

  return checkpoint.id;
}

async function markGenerationCheckpointCommitted(
  checkpointId: string,
  revisionId: string
): Promise<void> {
  await prisma.generationCheckpoint.update({
    where: { id: checkpointId },
    data: {
      status: 'COMMITTED',
      revisionId
    }
  });
}

function parseCommentsPayload(value: string | null): {
  comments: Array<{ id: string; slideId?: string | null; elementIds: string[]; text: string }>;
  commentIds: string[];
} {
  const parsed = value ? JSON.parse(value) as unknown : [];
  const comments = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { comments?: unknown }).comments)
      ? (parsed as { comments: unknown[] }).comments
      : [];

  const normalized = comments
    .filter((comment): comment is { id: string; slideId?: string | null; elementIds?: string[]; text: string } =>
      !!comment &&
      typeof comment === 'object' &&
      typeof (comment as { id?: unknown }).id === 'string' &&
      typeof (comment as { text?: unknown }).text === 'string'
    )
    .map((comment) => ({
      id: comment.id,
      slideId: comment.slideId ?? null,
      elementIds: Array.isArray(comment.elementIds) ? comment.elementIds : [],
      text: comment.text
    }));

  return {
    comments: normalized,
    commentIds: normalized.map((comment) => comment.id)
  };
}

function parseTweaksPayload(value: string | null): {
  batchId: string | null;
  tweaks: Array<{ scope: 'DECK' | 'SLIDE' | 'ELEMENT'; slideId?: string | null; elementId?: string | null; category: string; value: unknown }>;
} {
  const parsed = value ? JSON.parse(value) as unknown : [];
  const batchId =
    parsed && typeof parsed === 'object' && typeof (parsed as { batchId?: unknown }).batchId === 'string'
      ? (parsed as { batchId: string }).batchId
      : null;
  const items = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : [];

  return {
    batchId,
    tweaks: items.filter((item): item is { scope: 'DECK' | 'SLIDE' | 'ELEMENT'; slideId?: string | null; elementId?: string | null; category: string; value: unknown } =>
      !!item &&
      typeof item === 'object' &&
      ['DECK', 'SLIDE', 'ELEMENT'].includes(String((item as { scope?: unknown }).scope)) &&
      typeof (item as { category?: unknown }).category === 'string'
    )
  };
}

type SubmittedComment = { id: string; slideId?: string | null; elementIds: string[]; text: string };
type SubmittedTweak = { scope: 'DECK' | 'SLIDE' | 'ELEMENT'; slideId?: string | null; elementId?: string | null; category: string; value: unknown };

function parseRunCommandContext(run: { commandContextJson?: unknown }): Record<string, unknown> | null {
  const context = run.commandContextJson;
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  return context as Record<string, unknown>;
}

function getRunCommandIntent(run: { commandContextJson?: unknown }): string | null {
  const context = parseRunCommandContext(run);
  return typeof context?.intent === 'string' && context.intent.trim() ? context.intent : null;
}

function getSubmittedCommentIdsForRun(run: {
  kind: string;
  manualInstruction: string | null;
  commandContextJson?: unknown;
}): string[] {
  const context = parseRunCommandContext(run);
  if (context?.intent === 'apply_comments' && Array.isArray(context.commentIds)) {
    return Array.from(new Set(
      context.commentIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    ));
  }

  return run.kind === 'APPLY_COMMENTS' ? parseCommentsPayload(run.manualInstruction).commentIds : [];
}

function getSubmittedTweakBatchIdForRun(run: {
  kind: string;
  manualInstruction: string | null;
  commandContextJson?: unknown;
}): string | null {
  const context = parseRunCommandContext(run);
  if (context?.intent === 'apply_tweaks' && typeof context.tweakBatchId === 'string' && context.tweakBatchId.trim()) {
    return context.tweakBatchId;
  }

  return run.kind === 'APPLY_TWEAKS' ? parseTweaksPayload(run.manualInstruction).batchId : null;
}

async function loadSubmittedCommentsForRun(run: GenerationRun): Promise<SubmittedComment[]> {
  const commentIds = getSubmittedCommentIdsForRun(run);
  if (commentIds.length === 0) return [];

  const comments = await prisma.comment.findMany({
    where: {
      deckId: run.deckId,
      id: { in: commentIds }
    },
    select: {
      id: true,
      slideId: true,
      elementIds: true,
      text: true
    }
  });
  const order = new Map(commentIds.map((id, index) => [id, index]));

  return comments
    .map((comment) => ({
      id: comment.id,
      slideId: comment.slideId,
      elementIds: comment.elementIds,
      text: comment.text
    }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

async function loadSubmittedTweaksForRun(run: GenerationRun): Promise<{ batchId: string | null; tweaks: SubmittedTweak[] }> {
  const batchId = getSubmittedTweakBatchIdForRun(run);
  if (!batchId) {
    return run.kind === 'APPLY_TWEAKS'
      ? parseTweaksPayload(run.manualInstruction)
      : { batchId: null, tweaks: [] };
  }

  const batch = await prisma.tweakBatch.findFirst({
    where: {
      id: batchId,
      deckId: run.deckId
    },
    select: {
      id: true,
      items: {
        orderBy: { createdAt: 'asc' },
        select: {
          scope: true,
          slideId: true,
          elementId: true,
          category: true,
          value: true
        }
      }
    }
  });

  if (!batch) return { batchId, tweaks: [] };

  return {
    batchId: batch.id,
    tweaks: batch.items.map((item) => ({
      scope: item.scope,
      slideId: item.slideId,
      elementId: item.elementId,
      category: item.category,
      value: item.value
    }))
  };
}

export function buildWorkflowFailureMessage(result: { status: string } & Record<string, unknown>): string {
  const detail = extractWorkflowFailureDetail(result);
  return detail
    ? `Workflow ended with status: ${result.status}: ${detail}`
    : `Workflow ended with status: ${result.status}`;
}

export function buildAgentStoppedBeforeFinishMessage(input: AgentStopDiagnosticInput): string {
  const base = input.committedFallback
    ? 'Agent stream ended before finish_generation; committed the latest valid draft checkpoint instead.'
    : 'Agent stopped before calling finish_generation; no revision was committed.';
  const details = [
    formatDiagnosticDetail('draftSlides', input.draftSlideCount),
    formatDiagnosticDetail('latestCheckpointId', input.latestCheckpointId),
    formatDiagnosticDetail('latestCheckpointSummary', input.latestCheckpointSummary),
    formatDiagnosticDetail('finishReason', input.finishReason ?? input.lastStepFinishReason),
    formatDiagnosticDetail('lastChunkType', input.lastChunkType),
    input.lastToolName ? `lastTool=${input.lastToolName}${input.lastToolStatus ? `/${input.lastToolStatus}` : ''}` : null,
    formatDiagnosticDetail('streamChunks', input.chunkCount),
    formatDiagnosticDetail('fallbackBlockedReason', input.fallbackBlockedReason),
    ...[...(input.failedToolErrors ?? []), ...(input.toolErrorMessages ?? [])]
      .filter((message): message is string => !!message && message.trim().length > 0)
      .slice(0, 3)
      .map((message) => `recentToolError=${truncateDiagnosticText(message)}`)
  ].filter((detail): detail is string => !!detail);

  return details.length > 0 ? `${base} Details: ${details.join('; ')}.` : base;
}

function formatDiagnosticDetail(label: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return `${label}=${truncateDiagnosticText(String(value))}`;
}

function truncateDiagnosticText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function extractWorkflowFailureDetail(value: unknown, seen = new Set<unknown>()): string | null {
  if (!value || typeof value !== 'object') return null;
  if (value instanceof Error) return value.message;
  if (seen.has(value)) return null;
  seen.add(value);

  const record = value as Record<string, unknown>;
  for (const key of ['errorMessage', 'message']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim() && candidate !== record.status) {
      return candidate;
    }
  }

  for (const key of ['error', 'cause', 'failure', 'exception']) {
    const detail = extractWorkflowFailureDetail(record[key], seen);
    if (detail) return detail;
  }

  for (const key of ['steps', 'stepResults', 'results', 'events']) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const detail = extractWorkflowFailureDetail(item, seen);
        if (detail) return detail;
      }
    } else {
      const detail = extractWorkflowFailureDetail(candidate, seen);
      if (detail) return detail;
    }
  }

  return null;
}

async function restoreSubmittedRefinementState(run: {
  kind: string;
  deckId: string;
  manualInstruction: string | null;
  commandContextJson?: unknown;
}): Promise<void> {
  const commentIds = getSubmittedCommentIdsForRun(run);
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

  const tweakBatchId = getSubmittedTweakBatchIdForRun(run);
  if (tweakBatchId) {
    await prisma.tweakBatch.updateMany({
      where: {
        deckId: run.deckId,
        id: tweakBatchId,
        status: 'SUBMITTED'
      },
      data: { status: 'PENDING', submittedAt: null }
    });
  }
}

async function isGenerationRunCancelled(runId: string): Promise<boolean> {
  const run = await prisma.generationRun.findUnique({
    where: { id: runId },
    select: { status: true }
  });

  return run?.status === 'CANCELLED';
}

async function assertGenerationRunNotCancelled(runId: string): Promise<void> {
  if (await isGenerationRunCancelled(runId)) {
    throw new GenerationRunCancelledError();
  }
}

async function markGenerationRunCancellationHandled(
  generationRunId: string,
  run: GenerationRun | null
): Promise<void> {
  const current = await prisma.generationRun.findUnique({
    where: { id: generationRunId },
    select: { status: true }
  });
  const completedAt = new Date();

  await prisma.generationToolCall.updateMany({
    where: { runId: generationRunId, status: 'RUNNING' },
    data: {
      status: 'FAILED',
      completedAt,
      errorMessage: 'Generation cancelled by user.'
    }
  }).catch((updateErr) => {
    console.error('Failed to mark running GenerationToolCalls as cancelled.', { generationRunId, updateErr });
  });

  if (current?.status !== 'CANCELLED') {
    await prisma.generationRun.update({
      where: { id: generationRunId },
      data: {
        status: 'CANCELLED',
        completedAt,
        errorMessage: 'Generation cancelled by user.',
        pendingAskAnswer: null,
        askQuestion: null,
        askOptionsJson: Prisma.DbNull
      }
    }).catch((updateErr) => {
      console.error('Failed to mark GenerationRun as CANCELLED.', { generationRunId, updateErr });
    });

    await recordGenerationMessage(
      generationRunId,
      'SYSTEM',
      'Generation was cancelled by user request.',
      { kind: 'generation_cancelled' }
    ).catch((messageErr) => {
      console.error('Failed to record GenerationRun cancellation message.', { generationRunId, messageErr });
    });
  }

  if (run) {
    await restoreSubmittedRefinementState(run).catch((restoreErr) => {
      console.error('Failed to restore submitted refinement state after GenerationRun cancellation.', {
        generationRunId,
        restoreErr
      });
    });
  }
}

async function buildPromptInputForRun(
  run: {
    id: string;
    kind: string;
    deckId: string;
    workspaceId: string;
    createdByUserId: string;
    languageCode: string;
    manualInstruction: string | null;
    pendingAskAnswer: string | null;
    customPromptId: string | null;
    designSystemId: string | null;
  },
  deckJson: string | undefined,
  provider: ReferencePromptProviderContext
): Promise<PromptInputBuildResult> {
  const promptInput: Record<string, unknown> = {
    workspaceInstruction: `Generate the presentation content in language code "${run.languageCode}" unless the user's instruction explicitly requests another output language.`
  };
  const referencePromptFiles: Array<Record<string, unknown>> = [];
  const assetUrls: Record<string, string> = {};
  const assets: PromptInputBuildResult['assets'] = [];

  if (run.kind === 'FULL_DECK') {
    promptInput.workspaceInstruction = `${promptInput.workspaceInstruction}\n\nFor full-deck generation, infer the appropriate deck structure and depth from the prompt. Unless the user explicitly asks for a short/minimal deck or a specific low slide count, produce a complete, presentation-ready deck with enough slides to cover the topic well, one main takeaway per slide, varied visual composition, and clear next-step or decision value where relevant.`;
  }

  if (run.manualInstruction) {
    promptInput.manualInstruction = run.manualInstruction;
  }

  if (run.pendingAskAnswer) {
    promptInput.manualInstruction = run.manualInstruction
      ? `${run.manualInstruction}\n\nUser clarification: ${run.pendingAskAnswer}`
      : `User clarification: ${run.pendingAskAnswer}`;
  }

  if (deckJson && run.kind !== 'FULL_DECK') {
    promptInput.deckState = deckJson;
  }

  if (run.customPromptId) {
    promptInput.customPromptInstruction = await loadCustomPromptInstruction(
      run.customPromptId,
      run.workspaceId,
      run.createdByUserId,
      run.languageCode
    );
  }

  if (run.designSystemId) {
    const designSystemContext = await loadDesignSystemContext(
      run.designSystemId,
      run.workspaceId,
      run.createdByUserId
    );
    promptInput.designSystemInstruction = designSystemContext.instruction;
    Object.assign(assetUrls, designSystemContext.assetUrls);
    assets.push(...designSystemContext.assets.map((a) => ({
      id: a.id,
      role: a.role,
      originalFilename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes ?? 0,
      imageWidth: a.imageWidth ?? null,
      imageHeight: a.imageHeight ?? null
    })));
  }

  const deckReferenceFiles = await prisma.referenceFile.findMany({
    where: {
      deckId: run.deckId,
      purpose: 'REFERENCE',
      expiresAt: { gt: new Date() }
    },
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      pageCount: true,
      imageWidth: true,
      imageHeight: true,
      storageBucket: true,
      storageObjectPath: true,
      providerFileId: true,
      providerDefinitionId: true
    },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  if (deckReferenceFiles.length > 0) {
    referencePromptFiles.push(...await buildReferenceFilePromptInputs(deckReferenceFiles, provider));

    await prisma.assetUsage.createMany({
      data: deckReferenceFiles.map((file) => ({
        referenceFileId: file.id,
        context: 'generation',
        contextId: run.id
      }))
    });
  }

  const deckAssets = await prisma.referenceFile.findMany({
    where: {
      deckId: run.deckId,
      purpose: 'ASSET',
      expiresAt: { gt: new Date() }
    },
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      imageWidth: true,
      imageHeight: true,
      storageBucket: true,
      storageObjectPath: true
    },
    orderBy: { createdAt: 'desc' }
  });

  for (const asset of deckAssets) {
    const assetMeta = {
      id: asset.id,
      role: 'other',
      originalFilename: asset.originalFilename,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      imageWidth: asset.imageWidth ?? null,
      imageHeight: asset.imageHeight ?? null
    };
    if (!asset.mimeType.startsWith('image/') || asset.sizeBytes > MAX_INLINE_RENDERABLE_ASSET_BYTES) {
      assets.push(assetMeta);
      continue;
    }
    try {
      const object = await getCachedObjectStorageAdapter(asset.storageBucket).getObject({
        objectPath: asset.storageObjectPath
      });
      assetUrls[asset.id] = `data:${asset.mimeType};base64,${Buffer.from(object.body).toString('base64')}`;
      assets.push(assetMeta);
    } catch {
      // Keep the asset as model-visible metadata even if render embedding fails.
    }
  }

  if (referencePromptFiles.length > 0) {
    promptInput.referenceFiles = referencePromptFiles;
  }

  if (assets.length > 0) {
    promptInput.availableAssets = assets.map((asset) => ({
      id: asset.id,
      role: asset.role,
      filename: asset.originalFilename,
      mimeType: asset.mimeType,
      dimensions:
        asset.imageWidth && asset.imageHeight
          ? `${asset.imageWidth}x${asset.imageHeight}`
          : 'unknown',
      usageHint: `Use in slide HTML as src="pepetex://asset/${asset.id}" and include { "assetId": "${asset.id}", "role": "${asset.role === 'logo' ? 'logo' : 'image'}", "required": true } in slide.assets when the asset should render.`
    }));
  }

  return { promptInput, assetUrls, assets };
}

async function buildReferenceFilePromptInputs(
  referenceFiles: Array<{
    id: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    pageCount: number | null;
    imageWidth: number | null;
    imageHeight: number | null;
    storageBucket: string;
    storageObjectPath: string;
    providerFileId: string | null;
    providerDefinitionId: string | null;
  }>,
  provider: ReferencePromptProviderContext
): Promise<Array<Record<string, unknown>>> {
  let attachedBytes = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const file of referenceFiles) {
    const baseInput: Record<string, unknown> = {
      id: file.id,
      source: 'deck',
      filename: file.originalFilename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      ...(file.pageCount ? { pageCount: file.pageCount } : {}),
      ...(file.imageWidth && file.imageHeight
        ? { imageWidth: file.imageWidth, imageHeight: file.imageHeight }
        : {}),
      usageHint: 'Use as deck-scoped reference material only.'
    };
    const attachmentSupport = getReferenceAttachmentSupport(file.mimeType, provider);

    if (!attachmentSupport.supported || !attachmentSupport.mode) {
      results.push({
        ...baseInput,
        attachedToModel: false,
        attachmentMode: 'metadata-only',
        attachmentReason: attachmentSupport.reason
      });
      continue;
    }

    if (attachmentSupport.mode === 'provider-file') {
      const providerFileAttachment = await buildProviderFileAttachment(file, provider);
      results.push({
        ...baseInput,
        ...providerFileAttachment
      });
      continue;
    }

    if (file.sizeBytes > MAX_REFERENCE_ATTACHMENT_FILE_BYTES) {
      results.push({
        ...baseInput,
        attachedToModel: false,
        attachmentMode: 'metadata-only',
        attachmentReason: `file exceeds inline attachment limit of ${MAX_REFERENCE_ATTACHMENT_FILE_BYTES} bytes`
      });
      continue;
    }

    if (attachedBytes + file.sizeBytes > MAX_REFERENCE_ATTACHMENT_BYTES) {
      results.push({
        ...baseInput,
        attachedToModel: false,
        attachmentMode: 'metadata-only',
        attachmentReason: `reference attachment budget of ${MAX_REFERENCE_ATTACHMENT_BYTES} bytes was already used`
      });
      continue;
    }

    try {
      const object = await getCachedObjectStorageAdapter(file.storageBucket).getObject({
        objectPath: file.storageObjectPath
      });
      attachedBytes += object.body.byteLength;
      results.push({
        ...baseInput,
        attachedToModel: true,
        attachmentMode: 'inline',
        contentBase64: Buffer.from(object.body).toString('base64')
      });
    } catch (error) {
      results.push({
        ...baseInput,
        attachedToModel: false,
        attachmentMode: 'metadata-only',
        attachmentReason: error instanceof Error ? error.message : 'could not load stored file bytes'
      });
    }
  }

  return results;
}

function getReferenceAttachmentSupport(
  mimeType: string,
  provider: { kind: TextProviderKind; baseUrl: string | null }
): ReferenceAttachmentSupport {
  const routeKind = provider.kind === 'cliproxyapi' && provider.baseUrl
    ? inferCLIProxyRouteKind(provider.baseUrl)
    : null;
  const effectiveKind = routeKind === 'gemini-compatible'
    ? 'gemini'
    : routeKind === 'openai-compatible'
      ? 'openai-compatible'
      : provider.kind;

  if (effectiveKind === 'gemini') {
    if (!isGeminiAttachableMimeType(mimeType)) {
      return { supported: false, reason: `mime type ${mimeType} is not supported for Gemini reference input` };
    }

    return mimeType === 'application/pdf'
      ? { supported: true, mode: 'provider-file' }
      : { supported: true, mode: 'inline' };
  }

  if (effectiveKind === 'openai-compatible') {
    return mimeType.startsWith('image/') || isTextLikeReferenceMimeType(mimeType)
      ? { supported: true, mode: 'inline' }
      : { supported: false, reason: `mime type ${mimeType} is not supported by the OpenAI-compatible chat attachment path` };
  }

  return {
    supported: false,
    reason: `provider kind ${provider.kind} does not support direct reference-file attachment in deck generation`
  };
}

async function buildProviderFileAttachment(
  file: {
    id: string;
    originalFilename: string;
    mimeType: string;
    storageBucket: string;
    storageObjectPath: string;
    providerFileId: string | null;
    providerDefinitionId: string | null;
  },
  provider: ReferencePromptProviderContext
): Promise<Record<string, unknown>> {
  if (file.providerDefinitionId === provider.providerId && file.providerFileId) {
    return {
      attachedToModel: true,
      attachmentMode: 'provider-file',
      providerFileId: file.providerFileId,
      providerFileUri: buildGeminiProviderFileUri(provider.baseUrl, file.providerFileId)
    };
  }

  try {
    const object = await getCachedObjectStorageAdapter(file.storageBucket).getObject({
      objectPath: file.storageObjectPath
    });
    const adapter = createTextProviderAdapter(provider.kind);

    if (!adapter.uploadReferenceFile) {
      throw new Error(`provider kind ${provider.kind} has no file upload adapter`);
    }

    const providerFile = await adapter.uploadReferenceFile(
      {
        filename: file.originalFilename,
        mimeType: file.mimeType,
        content: object.body
      },
      {
        baseUrl: provider.baseUrl,
        credential: provider.credential
      }
    );

    await prisma.referenceFile.update({
      where: { id: file.id },
      data: {
        providerDefinitionId: provider.providerId,
        providerFileId: providerFile.providerFileId
      }
    });

    return {
      attachedToModel: true,
      attachmentMode: 'provider-file',
      providerFileId: providerFile.providerFileId,
      providerFileUri: providerFile.providerFileUri ?? buildGeminiProviderFileUri(provider.baseUrl, providerFile.providerFileId)
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'could not upload reference file to provider';
    throw new Error(`Reference file "${file.originalFilename}" could not be attached to the model: ${reason}`);
  }
}

function buildGeminiProviderFileUri(baseUrl: string | null, providerFileId: string): string {
  if (/^https?:\/\//i.test(providerFileId)) return providerFileId;

  const normalizedFileId = providerFileId.replace(/^\/+/, '');
  const normalizedBaseUrl = (baseUrl ?? DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, '');
  const apiBase = normalizedBaseUrl.endsWith('/v1beta') || normalizedBaseUrl.endsWith('/v1')
    ? normalizedBaseUrl
    : normalizedBaseUrl.endsWith('/files')
      ? normalizedBaseUrl.slice(0, -'/files'.length)
      : `${normalizedBaseUrl}/v1beta`;

  return `${apiBase}/${normalizedFileId}`;
}

function isGeminiAttachableMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/')
    || mimeType.startsWith('text/')
    || mimeType === 'application/pdf'
    || mimeType === 'application/json'
    || mimeType === 'application/csv';
}

function isTextLikeReferenceMimeType(mimeType: string): boolean {
  return mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || mimeType === 'application/csv'
    || mimeType === 'text/csv'
    || mimeType === 'application/xml';
}

async function loadCustomPromptInstruction(
  customPromptId: string,
  workspaceId: string,
  actorUserId: string,
  languageCode: string
): Promise<string> {
  const customPrompt = await prisma.customPrompt.findFirst({
    where: {
      id: customPromptId,
      OR: [
        { ownerUserId: actorUserId },
        { workspaceId },
        { scope: 'GLOBAL' }
      ]
    },
    select: {
      title: true,
      variants: {
        select: { languageCode: true, instruction: true },
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  if (!customPrompt) {
    throw new Error('Selected custom prompt was not found or is not accessible.');
  }

  const variant =
    customPrompt.variants.find((entry) => entry.languageCode === languageCode) ??
    customPrompt.variants.find((entry) => entry.languageCode === 'en') ??
    customPrompt.variants[0];

  if (!variant) {
    throw new Error('Selected custom prompt has no instruction variant.');
  }

  return `Custom prompt: ${customPrompt.title}\n\n${variant.instruction}`;
}

async function loadDesignSystemContext(
  designSystemId: string,
  workspaceId: string,
  actorUserId: string
): Promise<DesignSystemContextResult> {
  const designSystem = await prisma.designSystem.findFirst({
    where: {
      id: designSystemId,
      isEnabled: true,
      OR: [
        { ownerUserId: actorUserId },
        { workspaceId },
        { scope: 'GLOBAL' }
      ]
    },
    select: {
      name: true,
      description: true,
      versions: {
        select: {
          documentJson: true
        },
        orderBy: { versionNumber: 'desc' },
        take: 1
      }
    }
  });

  if (!designSystem || !designSystem.versions[0]) {
    throw new Error('Selected design system was not found, is disabled, or has no version.');
  }

  const currentVersion = designSystem.versions[0];

  const designSystemAssetRecords = await prisma.designSystemReferenceFile.findMany({
    where: {
      designSystemId,
      purpose: 'ASSET'
    },
    select: {
      id: true,
      role: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      pageCount: true,
      imageWidth: true,
      imageHeight: true,
      storageBucket: true,
      storageObjectPath: true
    },
    orderBy: { createdAt: 'asc' }
  });

  const assetUrls = await buildRenderableAssetDataUrls(designSystemAssetRecords);
  const designSystemAssets = designSystemAssetRecords
    .filter((file) => isDesignSystemVisualAsset({
      role: normalizeDesignSystemReferenceRole(file.role),
      mimeType: file.mimeType
    }))
    .map((file) => ({
      id: file.id,
      role: normalizeDesignSystemReferenceRole(file.role),
      filename: file.originalFilename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      imageWidth: file.imageWidth,
      imageHeight: file.imageHeight,
      directUseAvailable: typeof assetUrls[file.id] === 'string'
    }));

  const document = normalizeDesignSystemDocumentV2(currentVersion.documentJson, { enforceQuality: false });

  // Resolve V2 generated-image asset items into placeable brand assets so the deck
  // composer can drop logos/illustrations/icons into slides via pepetex://asset/{id}.
  const generatedAssets = await resolveGeneratedDesignSystemAssets(designSystemId, document, assetUrls);
  const allAssets = [...designSystemAssets, ...generatedAssets];

  return {
    instruction: formatDesignSystemV2Instruction({
      name: designSystem.name,
      description: designSystem.description,
      document,
      assets: allAssets
    }),
    assetUrls,
    assets: allAssets
  };
}

/**
 * Resolves V2 asset-bucket items that point at COMPLETED GeneratedImages into placeable
 * brand assets, adding their data URLs to assetUrls (keyed by generatedImageId).
 */
async function resolveGeneratedDesignSystemAssets(
  designSystemId: string,
  document: DesignSystemDocumentV2,
  assetUrls: Record<string, string>
): Promise<Array<{ id: string; role: DesignSystemReferenceRole; filename: string; mimeType: string; sizeBytes: number; imageWidth: number | null; imageHeight: number | null; directUseAvailable: boolean }>> {
  const generatedImageIds = new Set<string>();
  for (const bucket of document.buckets) {
    if (bucket.kind !== 'asset') continue;
    for (const sub of bucket.subCategories) {
      for (const item of sub.items) {
        const asset = item as { source?: string; generatedImageId?: string | null };
        if (asset.source === 'generated' && asset.generatedImageId) generatedImageIds.add(asset.generatedImageId);
      }
    }
  }
  if (generatedImageIds.size === 0) return [];

  const images = await prisma.generatedImage.findMany({
    where: { id: { in: [...generatedImageIds] }, designSystemId, status: 'COMPLETED', gcsBucket: { not: null }, gcsPath: { not: null } },
    select: { id: true, gcsBucket: true, gcsPath: true, mimeType: true, width: true, height: true }
  });

  const resolved: Array<{ id: string; role: DesignSystemReferenceRole; filename: string; mimeType: string; sizeBytes: number; imageWidth: number | null; imageHeight: number | null; directUseAvailable: boolean }> = [];
  for (const image of images) {
    try {
      const storage = getCachedObjectStorageAdapter(image.gcsBucket!);
      const object = await storage.getObject({ objectPath: image.gcsPath! });
      const base64 = Buffer.from(object.body).toString('base64');
      assetUrls[image.id] = `data:${image.mimeType};base64,${base64}`;
      resolved.push({
        id: image.id,
        role: 'brand-image',
        filename: `${image.id}.png`,
        mimeType: image.mimeType,
        sizeBytes: object.body.byteLength,
        imageWidth: image.width,
        imageHeight: image.height,
        directUseAvailable: true
      });
    } catch {
      // Skip assets whose bytes cannot be loaded; they simply are not offered as placeable.
    }
  }
  return resolved;
}

/**
 * Returns a legacy-shaped DesignSystemDocument flattened from the V2 documentJson, for
 * the deck's in-memory consumers (chart-colour extraction + slide compliance checking).
 * V2 (documentJson) is the source of truth; this projection is never persisted.
 */
async function loadDesignSystemDocument(designSystemId: string): Promise<DesignSystemDocument | undefined> {
  const document = await loadDesignSystemDocumentV2(designSystemId);
  return document ? projectV2ToLegacyDocument(document) : undefined;
}

async function loadDesignSystemDocumentV2(designSystemId: string): Promise<DesignSystemDocumentV2 | undefined> {
  const designSystem = await prisma.designSystem.findFirst({
    where: { id: designSystemId, isEnabled: true },
    select: {
      versions: {
        orderBy: { versionNumber: 'desc' },
        take: 1,
        select: { documentJson: true }
      }
    }
  });

  const version = designSystem?.versions[0];
  if (!version) {
    return undefined;
  }

  return normalizeDesignSystemDocumentV2(version.documentJson, { enforceQuality: false });
}

async function loadDesignSystemFontFaces(
  designSystemId: string,
  document: DesignSystemDocumentV2
): Promise<GeneratedDeckFont[]> {
  const typographyFonts = new Map<string, { fontFamily: string; fontWeight: number }>();

  for (const bucket of document.buckets) {
    if (bucket.kind !== 'typography') continue;
    for (const sub of bucket.subCategories) {
      for (const item of sub.items) {
        const token = item as { fontAssetId?: string | null; fontFamily?: string; fontWeight?: number };
        if (!token.fontAssetId || !token.fontFamily || typeof token.fontWeight !== 'number') continue;
        typographyFonts.set(token.fontAssetId, {
          fontFamily: token.fontFamily,
          fontWeight: token.fontWeight
        });
      }
    }
  }

  if (typographyFonts.size === 0) return [];

  const files = await prisma.designSystemReferenceFile.findMany({
    where: {
      designSystemId,
      purpose: 'ASSET',
      id: { in: [...typographyFonts.keys()] }
    },
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      storageBucket: true,
      storageObjectPath: true
    }
  });

  const fonts: GeneratedDeckFont[] = [];
  for (const file of files) {
    if (!isSupportedFontMimeType(file.mimeType)) continue;
    const token = typographyFonts.get(file.id);
    if (!token) continue;
    try {
      const object = await getCachedObjectStorageAdapter(file.storageBucket).getObject({
        objectPath: file.storageObjectPath
      });
      fonts.push({
        id: file.id,
        fontFamily: token.fontFamily,
        fontAliases: deriveFontFamilyAliases(token.fontFamily, file.originalFilename),
        mimeType: file.mimeType,
        dataUrl: `data:${file.mimeType};base64,${Buffer.from(object.body).toString('base64')}`,
        fontWeight: token.fontWeight,
        fontStyle: 'normal'
      });
    } catch {
      // Keep generation resilient if a font object was deleted or storage is temporarily unavailable.
    }
  }

  return fonts;
}

function isSupportedFontMimeType(mimeType: string): boolean {
  return /^(font\/(ttf|otf|woff|woff2)|application\/(font-woff|font-woff2|x-font-ttf|x-font-otf|vnd\.ms-opentype|font-sfnt))$/i.test(mimeType);
}

function normalizeDesignSystemReferenceRole(value: string): DesignSystemReferenceRole {
  return value === 'logo' || value === 'brand-image' || value === 'font' || value === 'pdf' ? value : 'other';
}

function isDesignSystemVisualAsset(file: { role: DesignSystemReferenceRole; mimeType: string }): boolean {
  return (file.role === 'logo' || file.role === 'brand-image') && file.mimeType.startsWith('image/');
}

async function buildRenderableAssetDataUrls(
  files: RenderableAssetRecord[]
): Promise<Record<string, string>> {
  const assetUrls: Record<string, string> = {};

  for (const file of files) {
    if (!file.mimeType.startsWith('image/') || file.sizeBytes > MAX_INLINE_RENDERABLE_ASSET_BYTES) {
      continue;
    }

    try {
      const object = await getCachedObjectStorageAdapter(file.storageBucket).getObject({
        objectPath: file.storageObjectPath
      });
      assetUrls[file.id] = `data:${file.mimeType};base64,${Buffer.from(object.body).toString('base64')}`;
    } catch {
      // Keep the asset as model-visible metadata even if render embedding fails.
    }
  }

  return assetUrls;
}

async function resolveProviderContext(providerId: string): Promise<{
  kind: TextProviderKind;
  baseUrl: string | null;
  credential: { apiKey: string; organizationId?: string; projectId?: string; customHeaders?: Record<string, string> };
}> {
  const definition = await prisma.providerDefinition.findUniqueOrThrow({
    where: { id: providerId },
    select: {
      kind: true,
      baseUrl: true,
      credentials: {
        where: { scope: 'SYSTEM' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { encryptedPayload: true }
      }
    }
  });

  const encryptedCred = definition.credentials[0];
  if (!encryptedCred) {
    throw new Error(`No system credential found for provider ${providerId}.`);
  }

  const payload = decryptProviderCredentialPayload(
    encryptedCred.encryptedPayload,
    requireEncryptionKey()
  );

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

async function applyPatchToDeck(
  deckId: string,
  userId: string,
  patch: DeckPatch,
  revisionSource: DeckRevisionSource,
  revisionLabel: string,
  revisionSummary: string
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const deck = await tx.deck.findUniqueOrThrow({
      where: { id: deckId },
      select: { contentJson: true, currentRevisionNumber: true }
    });

    const currentContent = deck.contentJson as unknown as GeneratedDeck;
    if (!currentContent || !Array.isArray(currentContent.slides)) {
      throw new Error('Deck has no valid content to patch.');
    }

    const nextSlides = applyDeckPatchToContent(currentContent, patch).slides;

    const nextContent: GeneratedDeck = { ...currentContent, slides: nextSlides };
    const nextRevisionNumber = Math.max(deck.currentRevisionNumber, 0) + 1;

    await tx.deck.update({
      where: { id: deckId },
      data: {
        contentJson: asJsonInput(nextContent),
        currentRevisionNumber: nextRevisionNumber
      }
    });

    const revision = await tx.deckRevision.create({
      data: {
        deckId,
        revisionNumber: nextRevisionNumber,
        label: revisionLabel,
        source: revisionSource,
        summary: revisionSummary,
        deckJson: asJsonInput(nextContent),
        createdByUserId: userId
      }
    });

    return revision.id;
  });
}

export function applyDeckPatchToContent(currentContent: GeneratedDeck, patch: DeckPatch): GeneratedDeck {
  if (!Array.isArray(patch.operations) || patch.operations.length === 0) {
    throw new Error('Deck patch did not contain any operations to apply.');
  }

  let nextSlides = [...currentContent.slides];
  for (const op of patch.operations) {
    if (op.op === 'replace_slide') {
      const idx = nextSlides.findIndex((s) => s.id === op.slideId);
      if (idx < 0) throw new Error(`replace_slide target not found: ${op.slideId}`);
      nextSlides[idx] = op.slide;
    } else if (op.op === 'insert_slide') {
      const insertIdx = resolveInsertIndex(nextSlides, {
        position: op.position,
        ...(typeof op.index === 'number' ? { index: op.index } : {}),
        ...(op.referenceSlideId ? { referenceSlideId: op.referenceSlideId } : {})
      });
      nextSlides.splice(insertIdx, 0, op.slide);
    } else if (op.op === 'delete_slide') {
      if (!nextSlides.some((s) => s.id === op.slideId)) {
        throw new Error(`delete_slide target not found: ${op.slideId}`);
      }
      nextSlides = nextSlides.filter((s) => s.id !== op.slideId);
    } else if (op.op === 'move_slide') {
      const fromIdx = nextSlides.findIndex((s) => s.id === op.slideId);
      if (fromIdx < 0) throw new Error(`move_slide target not found: ${op.slideId}`);
      const [moved] = nextSlides.splice(fromIdx, 1);
      if (moved) nextSlides.splice(op.toIndex, 0, moved);
    } else if (op.op === 'update_text') {
      const idx = nextSlides.findIndex((s) => s.id === op.slideId);
      if (idx < 0) throw new Error(`update_text slide target not found: ${op.slideId}`);
      const slide = nextSlides[idx];
      if (!slide) throw new Error(`update_text slide target not found: ${op.slideId}`);
      const updated = updateSlideTextElement({
        html: slide.html,
        elementId: op.elementId,
        text: op.text
      });
      nextSlides[idx] = {
        ...slide,
        html: updated.html,
        ...(updated.title ? { title: updated.title } : {})
      };
    } else if (op.op === 'update_element_style') {
      const idx = nextSlides.findIndex((s) => s.id === op.slideId);
      if (idx < 0) throw new Error(`update_element_style slide target not found: ${op.slideId}`);
      const slide = nextSlides[idx];
      if (!slide) throw new Error(`update_element_style slide target not found: ${op.slideId}`);
      const updated = updateSlideElementStyle({
        html: slide.html,
        css: slide.css,
        slideId: slide.id,
        elementId: op.elementId,
        styles: op.styles
      });
      nextSlides[idx] = {
        ...slide,
        html: updated.html,
        css: updated.css,
        ...(updated.title ? { title: updated.title } : {})
      };
    } else if (op.op === 'update_element_attributes') {
      const idx = nextSlides.findIndex((s) => s.id === op.slideId);
      if (idx < 0) throw new Error(`update_element_attributes slide target not found: ${op.slideId}`);
      const slide = nextSlides[idx];
      if (!slide) throw new Error(`update_element_attributes slide target not found: ${op.slideId}`);
      const updated = updateSlideElementAttributes({
        html: slide.html,
        elementId: op.elementId,
        attributes: op.attributes
      });
      nextSlides[idx] = {
        ...slide,
        html: updated.html,
        ...(updated.title ? { title: updated.title } : {})
      };
    } else if (op.op === 'replace_element_html') {
      const idx = nextSlides.findIndex((s) => s.id === op.slideId);
      if (idx < 0) throw new Error(`replace_element_html slide target not found: ${op.slideId}`);
      const slide = nextSlides[idx];
      if (!slide) throw new Error(`replace_element_html slide target not found: ${op.slideId}`);
      const updated = replaceSlideElementHtml({
        html: slide.html,
        css: slide.css,
        slideId: slide.id,
        elementId: op.elementId,
        replacementHtml: op.html
      });
      nextSlides[idx] = {
        ...slide,
        html: updated.html,
        ...(updated.title ? { title: updated.title } : {})
      };
    }
  }

  return { ...currentContent, slides: nextSlides };
}

async function prepareDeckForCommit(
  deck: GeneratedDeck,
  run: GenerationRun
): Promise<GeneratedDeck> {
  let chartColors: string[] | undefined;
  let fonts: GeneratedDeckFont[] = [];
  if (run.designSystemId) {
    const designSystemV2 = await loadDesignSystemDocumentV2(run.designSystemId);
    if (designSystemV2) {
      const designSystemDocument = projectV2ToLegacyDocument(designSystemV2);
      chartColors = designSystemDocument.tokens.colors.map((c) => c.value);
      fonts = await loadDesignSystemFontFaces(run.designSystemId, designSystemV2);
    }
  }
  const deckWithDesignSystemFonts = fonts.length > 0
    ? applyDesignSystemFontsToDeck(deck, fonts)
    : deck;
  const rendered = await renderDeckVisuals(deckWithDesignSystemFonts, { chartColors });
  return fonts.length > 0 ? { ...rendered, fonts } : rendered;
}

function applyDesignSystemFontsToDeck(deck: GeneratedDeck, fonts: GeneratedDeckFont[]): GeneratedDeck {
  const primaryFont = choosePrimaryGeneratedFont(fonts);
  if (!primaryFont) return deck;
  const family = cssString(primaryFont.fontFamily);
  const rootFontRule = `.pepetex-slide{font-family:"${family}",sans-serif;}`;

  return {
    ...deck,
    slides: deck.slides.map((slide) => {
      let css = rewriteFallbackFontFamilies(slide.css, primaryFont.fontFamily);
      const html = rewriteFallbackFontFamilies(slide.html, primaryFont.fontFamily);
      const usesDesignSystemFont = fonts.some((font) =>
        css.includes(font.fontFamily) || html.includes(font.fontFamily)
      );
      if (!usesDesignSystemFont) {
        css = `${rootFontRule}\n${css}`;
      }
      return {
        ...slide,
        html,
        css
      };
    })
  };
}

function choosePrimaryGeneratedFont(fonts: GeneratedDeckFont[]): GeneratedDeckFont | null {
  return fonts.find((font) => font.fontWeight === 400 || font.fontWeight === '400')
    ?? fonts.find((font) => font.fontWeight === 500 || font.fontWeight === '500')
    ?? fonts[0]
    ?? null;
}

function rewriteFallbackFontFamilies(value: string, fontFamily: string): string {
  const escaped = cssString(fontFamily);
  return value.replace(
    /font-family\s*:\s*([^;{}]*(?:Plus Jakarta Sans|system-ui|-apple-system|BlinkMacSystemFont|Segoe UI|Arial|Inter)[^;{}]*);/gi,
    `font-family:"${escaped}",sans-serif;`
  );
}

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function deriveFontFamilyAliases(fontFamily: string, filename?: string): string[] {
  const aliases = new Set<string>();
  for (const value of [fontFamily, filename ? filename.replace(/\.[^.]+$/, '') : '']) {
    const trimmed = value.trim().replace(/^["']|["']$/g, '');
    if (!trimmed) continue;
    const match = /^(.*?)[\s_-]+(regular|book|medium|semibold|semi-bold|bold|extrabold|extra-bold|black|heavy)$/i.exec(trimmed);
    if (!match?.[1] || !match[2]) continue;
    const prefix = match[1].trim();
    const style = match[2].replace(/[^a-z]/gi, '');
    if (new RegExp(`${style}$`, 'i').test(prefix.replace(/[^a-z0-9]/gi, ''))) {
      aliases.add(prefix);
    } else {
      aliases.add(`${prefix}${style[0]?.toUpperCase() ?? ''}${style.slice(1).toLowerCase()}`);
    }
  }
  aliases.delete(fontFamily);
  return [...aliases];
}

async function applyFullDeck(
  deckId: string,
  userId: string,
  deck: GeneratedDeck,
  revisionSource: DeckRevisionSource,
  revisionLabel: string,
  revisionSummary: string,
  titleFallbackInstruction?: string | null
): Promise<string> {
  const deckForCommit = normalizeGeneratedDeckTitleForCommit(deck, titleFallbackInstruction);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.deck.findUniqueOrThrow({
      where: { id: deckId },
      select: { currentRevisionNumber: true }
    });

    const nextRevisionNumber = Math.max(existing.currentRevisionNumber, 0) + 1;

    await tx.deck.update({
      where: { id: deckId },
      data: {
        title: deckForCommit.title,
        contentJson: asJsonInput(deckForCommit),
        currentRevisionNumber: nextRevisionNumber
      }
    });

    const revision = await tx.deckRevision.create({
      data: {
        deckId,
        revisionNumber: nextRevisionNumber,
        label: revisionLabel,
        source: revisionSource,
        summary: revisionSummary,
        deckJson: asJsonInput(deckForCommit),
        createdByUserId: userId
      }
    });

    return revision.id;
  });
}

function validateDeckForCommit(
  input: unknown,
  options: {
    assetUrls?: Record<string, string>;
    allowedAssetHosts?: string[];
    designSystemDocument?: DesignSystemDocument;
    requireSubstantialDeck?: boolean;
  } = {}
): {
  ok: boolean;
  deck?: GeneratedDeck;
  errors: string[];
  qualityWarnings: string[];
  report: Record<string, unknown>;
} {
  const schemaValidation = validateGeneratedDeck(input);
  if (!schemaValidation.ok) {
    return {
      ok: false,
      errors: schemaValidation.errors,
      qualityWarnings: [],
      report: {
        ok: false,
        stage: 'schema',
        errors: schemaValidation.errors
      }
    };
  }

  const contractResults = validateGeneratedDeckContract({
    deck: schemaValidation.value,
    ...(options.assetUrls ? { assetUrls: options.assetUrls } : {}),
    ...(options.allowedAssetHosts ? { allowedAssetHosts: options.allowedAssetHosts } : {})
  });
  const normalizedDeck: GeneratedDeck = {
    ...schemaValidation.value,
    slides: schemaValidation.value.slides.map((slide, index) => {
      const result = contractResults[index];
      return {
        ...slide,
        html: result?.normalizedHtml ?? slide.html,
        css: result?.normalizedCss ?? slide.css
      };
    })
  };
  const contractErrors = contractResults.flatMap((result, index) =>
    result.errors.map((error) => `slide ${index + 1}: ${error.message}`)
  );
  const contractWarnings = contractResults.flatMap((result, index) =>
    result.warnings.map((warning) => `slide ${index + 1}: ${warning.message}`)
  );
  const qualityReport = inspectDeckQuality(normalizedDeck, {
    requireSubstantialDeck: options.requireSubstantialDeck ?? false,
    minSlideCount: 6
  });
  const qualityErrors = qualityReport.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.slideId ? `${issue.slideId}: ${issue.message} Repair: ${issue.repairHint}` : `${issue.message} Repair: ${issue.repairHint}`);
  const qualityWarnings = qualityReport.issues
    .filter((issue) => issue.severity !== 'error')
    .map((issue) => issue.slideId ? `${issue.slideId}: ${issue.message}` : issue.message);

  const complianceIssues: string[] = [];
  if (options.designSystemDocument) {
    for (const slide of normalizedDeck.slides) {
      const issues = validateDesignSystemCompliance(slide, options.designSystemDocument);
      for (const issue of issues) {
        complianceIssues.push(`${slide.id}: ${issue.message}`);
      }
    }
  }

  const warnings = [...contractWarnings, ...qualityWarnings, ...complianceIssues];
  const errors = [...contractErrors, ...qualityErrors];

  return {
    ok: errors.length === 0,
    deck: normalizedDeck,
    errors,
    qualityWarnings,
    report: {
      ok: errors.length === 0,
      stage: 'html-contract',
      slideCount: normalizedDeck.slides.length,
      errors,
      warnings,
      qualityBlocking: qualityErrors.length > 0,
      quality: qualityReport
    }
  };
}

async function suspendGenerationRunWithAsk(
  generationRunId: string,
  suspendPayload: Record<string, unknown>
): Promise<void> {
  const question = String(suspendPayload.question ?? suspendPayload.reason ?? 'Clarification needed.');

  await recordGenerationMessage(generationRunId, 'ASSISTANT', question, {
    kind: 'ask',
    reason: suspendPayload.reason ?? null
  });

  await prisma.generationRun.update({
    where: { id: generationRunId },
    data: {
      status: 'WAITING_ASK',
      askQuestion: question,
      askOptionsJson: suspendPayload.options != null ? (suspendPayload.options as Prisma.InputJsonValue) : Prisma.DbNull,
      askAllowManualAnswer: suspendPayload.allowManualAnswer !== false
    }
  });
}

const agenticTextGenerationKinds = new Set(['AGENT_COMMAND']);
const legacyTextGenerationKinds = new Set(['FULL_DECK', 'SINGLE_SLIDE', 'REGENERATE_SLIDE', 'APPLY_COMMENTS', 'APPLY_TWEAKS']);

interface AgenticRuntimeState {
  completed: boolean;
  waitingForAsk: boolean;
  resultRevisionId: string | null;
  aiSummary: string | null;
  latestDraft: GeneratedDeck;
  latestCheckpointId: string | null;
  latestCheckpointSummary: string | null;
  rejectedDraftMutations: number;
  lastRejectedErrorSignature: string | null;
  consecutiveSameErrorCount: number;
  requiredCommentIds: Set<string>;
  addressedCommentIds: Set<string>;
}

export interface MastraStreamMirrorDiagnostics {
  chunkCount: number;
  lastChunkType?: string;
  finishReason?: string;
  lastStepFinishReason?: string;
  lastToolName?: string;
  lastToolStatus?: string;
  toolErrorMessages: string[];
}

export interface AgentStopDiagnosticInput extends Partial<MastraStreamMirrorDiagnostics> {
  draftSlideCount: number;
  latestCheckpointId?: string | null;
  latestCheckpointSummary?: string | null;
  committedFallback?: boolean;
  fallbackBlockedReason?: string;
  failedToolErrors?: string[];
}

class GenerationRunCancelledError extends Error {
  constructor(message = 'Generation run was cancelled by user request.') {
    super(message);
    this.name = 'GenerationRunCancelledError';
  }
}

function isGenerationRunCancelledError(error: unknown): error is GenerationRunCancelledError {
  return error instanceof GenerationRunCancelledError ||
    (error instanceof Error && error.name === 'GenerationRunCancelledError');
}

function isAgenticTextGenerationKind(kind: string): boolean {
  return agenticTextGenerationKinds.has(kind);
}

function isLegacyTextGenerationKind(kind: string): boolean {
  return legacyTextGenerationKinds.has(kind);
}

function getAgentNameForGenerationRunKind(_kind: string): 'pepeteXGenerationSupervisor' {
  return 'pepeteXGenerationSupervisor';
}

function isRecoverableRunningAgenticRun(run: GenerationRun): boolean {
  return isAgenticTextGenerationKind(run.kind)
    && run.status === 'RUNNING'
    && !run.completedAt
    && !run.resultRevisionId;
}

function createEmptyAgentDeck(title: string, language: string): GeneratedDeck {
  return {
    title: title.trim() || 'Untitled deck',
    language,
    aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080 },
    slides: []
  };
}

export function normalizeGeneratedDeckTitleForCommit(
  deck: GeneratedDeck,
  fallbackInstruction?: string | null
): GeneratedDeck {
  const currentTitle = deck.title.trim();

  if (!isGenericDeckTitle(currentTitle)) {
    return currentTitle === deck.title ? deck : { ...deck, title: currentTitle };
  }

  const fallbackTitle =
    deriveDeckTitleFromInstruction(fallbackInstruction) ??
    deriveDeckTitleFromSlides(deck.slides) ??
    (currentTitle || 'Untitled deck');

  return {
    ...deck,
    title: fallbackTitle
  };
}

function isGenericDeckTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase().replace(/[-_\s]+/g, ' ');
  return [
    '',
    'untitled',
    'untitled deck',
    'untitled presentation',
    'new deck',
    'new presentation',
    'presentation',
    'deck'
  ].includes(normalized);
}

function deriveDeckTitleFromInstruction(instruction?: string | null): string | null {
  const cleaned = instruction
    ?.replace(/\s+/g, ' ')
    .replace(/^[\s"'`]+|[\s"'`.]+$/g, '')
    .trim();

  if (!cleaned) return null;

  const withoutCommand = cleaned
    .replace(/^(please\s+)?(build|create|generate|make|draft|write|produce)\s+(a|an|the)?\s*/i, '')
    .replace(/^\d+\s*[- ]?slide\s+/i, '')
    .replace(/^deck\s+(for|about|on)\s+/i, '');
  const firstPhrase = withoutCommand.split(/[,.!?;:]/)[0]?.trim() ?? withoutCommand;
  const withoutDeckSuffix = firstPhrase
    .replace(/\b(deck|presentation|slides?|pptx?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const title = withoutDeckSuffix || firstPhrase.trim();

  if (!title) return null;

  return title.length > 80 ? `${title.slice(0, 77).trim()}...` : title;
}

function deriveDeckTitleFromSlides(slides: GeneratedSlide[]): string | null {
  const title = slides
    .map((slide) => slide.title.trim())
    .find((slideTitle) => slideTitle && !isGenericDeckTitle(slideTitle));

  if (!title) return null;
  return title.length > 80 ? `${title.slice(0, 77).trim()}...` : title;
}

async function generateFullDeckTitleForCommit(
  run: GenerationRun,
  deck: GeneratedDeck
): Promise<GeneratedDeck> {
  const shouldGenerateTitle =
    run.kind === 'FULL_DECK' ||
    (run.kind === 'AGENT_COMMAND' && isGenericDeckTitle(deck.title));
  if (!shouldGenerateTitle || !run.textProviderId || !run.textModelId) {
    return deck;
  }

  try {
    const providerCtx = await resolveProviderContext(run.textProviderId);
    const title = await generateDeckTitle({
      provider: {
        kind: providerCtx.kind,
        baseUrl: providerCtx.baseUrl,
        credential: providerCtx.credential,
        model: run.textModelId
      },
      instruction: run.manualInstruction,
      deck
    });

    return {
      ...deck,
      title
    };
  } catch (error) {
    console.warn('LLM deck title generation failed; falling back to generated/fallback title.', {
      generationRunId: run.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return deck;
  }
}

function normalizeDeckForAgent(value: unknown, title: string, language: string): GeneratedDeck {
  const validation = validateGeneratedDeck(value);
  if (!validation.ok) {
    return createEmptyAgentDeck(title, language);
  }

  return {
    ...validation.value,
    slides: validation.value.slides.map((slide) => ({
      ...slide,
      html: sanitizePersistedRenderedVisualHtml(slide.html)
    }))
  };
}

function cloneGeneratedDeck(deck: GeneratedDeck): GeneratedDeck {
  return JSON.parse(JSON.stringify(deck)) as GeneratedDeck;
}

function normalizeGeneratedSlide(slide: GeneratedSlide): GeneratedSlide {
  const normalizedHtml = normalizeGeneratedSlideHtmlForContract(slide);

  return {
    ...slide,
    html: normalizedHtml,
    css: slide.css ?? '',
    assets: Array.isArray(slide.assets) ? slide.assets : [],
    charts: Array.isArray(slide.charts) ? slide.charts : []
  };
}

function normalizeGeneratedSlideHtmlForContract(slide: GeneratedSlide): string {
  let html = slide.html
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<footer\b/gi, '<div')
    .replace(/<\/footer>/gi, '</div>');

  html = ensureSlideRootCanvasStyle(html);

  if (!/data-pepetex-type\s*=/.test(html)) {
    const safeSlideId = slide.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const addTargetAttributes = (tag: string, type: 'headline' | 'body' | 'card') => {
      const pattern = new RegExp(`<${tag}\\b(?![^>]*data-pepetex-id=)([^>]*)>`, 'i');
      const replacement = `<${tag} data-pepetex-id="el_${safeSlideId}_${type}" data-pepetex-type="${type}"$1>`;
      const nextHtml = html.replace(pattern, replacement);
      const changed = nextHtml !== html;
      html = nextHtml;
      return changed;
    };

    if (!addTargetAttributes('h1', 'headline') &&
        !addTargetAttributes('h2', 'headline') &&
        !addTargetAttributes('h3', 'headline') &&
        !addTargetAttributes('p', 'body')) {
      addTargetAttributes('div', 'card');
    }
  }

  return html;
}

function sanitizePersistedRenderedVisualHtml(html: string): string {
  return html
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/\sclass=(["'])[^"']*\bzr\d+-cls-\d+\b[^"']*\1/gi, '');
}

function ensureSlideRootCanvasStyle(html: string): string {
  return html.replace(/<(section|div)\b([^>]*)>/i, (match, tagName: string, attributes: string) => {
    const requiredStyle = 'position:relative;width:1920px;height:1080px;overflow:hidden;box-sizing:border-box;';
    const styleMatch = attributes.match(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/i);

    if (styleMatch) {
      const quote = styleMatch[1] ?? '"';
      const currentStyle = (styleMatch[2] ?? '').trim();
      const nextStyle = `${currentStyle}${currentStyle.endsWith(';') || currentStyle.length === 0 ? '' : ';'}${requiredStyle}`;
      const nextAttributes = attributes.replace(styleMatch[0], ` style=${quote}${nextStyle}${quote}`);
      return `<${tagName}${nextAttributes}>`;
    }

    return `<${tagName}${attributes} style="${requiredStyle}">`;
  });
}

function resolveInsertIndex(
  slides: GeneratedSlide[],
  input: { position: 'start' | 'end' | 'index' | 'before' | 'after'; index?: number; referenceSlideId?: string }
): number {
  if (input.position === 'start') return 0;
  if (input.position === 'end') return slides.length;
  if (input.position === 'index') return Math.min(Math.max(input.index ?? slides.length, 0), slides.length);

  const referenceIndex = input.referenceSlideId
    ? slides.findIndex((slide) => slide.id === input.referenceSlideId)
    : -1;

  if (referenceIndex < 0) return slides.length;
  return input.position === 'before' ? referenceIndex : referenceIndex + 1;
}

function buildWriteSlideCandidate(
  baseDeck: GeneratedDeck,
  run: GenerationRun,
  input: {
    slide: GeneratedSlide;
    operation: 'insert' | 'replace';
    position: 'start' | 'end' | 'index' | 'before' | 'after';
    index?: number;
    referenceSlideId?: string;
  }
): GeneratedDeck {
  const candidateDeck = cloneGeneratedDeck(baseDeck);
  const slide = normalizeGeneratedSlide(input.slide);

  if (input.operation === 'replace') {
    const targetSlideId = input.referenceSlideId ?? run.targetSlideId ?? slide.id;
    const targetIndex = candidateDeck.slides.findIndex((candidate) => candidate.id === targetSlideId);
    if (targetIndex < 0) {
      if (run.kind === 'FULL_DECK') {
        const insertIndex = resolveInsertIndex(candidateDeck.slides, { position: 'end' });
        candidateDeck.slides.splice(insertIndex, 0, slide);
        return candidateDeck;
      }

      throw new Error(`Cannot replace slide because target slide was not found: ${targetSlideId}`);
    }

    candidateDeck.slides[targetIndex] = { ...slide, id: targetSlideId };
    return candidateDeck;
  }

  if (candidateDeck.slides.some((candidate) => candidate.id === slide.id)) {
    throw new Error(`Cannot insert slide because slide id already exists: ${slide.id}`);
  }

  const insertIndex = resolveInsertIndex(candidateDeck.slides, input);
  candidateDeck.slides.splice(insertIndex, 0, slide);
  return candidateDeck;
}

function buildValidationResult(input: ReturnType<typeof validateDeckForCommit>, deck?: GeneratedDeck): PepeteXAgentValidationResult {
  const validatedDeck = input.deck ?? deck;
  const result: PepeteXAgentValidationResult = {
    ok: input.ok,
    errors: input.errors,
    warnings: input.qualityWarnings,
    report: input.report
  };

  return validatedDeck ? { ...result, deck: validatedDeck } : result;
}

function getRevisionMetadataForRun(run: GenerationRun, summary: string | null): {
  source: DeckRevisionSource;
  label: string;
  summary: string;
} {
  switch (run.kind) {
    case 'AGENT_COMMAND':
      if (getRunCommandIntent(run) === 'apply_comments') {
        return {
          source: DeckRevisionSource.AI_COMMENTS_APPLIED,
          label: 'AI applied comments',
          summary: summary ?? 'AI applied comments to the deck.'
        };
      }
      if (getRunCommandIntent(run) === 'apply_tweaks') {
        return {
          source: DeckRevisionSource.AI_TWEAKS_APPLIED,
          label: 'AI applied tweaks',
          summary: summary ?? 'AI applied tweaks to the deck.'
        };
      }
      return {
        source: DeckRevisionSource.AI_STUDIO_COMMAND,
        label: 'AI Studio command',
        summary: summary ?? 'AI completed a Studio command.'
      };
    case 'SINGLE_SLIDE':
      return {
        source: DeckRevisionSource.AI_SINGLE_SLIDE_INSERTED,
        label: 'AI single-slide insert',
        summary: summary ?? 'AI inserted a new slide.'
      };
    case 'REGENERATE_SLIDE':
      return {
        source: DeckRevisionSource.AI_SLIDE_REGENERATED,
        label: 'AI slide regeneration',
        summary: summary ?? 'AI regenerated a slide.'
      };
    case 'APPLY_COMMENTS':
      return {
        source: DeckRevisionSource.AI_COMMENTS_APPLIED,
        label: 'AI applied comments',
        summary: summary ?? 'AI applied comments to the deck.'
      };
    case 'APPLY_TWEAKS':
      return {
        source: DeckRevisionSource.AI_TWEAKS_APPLIED,
        label: 'AI applied tweaks',
        summary: summary ?? 'AI applied tweaks to the deck.'
      };
    default:
      return {
        source: DeckRevisionSource.AI_FULL_DECK_GENERATED,
        label: 'AI-generated deck',
        summary: summary ?? 'Full deck generated by AI.'
      };
  }
}

async function applySubmittedRefinementSideEffects(run: GenerationRun): Promise<void> {
  const commentIds = getSubmittedCommentIdsForRun(run);
  if (commentIds.length > 0) {

    await prisma.comment.updateMany({
      where: {
        deckId: run.deckId,
        id: { in: commentIds },
        status: 'SUBMITTED'
      },
      data: { status: 'APPLIED' }
    });
    return;
  }

  const tweakBatchId = getSubmittedTweakBatchIdForRun(run);
  if (tweakBatchId) {

    await prisma.tweakBatch.updateMany({
      where: { id: tweakBatchId, deckId: run.deckId, status: 'SUBMITTED' },
      data: { status: 'APPLIED', appliedAt: new Date() }
    });
  }
}

function getMissingAddressedCommentIds(requiredCommentIds: Set<string>, addressedCommentIds: Set<string>): string[] {
  return [...requiredCommentIds].filter((commentId) => !addressedCommentIds.has(commentId));
}

function buildMissingCommentCoverageMessage(missingCommentIds: string[]): string {
  return `Submitted comment id(s) were not addressed by accepted patch operations: ${missingCommentIds.join(', ')}. Apply the missing comments with commentIds before finishing.`;
}

export function buildRepeatedDraftErrorEscalation(repeatCount: number): string {
  return (
    `ESCALATION: this draft failed with the same validation error ${repeatCount} times in a row. ` +
    `Stop retrying the same fix — re-read each "Repair:" hint literally and change the exact attribute or value it names, not the styling or font size. ` +
    `Valid data-pepetex-type values are: ${allowedElementTypes.join(', ')}. ` +
    `The slide's single dominant title MUST use data-pepetex-type="headline" (not "header"/"title"). ` +
    `If you cannot satisfy a check after re-reading its repairHint, change the approach rather than re-emitting a near-identical slide.`
  );
}

function createWorkerAgentRuntime(input: {
  run: GenerationRun;
  currentDeck: GeneratedDeck;
  initialDraft: GeneratedDeck;
  assetUrls?: Record<string, string>;
  allowedAssetHosts?: string[];
  designSystemDocument?: DesignSystemDocument | undefined;
  submittedComments?: SubmittedComment[];
  submittedTweaks?: SubmittedTweak[];
}): { runtime: PepeteXAgentToolRuntime; state: AgenticRuntimeState } {
  const { run, currentDeck } = input;
  const baseValidationOptions = {
    ...(input.assetUrls && Object.keys(input.assetUrls).length > 0 ? { assetUrls: input.assetUrls } : {}),
    ...(input.allowedAssetHosts && input.allowedAssetHosts.length > 0 ? { allowedAssetHosts: input.allowedAssetHosts } : {}),
    ...(input.designSystemDocument ? { designSystemDocument: input.designSystemDocument } : {})
  };
  // Completeness check (min slide count) only at finish_generation, never during per-slide writes.
  const commitValidationOptions = {
    ...baseValidationOptions,
    ...(run.kind === 'FULL_DECK' ? { requireSubstantialDeck: true } : {})
  };
  const validationOptions = baseValidationOptions;
  let draftDeck = cloneGeneratedDeck(input.initialDraft);
  const state: AgenticRuntimeState = {
    completed: false,
    waitingForAsk: false,
    resultRevisionId: null,
    aiSummary: null,
    latestDraft: draftDeck,
    latestCheckpointId: null,
    latestCheckpointSummary: null,
    rejectedDraftMutations: 0,
    lastRejectedErrorSignature: null,
    consecutiveSameErrorCount: 0,
    requiredCommentIds: new Set((input.submittedComments ?? []).map((comment) => comment.id)),
    addressedCommentIds: new Set<string>()
  };

  async function validateAndMaybeSaveDraft(
    candidate: GeneratedDeck,
    summary: string,
    rawCandidate: unknown
  ) {
    await assertGenerationRunNotCancelled(run.id);
    const validation = validateDeckForCommit(candidate, validationOptions);
    if (!validation.ok || !validation.deck) {
      state.rejectedDraftMutations += 1;

      const errorSignature = [...validation.errors].sort().join('\n');
      if (errorSignature === state.lastRejectedErrorSignature) {
        state.consecutiveSameErrorCount += 1;
      } else {
        state.consecutiveSameErrorCount = 1;
        state.lastRejectedErrorSignature = errorSignature;
      }

      if (state.rejectedDraftMutations >= MAX_REJECTED_DRAFT_MUTATIONS) {
        throw new Error(`Agent produced too many invalid slide drafts. Last validation errors: ${validation.errors.join('; ')}`);
      }

      const result = buildValidationResult(validation, candidate);
      const escalatedResult =
        state.consecutiveSameErrorCount >= REPEATED_DRAFT_ERROR_ESCALATION_THRESHOLD
          ? { ...result, errors: [...result.errors, buildRepeatedDraftErrorEscalation(state.consecutiveSameErrorCount)] }
          : result;

      return {
        ...escalatedResult,
        deck: candidate,
        candidate: rawCandidate,
        summary
      };
    }

    await assertGenerationRunNotCancelled(run.id);
    draftDeck = validation.deck;
    state.rejectedDraftMutations = 0;
    state.lastRejectedErrorSignature = null;
    state.consecutiveSameErrorCount = 0;
    state.latestDraft = validation.deck;
    state.latestCheckpointId = await saveGenerationCheckpoint({
      runId: run.id,
      status: 'DRAFT',
      deck: validation.deck,
      summary,
      validation: validation.report
    });
    state.latestCheckpointSummary = summary;

    return {
      ...buildValidationResult(validation, validation.deck),
      checkpointId: state.latestCheckpointId,
      deck: validation.deck,
      candidate: rawCandidate,
      summary
    };
  }

  const runtime: PepeteXAgentToolRuntime = {
    getDraftDeck: () => cloneGeneratedDeck(draftDeck),
    getCurrentDeck: () => cloneGeneratedDeck(currentDeck),
    savePlan: async (plan) => ({ status: 'ok' as const, plan }),
    writeSlide: async (toolInput) => {
      await assertGenerationRunNotCancelled(run.id);
      const summary = toolInput.summary ?? `Agent wrote slide: ${toolInput.slide.title}`;
      try {
        const candidate = buildWriteSlideCandidate(draftDeck, run, toolInput);
        return validateAndMaybeSaveDraft(candidate, summary, toolInput.slide);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          errors: [message],
          warnings: [],
          report: { ok: false, stage: 'draft-mutation', errors: [message] },
          deck: draftDeck,
          candidate: toolInput.slide,
          summary
        };
      }
    },
    patchSlide: async (toolInput) => {
      await assertGenerationRunNotCancelled(run.id);
      const summary = toolInput.summary ?? 'Agent patched the deck draft.';
      try {
        const candidate = applyDeckPatchToContent(draftDeck, toolInput.patch);
        const result = await validateAndMaybeSaveDraft(candidate, summary, toolInput.patch);
        const submittedComments = input.submittedComments ?? [];
        if (submittedComments.length > 0 && result.ok) {
          for (const commentId of collectDeckPatchCoveredCommentIds(toolInput.patch, submittedComments)) {
            state.addressedCommentIds.add(commentId);
          }
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          errors: [message],
          warnings: [],
          report: { ok: false, stage: 'draft-mutation', errors: [message] },
          deck: draftDeck,
          candidate: toolInput.patch,
          summary
        };
      }
    },
    validateSlide: async (toolInput) => {
      await assertGenerationRunNotCancelled(run.id);
      if (toolInput.candidate) {
        const candidateDeck = cloneGeneratedDeck(draftDeck);
        const targetSlideId = toolInput.slideId ?? run.targetSlideId ?? toolInput.candidate.id;
        const targetIndex = candidateDeck.slides.findIndex((slide) => slide.id === targetSlideId);
        if (targetIndex >= 0) {
          candidateDeck.slides[targetIndex] = { ...normalizeGeneratedSlide(toolInput.candidate), id: targetSlideId };
        } else {
          candidateDeck.slides.push(normalizeGeneratedSlide(toolInput.candidate));
        }
        return buildValidationResult(validateDeckForCommit(candidateDeck, validationOptions), candidateDeck);
      }

      return buildValidationResult(validateDeckForCommit(draftDeck, validationOptions), draftDeck);
    },
    validateDeck: async () => {
      await assertGenerationRunNotCancelled(run.id);
      return buildValidationResult(validateDeckForCommit(draftDeck, validationOptions), draftDeck);
    },
    finishGeneration: async (toolInput) => {
      await assertGenerationRunNotCancelled(run.id);
      if (state.completed) {
        return {
          ok: true,
          errors: [],
          warnings: [],
          report: { ok: true, alreadyCompleted: true },
          deck: draftDeck,
          completed: true,
          ...(state.resultRevisionId ? { revisionId: state.resultRevisionId } : {}),
          summary: state.aiSummary ?? toolInput.summary
        };
      }

      const missingCommentIds = getMissingAddressedCommentIds(state.requiredCommentIds, state.addressedCommentIds);
      if (missingCommentIds.length > 0) {
        const message = buildMissingCommentCoverageMessage(missingCommentIds);
        return {
          ok: false,
          errors: [message],
          warnings: [],
          report: { ok: false, stage: 'comment-coverage', errors: [message] },
          deck: draftDeck,
          completed: false,
          summary: toolInput.summary
        };
      }

      const validation = validateDeckForCommit(draftDeck, commitValidationOptions);
      if (!validation.ok || !validation.deck) {
        return {
          ...buildValidationResult(validation, draftDeck),
          completed: false,
          summary: toolInput.summary ?? 'Final validation failed; generation was not committed.'
        };
      }

      if (validation.deck.slides.length === 0) {
        return {
          ok: false,
          errors: ['Draft deck has no slides to commit.'],
          warnings: [],
          report: { ok: false, stage: 'final-commit', errors: ['Draft deck has no slides to commit.'] },
          deck: validation.deck,
          completed: false,
          summary: toolInput.summary ?? 'Final validation failed; generation was not committed.'
        };
      }

      const summary = toolInput.summary;
    await assertGenerationRunNotCancelled(run.id);
      const checkpointId = await saveGenerationCheckpoint({
        runId: run.id,
        status: 'VALIDATED',
        deck: validation.deck,
        summary,
        validation: validation.report
      });
      const revisionMetadata = getRevisionMetadataForRun(run, summary);
      await assertGenerationRunNotCancelled(run.id);
      const deckForCommit = await generateFullDeckTitleForCommit(
        run,
        await prepareDeckForCommit(validation.deck, run)
      );
      const resultRevisionId = await applyFullDeck(
        run.deckId,
        run.createdByUserId,
        deckForCommit,
        revisionMetadata.source,
        revisionMetadata.label,
        revisionMetadata.summary,
        run.manualInstruction
      );

      await markGenerationCheckpointCommitted(checkpointId, resultRevisionId);
      await applySubmittedRefinementSideEffects(run);

      await prisma.deck.update({
        where: { id: run.deckId },
        data: {
          ...(run.textProviderId ? { lastUsedTextProviderId: run.textProviderId } : {}),
          ...(run.textModelId ? { lastUsedTextModelId: run.textModelId } : {})
        }
      });

      const completeUpdate = await prisma.generationRun.updateMany({
        where: { id: run.id, status: { not: 'CANCELLED' } },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          resultRevisionId,
          aiSummary: summary,
          pendingAskAnswer: null,
          askQuestion: null,
          askOptionsJson: Prisma.DbNull
        }
      });

      if (completeUpdate.count === 0) {
        throw new GenerationRunCancelledError();
      }

      state.completed = true;
      state.resultRevisionId = resultRevisionId;
      state.aiSummary = summary;
      state.latestDraft = validation.deck;

      return {
        ...buildValidationResult(validation, validation.deck),
        completed: true,
        revisionId: resultRevisionId,
        summary
      };
    }
  };

  return { runtime, state };
}

function getAgentToolLabel(toolName: string): string {
  switch (toolName) {
    case 'request_clarification':
      return 'Asking a clarification';
    case 'request_approval':
      return 'Requesting approval';
    case 'read_deck_state':
      return 'Reading deck state';
    case 'plan_deck':
      return 'Planning the deck';
    case 'read_design_system':
      return 'Reading design system';
    case 'list_reference_files':
      return 'Listing reference files';
    case 'read_reference_file':
      return 'Reading a reference file';
    case 'write_slide':
      return 'Writing slide HTML';
    case 'patch_slide':
      return 'Patching slide content';
    case 'validate_slide':
      return 'Validating a slide';
    case 'validate_deck':
      return 'Validating the deck';
    case 'finish_generation':
      return 'Committing deck revision';
    case 'updateWorkingMemory':
      return 'Updating agent memory';
    case 'agent-intentPlannerAgent':
      return 'Delegating to intent planner';
    case 'agent-deckAnalystAgent':
      return 'Delegating to deck analyst';
    case 'agent-contentCandidateAgent':
      return 'Delegating to content candidate advisor';
    case 'agent-patchAdvisorAgent':
      return 'Delegating to patch advisor';
    default:
      return toolName.replace(/_/g, ' ');
  }
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

function extractFinishReason(value: unknown, depth = 0): string | undefined {
  if (!value || typeof value !== 'object' || depth > 2) return undefined;
  const record = value as Record<string, unknown>;

  for (const key of ['finishReason', 'finish_reason', 'stopReason', 'stop_reason', 'reason']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }

  for (const key of ['output', 'response', 'result']) {
    const nested = extractFinishReason(record[key], depth + 1);
    if (nested) return nested;
  }

  return undefined;
}

async function getAgentStopToolDiagnostics(runId: string): Promise<Pick<AgentStopDiagnosticInput, 'lastToolName' | 'lastToolStatus' | 'failedToolErrors'>> {
  const [lastTool, failedTools] = await Promise.all([
    prisma.generationToolCall.findFirst({
      where: { runId },
      orderBy: { createdAt: 'desc' },
      select: { name: true, status: true, errorMessage: true }
    }),
    prisma.generationToolCall.findMany({
      where: {
        runId,
        status: 'FAILED',
        errorMessage: { not: null }
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { name: true, errorMessage: true }
    })
  ]);

  return {
    ...(lastTool ? { lastToolName: lastTool.name, lastToolStatus: lastTool.status } : {}),
    failedToolErrors: failedTools
      .map((tool) => tool.errorMessage ? `${tool.name}: ${tool.errorMessage}` : null)
      .filter((message): message is string => !!message)
  };
}

async function tryCommitLatestValidAgentDraft(input: {
  run: GenerationRun;
  state: AgenticRuntimeState;
  assetUrls: Record<string, string>;
  diagnostics: AgentStopDiagnosticInput;
}): Promise<{ committed: boolean; message: string }> {
  await assertGenerationRunNotCancelled(input.run.id);
  const draftSlideCount = input.state.latestDraft.slides.length;
  const baseDiagnostics: AgentStopDiagnosticInput = {
    ...input.diagnostics,
    draftSlideCount,
    latestCheckpointId: input.state.latestCheckpointId,
    latestCheckpointSummary: input.state.latestCheckpointSummary
  };

  if (!input.state.latestCheckpointId || draftSlideCount === 0) {
    return {
      committed: false,
      message: buildAgentStoppedBeforeFinishMessage({
        ...baseDiagnostics,
        fallbackBlockedReason: 'no valid draft checkpoint was saved'
      })
    };
  }

  const missingCommentIds = getMissingAddressedCommentIds(input.state.requiredCommentIds, input.state.addressedCommentIds);
  if (missingCommentIds.length > 0) {
    return {
      committed: false,
      message: buildAgentStoppedBeforeFinishMessage({
        ...baseDiagnostics,
        fallbackBlockedReason: buildMissingCommentCoverageMessage(missingCommentIds)
      })
    };
  }

  const validation = validateDeckForCommit(input.state.latestDraft, {
    ...(Object.keys(input.assetUrls).length > 0 ? { assetUrls: input.assetUrls } : {})
  });

  if (!validation.ok || !validation.deck) {
    return {
      committed: false,
      message: buildAgentStoppedBeforeFinishMessage({
        ...baseDiagnostics,
        fallbackBlockedReason: `latest draft failed final validation: ${validation.errors.join('; ')}`
      })
    };
  }

  const summary = [
    `Partial deck committed from the latest valid draft because the agent stream ended before final commit. Saved ${draftSlideCount} slide${draftSlideCount === 1 ? '' : 's'}.`,
    input.state.latestCheckpointSummary ? `Latest accepted draft: ${input.state.latestCheckpointSummary}` : null
  ].filter(Boolean).join(' ');
  await assertGenerationRunNotCancelled(input.run.id);
  const checkpointId = await saveGenerationCheckpoint({
    runId: input.run.id,
    status: 'VALIDATED',
    deck: validation.deck,
    summary,
    validation: validation.report
  });
  const revisionMetadata = getRevisionMetadataForRun(input.run, summary);
  await assertGenerationRunNotCancelled(input.run.id);
  const deckForCommit = await generateFullDeckTitleForCommit(
    input.run,
    await prepareDeckForCommit(validation.deck, input.run)
  );
  const resultRevisionId = await applyFullDeck(
    input.run.deckId,
    input.run.createdByUserId,
    deckForCommit,
    revisionMetadata.source,
    revisionMetadata.label,
    revisionMetadata.summary,
    input.run.manualInstruction
  );

  await markGenerationCheckpointCommitted(checkpointId, resultRevisionId);
  await applySubmittedRefinementSideEffects(input.run);
  await prisma.deck.update({
    where: { id: input.run.deckId },
    data: {
      ...(input.run.textProviderId ? { lastUsedTextProviderId: input.run.textProviderId } : {}),
      ...(input.run.textModelId ? { lastUsedTextModelId: input.run.textModelId } : {})
    }
  });
  const completeUpdate = await prisma.generationRun.updateMany({
    where: { id: input.run.id, status: { not: 'CANCELLED' } },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      resultRevisionId,
      aiSummary: summary,
      pendingAskAnswer: null,
      askQuestion: null,
      askOptionsJson: Prisma.DbNull
    }
  });

  if (completeUpdate.count === 0) {
    throw new GenerationRunCancelledError();
  }

  input.state.completed = true;
  input.state.resultRevisionId = resultRevisionId;
  input.state.aiSummary = summary;
  input.state.latestDraft = validation.deck;

  const message = buildAgentStoppedBeforeFinishMessage({
    ...baseDiagnostics,
    committedFallback: true
  });

  await recordGenerationMessage(input.run.id, 'SYSTEM', message, {
    kind: 'agent_stop_fallback_commit',
    revisionId: resultRevisionId,
    draftSlideCount,
    diagnostics: baseDiagnostics
  });
  console.warn('GenerationRun committed latest valid draft after agent stopped before finish_generation.', {
    generationRunId: input.run.id,
    resultRevisionId,
    draftSlideCount,
    finishReason: input.diagnostics.finishReason ?? input.diagnostics.lastStepFinishReason
  });

  return { committed: true, message };
}

async function getLatestSuspendedMastraToolCallId(runId: string): Promise<string | undefined> {
  const toolCall = await prisma.generationToolCall.findFirst({
    where: {
      runId,
      name: 'request_clarification',
      mastraToolCallId: { not: null }
    },
    orderBy: { createdAt: 'desc' },
    select: { mastraToolCallId: true }
  });

  return toolCall?.mastraToolCallId ?? undefined;
}

/**
 * Reads ephemeral image attachments stored on the run's most recent USER message.
 * These are passed to the model as multimodal content for that turn only (not persisted
 * as managed reference files). See submitGenerationRun which writes metadata.attachments.
 */
async function loadRunImageAttachments(runId: string): Promise<AgentImageAttachment[]> {
  const message = await prisma.generationMessage.findFirst({
    where: { runId, role: 'USER' },
    orderBy: { createdAt: 'desc' },
    select: { metadata: true }
  });
  return parseImageAttachments(message?.metadata);
}

function buildAgentPrompt(input: {
  run: GenerationRun;
  deckTitle: string;
  promptInput: Record<string, unknown>;
  comments: unknown[];
  tweaks: unknown[];
  isResume: boolean;
}): string {
  const { run, promptInput } = input;
  const sanitizedPromptInput = {
    ...promptInput,
    referenceFiles: Array.isArray(promptInput.referenceFiles)
      ? (promptInput.referenceFiles as Array<Record<string, unknown>>).map((file) => ({
          id: file.id,
          assetId: file.assetId,
          source: file.source,
          role: file.role,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          imageWidth: file.imageWidth,
          imageHeight: file.imageHeight,
          attachedToModel: file.attachedToModel,
          attachmentMode: file.attachmentMode,
          attachmentReason: file.attachmentReason,
          usageHint: file.usageHint
        }))
      : undefined
  };

  return [
    input.isResume
      ? 'Continue this suspended PepeteX generation run from the user clarification. Use the same tools and finish only after validation and commit.'
      : 'Run this PepeteX generation autonomously as a chat-like supervisor agent. Clarify only when the missing information blocks a safe result.',
    getPepeteXAppBehaviorContract(),
    getPepeteXRunModeContract(),
    getPepeteXPatchOperationContract(),
    getPepeteXAgentToolContract(),
    'You must use tools for deck state, writing or patching, validation, and final commit. Keep planning in natural-language model output unless a planning tool is explicitly available. Do not claim completion until finish_generation returns completed true.',
    'Clarification gate: before writing any slide, decide whether the user supplied enough concrete facts to avoid a generic placeholder deck. If not, call request_clarification with 3 to 5 selectable options and allowManualAnswer true, then stop until the user answers.',
    'Broad business prompts must ask first. For pitch deck, investor, angel investor, fundraising, sales, strategy, or business-plan decks, missing company name, product, customer, stage, traction, funding ask, or use of funds is blocking context. Do not invent those details or generate a placeholder company.',
    'Visible transcript rule: your text deltas are shown directly to the user. Keep each spoken note to one or two concise user-facing sentences and never include scratchpad/self-correction phrases such as "wait", "actually", or "I already".',
    'Design gate: each write_slide candidate must include substantial slide.css. The CSS must style .pepetex-slide as a fixed 1920px by 1080px presentation canvas with position: relative, overflow: hidden, explicit layout, typography, spacing, background or gradient, visual surfaces, and at least one meaningful visual anchor. Plain stacked HTML with empty CSS will be rejected.',
    'Tool pacing rule: never batch multiple write_slide calls in one model turn. Write exactly one slide, wait for the tool result, repair if needed, then continue. This keeps long deck generation resumable and prevents context blow-ups.',
    'Design system rule: when a selected design system exists, use it style-first. Follow tokens, examples, archetypes, assets, and rules as brand direction, but adapt layouts to the slide message. Do not copy weak generated components literally or repeat one template across the deck.',
    'Chart rule: use structured charts for comparison, allocation, trend, funnel, traction, market, benchmark, or progress slides when useful. The chart container must use data-pepetex-id, data-pepetex-type="chart", and data-pepetex-chart-id matching slide.charts[].id. If using dummy data because exact data is missing, label it subtly and set sourceRef to "Illustrative model estimate".',
    'Use export-safe HTML/CSS creativity: CSS shapes, SVG illustrations, metric cards, timelines, comparison grids, diagrams, badges, gradients, shadows, and varied compositions. Keep text concise and design for visual communication.',
    `Generation kind: ${run.kind}`,
    `Command intent: ${getRunCommandIntent(run) ?? 'infer_from_request'}`,
    buildActiveRunScopeInstruction(run),
    `Deck title: ${input.deckTitle}`,
    isGenericDeckTitle(input.deckTitle)
      ? 'Deck title instruction: choose a concise, specific deck title from the manual instruction; do not keep "Untitled deck".'
      : 'Deck title instruction: keep the existing deck title unless the user clearly asks for a rename.',
    `Language code: ${run.languageCode}`,
    run.targetSlideId ? `Target slide id: ${run.targetSlideId}` : 'Target slide id: none',
    run.targetElementId ? `Target element id: ${run.targetElementId}` : 'Target element id: none',
    run.slideInstruction ? `Slide instruction: ${run.slideInstruction}` : 'Slide instruction: none',
    run.manualInstruction ? `Manual instruction: ${run.manualInstruction}` : 'Manual instruction: none',
    run.commandContextJson ? `Studio command context: ${JSON.stringify(run.commandContextJson)}` : 'Studio command context: none',
    input.comments.length > 0 ? `Submitted comments: ${JSON.stringify(input.comments)}` : 'Submitted comments: none',
    input.tweaks.length > 0 ? `Submitted tweaks: ${JSON.stringify(input.tweaks)}` : 'Submitted tweaks: none',
    `Prepared prompt context: ${JSON.stringify(sanitizedPromptInput)}`
  ].join('\n\n');
}

function buildActiveRunScopeInstruction(run: GenerationRun): string {
  const intent = getRunCommandIntent(run);
  const base = [
    'Active run scope: AGENT_COMMAND. This is the only active text-generation run mode and may represent deck creation, slide insertion, selected-slide regeneration, targeted element editing, deletion/reordering, feedback application, or a mixed bounded patch.',
    'Always read deck state before mutating. Use targetSlideId/targetElementId and commandContext for phrases like "this slide" or "this element". If the deck is empty or the request asks for a complete deck, create the requested deck. If the deck already has slides and the user asks for a bounded change, preserve unrelated slides and elements.',
    'Ask a clarification when the requested target or destructive/broad rewrite is ambiguous.'
  ];

  if (intent === 'apply_comments') {
    base.push('Command intent apply_comments: apply only the submitted comments from read_deck_state. Include commentIds on patch operations and cover every submitted comment before finish_generation. Do not treat unrelated validator warnings as requested work.');
  } else if (intent === 'apply_tweaks') {
    base.push('Command intent apply_tweaks: apply only the submitted tweak batch from read_deck_state and honor each tweak scope: DECK, SLIDE, or ELEMENT.');
  }

  return base.join(' ');
}

async function mirrorMastraAgentStream(input: {
  run: GenerationRun;
  stream: { fullStream: unknown };
  state: AgenticRuntimeState;
}): Promise<MastraStreamMirrorDiagnostics> {
  const activeToolCalls = new Map<string, string>();
  const diagnostics: MastraStreamMirrorDiagnostics = {
    chunkCount: 0,
    toolErrorMessages: []
  };
  let assistantText = '';
  let assistantMessageId: string | null = null;
  let lastAssistantFlushAt = 0;
  let lastAssistantFlushLength = 0;

  function resetAssistantBubble(): void {
    assistantText = '';
    assistantMessageId = null;
    lastAssistantFlushAt = 0;
    lastAssistantFlushLength = 0;
  }

  async function flushAssistantText(final = false, force = false): Promise<void> {
    const content = final ? assistantText.trim() : assistantText.trimStart();
    if (!content.trim()) return;

    const now = Date.now();
    const shouldFlush =
      final ||
      force ||
      !assistantMessageId ||
      now - lastAssistantFlushAt >= 750 ||
      content.length - lastAssistantFlushLength >= 240;

    if (!shouldFlush) return;

    const metadata = { kind: 'agent_stream_text', streaming: !final };
    if (!assistantMessageId) {
      assistantMessageId = await createGenerationMessage(input.run.id, 'ASSISTANT', content, metadata);
    } else {
      await prisma.generationMessage.update({
        where: { id: assistantMessageId },
        data: {
          content,
          metadata: asUnknownJsonInput(metadata)
        }
      });
    }

    lastAssistantFlushAt = now;
    lastAssistantFlushLength = content.length;
  }

  async function closeAssistantBubble(): Promise<void> {
    await flushAssistantText(true, true);
    resetAssistantBubble();
  }

  await assertGenerationRunNotCancelled(input.run.id);

  for await (const chunk of input.stream.fullStream as AsyncIterable<{ type?: string; payload?: unknown; object?: unknown }>) {
    await assertGenerationRunNotCancelled(input.run.id);
    diagnostics.chunkCount += 1;
    if (typeof chunk.type === 'string') diagnostics.lastChunkType = chunk.type;
    const payload = chunk.payload as Record<string, unknown> | undefined;

    if (chunk.type === 'text-delta' && payload && typeof payload.text === 'string') {
      assistantText += payload.text;
      await flushAssistantText();
      continue;
    }

    if (chunk.type === 'routing-agent-text-delta' && payload && typeof payload.text === 'string') {
      assistantText += payload.text;
      await flushAssistantText();
      continue;
    }

    if (chunk.type === 'tool-call' && payload) {
      await closeAssistantBubble();
      const toolCallId = String(payload.toolCallId ?? '');
      const toolName = String(payload.toolName ?? 'tool');
      diagnostics.lastToolName = toolName;
      diagnostics.lastToolStatus = 'RUNNING';
      const dbToolCallId = await startGenerationToolCall(
        input.run.id,
        toolName,
        getAgentToolLabel(toolName),
        payload.args,
        toolCallId || undefined
      );
      if (toolCallId) activeToolCalls.set(toolCallId, dbToolCallId);
      continue;
    }

    if (chunk.type === 'tool-result' && payload) {
      await closeAssistantBubble();
      const toolCallId = String(payload.toolCallId ?? '');
      const toolName = String(payload.toolName ?? 'tool');
      const dbToolCallId = activeToolCalls.get(toolCallId)
        ?? await startGenerationToolCall(input.run.id, toolName, getAgentToolLabel(toolName), payload.args, toolCallId || undefined);
      const status = getToolResultStatus(payload.result, payload.isError);
      diagnostics.lastToolName = toolName;
      diagnostics.lastToolStatus = status;
      const toolErrorMessage = payload.isError
        ? String(payload.result ?? 'Tool execution failed.')
        : status === 'FAILED'
          ? getToolResultErrorMessage(payload.result)
          : undefined;
      if (toolErrorMessage) diagnostics.toolErrorMessages.push(`${toolName}: ${toolErrorMessage}`);
      await finishGenerationToolCall(
        dbToolCallId,
        status,
        payload.result,
        toolErrorMessage
      );
      continue;
    }

    if (chunk.type === 'tool-error' && payload) {
      await closeAssistantBubble();
      const toolCallId = String(payload.toolCallId ?? '');
      const toolName = String(payload.toolName ?? 'tool');
      const message = payload.error instanceof Error ? payload.error.message : String(payload.error ?? 'Tool execution failed.');
      diagnostics.lastToolName = toolName;
      diagnostics.lastToolStatus = 'FAILED';
      diagnostics.toolErrorMessages.push(`${toolName}: ${message}`);
      const dbToolCallId = activeToolCalls.get(toolCallId)
        ?? await startGenerationToolCall(input.run.id, toolName, getAgentToolLabel(toolName), undefined, toolCallId || undefined);
      await finishGenerationToolCall(dbToolCallId, 'FAILED', undefined, message);
      continue;
    }

    if ((chunk.type === 'tool-call-suspended' || chunk.type === 'agent-execution-suspended') && payload) {
      await closeAssistantBubble();
      const toolCallId = String(payload.toolCallId ?? '');
      const toolName = String(payload.toolName ?? 'request_clarification');
      diagnostics.lastToolName = toolName;
      diagnostics.lastToolStatus = 'SUSPENDED';
      const dbToolCallId = activeToolCalls.get(toolCallId)
        ?? await startGenerationToolCall(input.run.id, toolName, getAgentToolLabel(toolName), payload.args, toolCallId || undefined);
      await finishGenerationToolCall(dbToolCallId, 'COMPLETED', { status: 'waiting_ask', suspendPayload: payload.suspendPayload });
      input.state.waitingForAsk = true;
      await suspendGenerationRunWithAsk(input.run.id, (payload.suspendPayload ?? payload) as Record<string, unknown>);
      continue;
    }

    if (chunk.type === 'step-finish' && payload) {
      const finishReason = extractFinishReason(payload);
      if (finishReason) {
        diagnostics.lastStepFinishReason = finishReason;
        diagnostics.finishReason = diagnostics.finishReason ?? finishReason;
      }
      const usage = extractUsageTokens((payload.output as Record<string, unknown> | undefined)?.usage ?? payload.totalUsage);
      await prisma.generationRun.update({
        where: { id: input.run.id },
        data: {
          agentStepCount: { increment: 1 },
          inputTokensUsed: { increment: usage.inputTokens },
          outputTokensUsed: { increment: usage.outputTokens }
        }
      });
      continue;
    }

    if (chunk.type === 'finish' && payload) {
      const finishReason = extractFinishReason(payload);
      if (finishReason) diagnostics.finishReason = finishReason;
      continue;
    }

    if (chunk.type === 'error' && payload) {
      const error = payload.error instanceof Error ? payload.error : new Error(String(payload.error ?? 'Mastra stream error.'));
      diagnostics.toolErrorMessages.push(`stream: ${error.message}`);
      throw error;
    }
  }

  await closeAssistantBubble();
  return diagnostics;
}

async function runAgenticTextGenerationRun(run: GenerationRun): Promise<void> {
  if (!run.textProviderId) {
    throw new Error('No text provider configured for this generation run.');
  }
  if (!run.textModelId) {
    throw new Error('No text model configured for this generation run.');
  }

  const deck = await prisma.deck.findUniqueOrThrow({
    where: { id: run.deckId },
    select: { contentJson: true, title: true, workspaceId: true }
  });
  const currentDeck = normalizeDeckForAgent(deck.contentJson, deck.title, run.languageCode);
  const initialDraft = currentDeck;
  const deckJson = deck.contentJson ? JSON.stringify(deck.contentJson) : undefined;

  const providerCtx = await resolveProviderContext(run.textProviderId);
  const languageModel = createAgentLanguageModel({
    kind: providerCtx.kind,
    model: run.textModelId,
    ctx: {
      baseUrl: providerCtx.baseUrl,
      credential: providerCtx.credential
    }
  });
  const promptBuild = await buildPromptInputForRun(run, deckJson, {
    providerId: run.textProviderId,
    kind: providerCtx.kind,
    baseUrl: providerCtx.baseUrl,
    credential: providerCtx.credential
  });
  const { assetUrls, assets: availableAssets } = promptBuild;
  let promptInput = promptBuild.promptInput;
  promptInput = await compactPromptInputForRun(run, promptInput, {
    kind: providerCtx.kind,
    baseUrl: providerCtx.baseUrl,
    credential: providerCtx.credential,
    model: run.textModelId
  });
  const comments = await loadSubmittedCommentsForRun(run);
  const tweakPayload = await loadSubmittedTweaksForRun(run);
  const tweaks = tweakPayload.tweaks;
  const referenceFiles = Array.isArray(promptInput.referenceFiles)
    ? (promptInput.referenceFiles as Array<Record<string, unknown>>).map((file) => ({
        id: String(file.id ?? ''),
        assetId: typeof file.assetId === 'string' ? file.assetId : null,
        source: typeof file.source === 'string' ? file.source : null,
        role: typeof file.role === 'string' ? file.role : null,
        originalFilename: String(file.originalFilename ?? file.filename ?? 'reference file'),
        mimeType: String(file.mimeType ?? 'application/octet-stream'),
        sizeBytes: Number(file.sizeBytes ?? 0),
        imageWidth: typeof file.imageWidth === 'number' ? file.imageWidth : null,
        imageHeight: typeof file.imageHeight === 'number' ? file.imageHeight : null,
        attachedToModel: typeof file.attachedToModel === 'boolean' ? file.attachedToModel : null,
        attachmentMode: typeof file.attachmentMode === 'string' ? file.attachmentMode : null,
        attachmentReason: typeof file.attachmentReason === 'string' ? file.attachmentReason : null,
        usageHint: typeof file.usageHint === 'string' ? file.usageHint : null,
        summary: typeof file.summary === 'string' ? file.summary : null,
        textExcerpt: typeof file.textExcerpt === 'string' ? file.textExcerpt : null
      }))
    : undefined;
  const memoryIds = createPepeteXMastraMemoryIds({ deckId: run.deckId, runId: run.id });
  const agentName = getAgentNameForGenerationRunKind(run.kind);
  const designSystemDocument = run.designSystemId
    ? await loadDesignSystemDocument(run.designSystemId)
    : undefined;
  const { runtime, state } = createWorkerAgentRuntime({
    run,
    currentDeck,
    initialDraft,
    assetUrls,
    designSystemDocument,
    submittedComments: comments,
    submittedTweaks: tweaks
  });
  const requestContext = createPepeteXAgentRequestContext({
    runId: run.id,
    deckId: run.deckId,
    workspaceId: run.workspaceId,
    actorUserId: run.createdByUserId,
    generationKind: 'AGENT_COMMAND',
    languageCode: run.languageCode,
    manualInstruction: run.manualInstruction ?? undefined,
    targetSlideId: run.targetSlideId ?? undefined,
    targetElementId: run.targetElementId ?? undefined,
    slideInstruction: run.slideInstruction ?? undefined,
    commandContext: run.commandContextJson ?? undefined,
    customPromptText: typeof promptInput.customPromptInstruction === 'string' ? promptInput.customPromptInstruction : undefined,
    comments,
    tweaks,
    deckState: currentDeck,
    selectedDesignSystem: promptInput.designSystemInstruction,
    referenceFiles,
    assets: availableAssets.map((a) => ({
      id: a.id,
      role: a.role,
      originalFilename: a.originalFilename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      imageWidth: a.imageWidth,
      imageHeight: a.imageHeight
    })),
    provider: {
      kind: providerCtx.kind,
      providerId: run.textProviderId,
      modelId: run.textModelId,
      providerName: undefined,
      ctx: {
        baseUrl: providerCtx.baseUrl,
        credential: providerCtx.credential
      }
    },
    languageModel,
    runtime
  });
  requestContext.set(MASTRA_RESOURCE_ID_KEY, memoryIds.resourceId);
  requestContext.set(MASTRA_THREAD_ID_KEY, memoryIds.threadId);

  const runningUpdate = await prisma.generationRun.updateMany({
    where: { id: run.id, status: { not: 'CANCELLED' } },
    data: {
      status: 'RUNNING',
      startedAt: run.startedAt ?? new Date(),
      mastraResourceId: memoryIds.resourceId,
      mastraThreadId: memoryIds.threadId,
      agentMode: agentName,
      pendingAskAnswer: null,
      askQuestion: null,
      askOptionsJson: Prisma.DbNull
    }
  });

  if (runningUpdate.count === 0) {
    throw new GenerationRunCancelledError();
  }

  await prisma.generationToolCall.updateMany({
    where: { runId: run.id, status: 'RUNNING' },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      errorMessage: 'Superseded by a restarted agent attempt.'
    }
  });

  const mastra = createPepeteXMastra({
    databaseUrl: config.databaseUrl,
    disableTelemetry: config.disableExternalTelemetry,
    agentMemoryModel: languageModel,
    agentInputTokenLimit: getPromptCompactionBudgetTokens({
      kind: providerCtx.kind,
      model: run.textModelId
    })
  });
  await mastra.getStorage()?.init();
  const agent = mastra.getAgent(agentName);

  console.log('GenerationRun agent stream starting.', {
    generationRunId: run.id,
    kind: run.kind,
    agentName,
    providerKind: providerCtx.kind,
    textModelId: run.textModelId
  });

  const streamOptions = {
    model: languageModel,
    memory: {
      resource: memoryIds.resourceId,
      thread: memoryIds.threadId
    },
    requestContext,
    runId: run.mastraRunId ?? run.id,
    maxSteps: 80,
    savePerStep: true,
    toolCallConcurrency: 1,
    autoResumeSuspendedTools: false
  };
  const isResume = !!run.pendingAskAnswer;
  const resumeToolCallId = isResume && run.mastraRunId
    ? await getLatestSuspendedMastraToolCallId(run.id)
    : undefined;
  const promptText = buildAgentPrompt({ run, deckTitle: deck.title, promptInput, comments, tweaks, isResume });
  const imageAttachments = isResume ? [] : await loadRunImageAttachments(run.id);
  const initialMessage = buildAgentStreamMessage(promptText, imageAttachments);
  const stream = isResume && run.mastraRunId
    ? await agent.resumeStream(
        { answer: run.pendingAskAnswer },
        {
          ...streamOptions,
          ...(resumeToolCallId ? { toolCallId: resumeToolCallId } : {})
        }
      )
    : await agent.stream(initialMessage, streamOptions);
  const streamRecord = stream as unknown as Record<string, unknown>;
  const mastraRunId = typeof streamRecord.runId === 'string' ? streamRecord.runId : run.mastraRunId ?? run.id;
  const agentTraceId = typeof streamRecord.traceId === 'string' ? streamRecord.traceId : undefined;

  await prisma.generationRun.update({
    where: { id: run.id },
    data: {
      mastraRunId,
      ...(agentTraceId ? { agentTraceId } : {})
    }
  });

  const streamDiagnostics = await mirrorMastraAgentStream({ run, stream, state });

  const refreshedRun = await prisma.generationRun.findUnique({
    where: { id: run.id },
    select: { status: true }
  });

  if (state.waitingForAsk || refreshedRun?.status === 'WAITING_ASK') {
    return;
  }

  if (refreshedRun?.status === 'CANCELLED') {
    return;
  }

  if (!state.completed) {
    const toolDiagnostics = await getAgentStopToolDiagnostics(run.id);
    const stopDiagnostics: AgentStopDiagnosticInput = {
      ...streamDiagnostics,
      ...toolDiagnostics,
      draftSlideCount: state.latestDraft.slides.length,
      latestCheckpointId: state.latestCheckpointId,
      latestCheckpointSummary: state.latestCheckpointSummary
    };
    const fallback = await tryCommitLatestValidAgentDraft({
      run,
      state,
      assetUrls,
      diagnostics: stopDiagnostics
    });
    if (!fallback.committed) {
      throw new Error(fallback.message);
    }
    return;
  }

  console.log('GenerationRun agent completed.', { generationRunId: run.id, kind: run.kind, resultRevisionId: state.resultRevisionId });
}

async function enqueueGenerationRunPhase(
  run: GenerationRun,
  phase: GenerationRunPhase
): Promise<void> {
  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue<GenerationRunPhaseJobPayload>(generationRunPhaseQueueName, {
    connection: redis
  });

  try {
    await queue.add(
      `generation-run-${phase}`,
      {
        jobId: `${run.id}-${phase}`,
        workspaceId: run.workspaceId,
        actorUserId: run.createdByUserId,
        deckId: run.deckId,
        idempotencyKey: `${run.id}:${phase}`,
        requestedAt: new Date().toISOString(),
        generationRunId: run.id,
        phase
      },
      {
        attempts: 1,
        jobId: `gen-run-${run.id}-phase-${phase}`
      }
    );
  } finally {
    await queue.close();
    await redis.quit();
  }
}

export async function runGenerationRunPhaseJob(payload: GenerationRunPhaseJobPayload): Promise<void> {
  const run = await prisma.generationRun.findUnique({
    where: { id: payload.generationRunId }
  });

  if (!run) {
    console.error('GenerationRun phase run not found.', { generationRunId: payload.generationRunId, phase: payload.phase });
    return;
  }

  if (run.kind !== 'FULL_DECK') {
    console.warn('GenerationRun phase skipped for non-full-deck run.', { generationRunId: run.id, kind: run.kind, phase: payload.phase });
    return;
  }

  if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED' || run.status === 'WAITING_ASK') {
    console.warn('GenerationRun phase skipped because run is terminal or waiting.', { generationRunId: run.id, status: run.status, phase: payload.phase });
    return;
  }

  try {
    switch (payload.phase) {
      case 'prepare':
        await runFullDeckPreparePhase(run);
        return;
      case 'generate':
        await runFullDeckGeneratePhase(run);
        return;
      case 'validate':
        await runFullDeckValidatePhase(run);
        return;
      case 'repair':
        await runFullDeckRepairPhase(run);
        return;
      case 'commit':
        await runFullDeckCommitPhase(run);
        return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('GenerationRun phase failed.', { generationRunId: run.id, phase: payload.phase, error: message });
    await failGenerationRun(run, message);
    throw error;
  }
}

async function runFullDeckPreparePhase(run: GenerationRun): Promise<void> {
  if (run.status !== 'PENDING') {
    console.warn('GenerationRun prepare phase skipped because run is not pending.', { generationRunId: run.id, status: run.status });
    return;
  }

  await prisma.generationRun.update({
    where: { id: run.id },
    data: { status: 'RUNNING', startedAt: new Date() }
  });

  const readToolCallId = await startGenerationToolCall(
    run.id,
    'read_deck_state',
    'Reading deck state',
    { deckId: run.deckId }
  );

  try {
    const deck = await prisma.deck.findUniqueOrThrow({
      where: { id: run.deckId },
      select: { contentJson: true, title: true, workspaceId: true }
    });
    await finishGenerationToolCall(readToolCallId, 'COMPLETED', {
      title: deck.title,
      workspaceId: deck.workspaceId,
      hasContent: !!deck.contentJson
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishGenerationToolCall(readToolCallId, 'FAILED', undefined, message).catch(() => undefined);
    throw error;
  }

  await enqueueGenerationRunPhase(run, 'generate');
}

async function runFullDeckGeneratePhase(run: GenerationRun): Promise<void> {
  if (run.status !== 'RUNNING') {
    console.warn('GenerationRun generate phase skipped because run is not running.', { generationRunId: run.id, status: run.status });
    return;
  }

  const deck = await prisma.deck.findUniqueOrThrow({
    where: { id: run.deckId },
    select: { contentJson: true, title: true, workspaceId: true }
  });
  const deckJson = deck.contentJson ? JSON.stringify(deck.contentJson) : undefined;

  const providerId = run.textProviderId;
  if (!providerId) {
    throw new Error('No text provider configured for this generation run.');
  }
  if (!run.textModelId) {
    throw new Error('No text model configured for this generation run.');
  }

  const providerCtx = await resolveProviderContext(providerId);
  const providerInput = {
    kind: providerCtx.kind,
    baseUrl: providerCtx.baseUrl,
    credential: providerCtx.credential,
    model: run.textModelId
  };
  const promptBuild = await buildPromptInputForRun(run, deckJson, {
    providerId,
    kind: providerCtx.kind,
    baseUrl: providerCtx.baseUrl,
    credential: providerCtx.credential
  });
  const promptInput = await compactPromptInputForRun(run, promptBuild.promptInput, providerInput);
  const mastra = createPepeteXMastra({ disableTelemetry: config.disableExternalTelemetry });
  const workflow = mastra.getWorkflow('generateDeckWorkflow');
  const wfRun = await workflow.createRun();
  const modelToolCallId = await startGenerationToolCall(
    run.id,
    'write_slide_html',
    'Thinking and writing deck HTML',
    { providerId: run.textProviderId, modelId: run.textModelId, phase: 'generate' }
  );

  const result = await wfRun.start({
    inputData: {
      workspaceId: run.workspaceId,
      deckId: run.deckId,
      actorUserId: run.createdByUserId,
      provider: providerInput,
      promptInput
    }
  }).catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    await finishGenerationToolCall(modelToolCallId, 'FAILED', undefined, message).catch(() => undefined);
    throw error;
  });

  if (result.status === 'suspended') {
    const suspended = result as { suspendPayload?: { reason?: string; question?: string; options?: unknown; allowManualAnswer?: boolean } };
    await finishGenerationToolCall(modelToolCallId, 'COMPLETED', { status: 'waiting_ask' });
    await suspendGenerationRunWithAsk(run.id, suspended.suspendPayload ?? {});
    return;
  }

  if (result.status !== 'success') {
    const message = buildWorkflowFailureMessage(result as { status: string } & Record<string, unknown>);
    await finishGenerationToolCall(modelToolCallId, 'FAILED', undefined, message).catch(() => undefined);
    throw new Error(message);
  }

  const output = (result as { result?: { mode?: string; result?: DeckGenerationResult } }).result;
  if (!output || output.mode !== 'deck' || !output.result?.deck) {
    const message = `Workflow returned unexpected mode: ${output?.mode}`;
    await finishGenerationToolCall(modelToolCallId, 'FAILED', undefined, message).catch(() => undefined);
    throw new Error(message);
  }

  const checkpointId = await saveGenerationCheckpoint({
    runId: run.id,
    status: 'DRAFT',
    deck: output.result.deck,
    summary: `Generated draft with ${output.result.deck.slides.length} slides.`
  });
  await finishGenerationToolCall(modelToolCallId, 'COMPLETED', {
    mode: output.mode,
    slideCount: output.result.deck.slides.length,
    checkpointId
  });

  await enqueueGenerationRunPhase(run, 'validate');
}

async function runFullDeckValidatePhase(run: GenerationRun): Promise<void> {
  if (run.status !== 'RUNNING') {
    console.warn('GenerationRun validate phase skipped because run is not running.', { generationRunId: run.id, status: run.status });
    return;
  }

  const checkpoint = await prisma.generationCheckpoint.findFirst({
    where: { runId: run.id, status: { in: ['DRAFT', 'VALIDATION_FAILED'] } },
    orderBy: { createdAt: 'desc' }
  });
  if (!checkpoint) {
    throw new Error('No generated draft checkpoint found to validate.');
  }

  const validationToolCallId = await startGenerationToolCall(
    run.id,
    'validate_slide',
    'Validating slide contract',
    { checkpointId: checkpoint.id, phase: 'validate' }
  );
  const validation = validateDeckForCommit(checkpoint.deckJson, { requireSubstantialDeck: true });

  if (!validation.ok || !validation.deck) {
    const priorRepairFailures = await prisma.generationCheckpoint.count({
      where: { runId: run.id, status: 'VALIDATION_FAILED' }
    });
    await prisma.generationCheckpoint.update({
      where: { id: checkpoint.id },
      data: {
        status: 'VALIDATION_FAILED',
        validationJson: asUnknownJsonInput(validation.report),
        summary: 'Generated draft failed validation.'
      }
    });
    await finishGenerationToolCall(validationToolCallId, 'FAILED', validation.report, validation.errors.join(', '));
    await recordGenerationMessage(
      run.id,
      'VERIFIER',
      `Validation failed: ${validation.errors.join(', ')}`,
      validation.report
    );
    if (priorRepairFailures >= 2) {
      throw new Error(`Generated deck failed validation after repair attempts: ${validation.errors.join(', ')}`);
    }

    await enqueueGenerationRunPhase(run, 'repair');
    return;
  }

  await prisma.generationCheckpoint.update({
    where: { id: checkpoint.id },
    data: {
      status: 'VALIDATED',
      validationJson: asUnknownJsonInput(validation.report),
      summary: `Validated draft with ${validation.deck.slides.length} slides.`
    }
  });
  await finishGenerationToolCall(validationToolCallId, 'COMPLETED', validation.report);

  if (validation.qualityWarnings.length > 0) {
    await recordGenerationMessage(
      run.id,
      'VERIFIER',
      `Verifier noted design quality issues, but they are non-blocking until direct-edit repair is enabled: ${validation.qualityWarnings.join(', ')}`,
      { qualityWarnings: validation.qualityWarnings, report: validation.report }
    );
  }

  await enqueueGenerationRunPhase(run, 'commit');
}

async function runFullDeckRepairPhase(run: GenerationRun): Promise<void> {
  if (run.status !== 'RUNNING') {
    console.warn('GenerationRun repair phase skipped because run is not running.', { generationRunId: run.id, status: run.status });
    return;
  }

  const checkpoint = await prisma.generationCheckpoint.findFirst({
    where: { runId: run.id, status: 'VALIDATION_FAILED' },
    orderBy: { createdAt: 'desc' }
  });
  if (!checkpoint) {
    throw new Error('No failed checkpoint found to repair.');
  }

  const draftValidation = validateGeneratedDeck(checkpoint.deckJson);
  if (!draftValidation.ok) {
    throw new Error(`Failed checkpoint cannot be repaired because deck schema is invalid: ${draftValidation.errors.join(', ')}`);
  }

  const repairToolCallId = await startGenerationToolCall(
    run.id,
    'repair_deck_draft',
    'Fixing deck validation issues',
    { checkpointId: checkpoint.id, phase: 'repair' }
  );

  try {
    const deck = await prisma.deck.findUniqueOrThrow({
      where: { id: run.deckId },
      select: { contentJson: true }
    });
    const deckJson = deck.contentJson ? JSON.stringify(deck.contentJson) : undefined;
    const providerId = run.textProviderId;
    if (!providerId) {
      throw new Error('No text provider configured for this generation run.');
    }
    if (!run.textModelId) {
      throw new Error('No text model configured for this generation run.');
    }

    const providerCtx = await resolveProviderContext(providerId);
    const provider = {
      kind: providerCtx.kind,
      baseUrl: providerCtx.baseUrl,
      credential: providerCtx.credential,
      model: run.textModelId
    };
    const promptBuild = await buildPromptInputForRun(run, deckJson, {
      providerId,
      kind: providerCtx.kind,
      baseUrl: providerCtx.baseUrl,
      credential: providerCtx.credential
    });
    const { assetUrls } = promptBuild;
    const promptInput = await compactPromptInputForRun(run, promptBuild.promptInput, provider);
    const repaired = await validateAndRepairDeckGenerationResult(
      {
        provider,
        promptInput,
        maxRepairAttempts: 3,
        ...(Object.keys(assetUrls).length > 0 ? { assetUrls } : {})
      },
      {
        mode: 'deck',
        schemaVersion: 'pepetex.deck.v1',
        deck: draftValidation.value,
        assumptions: [],
        warnings: [],
        designSystemRulesUsed: []
      }
    );

    if (repaired.result.mode !== 'deck') {
      throw new Error(`Deck repair returned unexpected mode: ${repaired.result.mode}`);
    }

    const repairedCheckpointId = await saveGenerationCheckpoint({
      runId: run.id,
      status: 'DRAFT',
      deck: repaired.result.deck,
      summary: `Repaired draft after ${repaired.repairAttempts} repair attempt(s).`
    });
    await finishGenerationToolCall(repairToolCallId, 'COMPLETED', {
      repairedCheckpointId,
      repairAttempts: repaired.repairAttempts,
      slideCount: repaired.result.deck.slides.length
    });
    await enqueueGenerationRunPhase(run, 'validate');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishGenerationToolCall(repairToolCallId, 'FAILED', undefined, message).catch(() => undefined);
    throw error;
  }
}

async function runFullDeckCommitPhase(run: GenerationRun): Promise<void> {
  if (run.status !== 'RUNNING') {
    console.warn('GenerationRun commit phase skipped because run is not running.', { generationRunId: run.id, status: run.status });
    return;
  }

  const checkpoint = await prisma.generationCheckpoint.findFirst({
    where: { runId: run.id, status: 'VALIDATED' },
    orderBy: { createdAt: 'desc' }
  });
  if (!checkpoint) {
    throw new Error('No validated checkpoint found to commit.');
  }

  const validation = validateDeckForCommit(checkpoint.deckJson, { requireSubstantialDeck: true });
  if (!validation.ok || !validation.deck) {
    throw new Error(`Validated checkpoint failed final validation: ${validation.errors.join(', ')}`);
  }

  const commitToolCallId = await startGenerationToolCall(
    run.id,
    'commit_deck_revision',
    'Committing deck revision',
    { checkpointId: checkpoint.id, phase: 'commit' }
  );

  try {
    const deckForCommit = await generateFullDeckTitleForCommit(
      run,
      await prepareDeckForCommit(validation.deck, run)
    );
    const resultRevisionId = await applyFullDeck(
      run.deckId,
      run.createdByUserId,
      deckForCommit,
      DeckRevisionSource.AI_FULL_DECK_GENERATED,
      'AI-generated deck',
      'Full deck generated by AI.',
      run.manualInstruction
    );
    await markGenerationCheckpointCommitted(checkpoint.id, resultRevisionId);
    await finishGenerationToolCall(commitToolCallId, 'COMPLETED', { revisionId: resultRevisionId });

    await prisma.deck.update({
      where: { id: run.deckId },
      data: {
        ...(run.textProviderId ? { lastUsedTextProviderId: run.textProviderId } : {}),
        ...(run.textModelId ? { lastUsedTextModelId: run.textModelId } : {})
      }
    });

    const completeUpdate = await prisma.generationRun.updateMany({
      where: { id: run.id, status: { not: 'CANCELLED' } },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        resultRevisionId
      }
    });

    if (completeUpdate.count === 0) {
      throw new GenerationRunCancelledError();
    }

    console.log('GenerationRun full-deck phases completed.', { generationRunId: run.id, resultRevisionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishGenerationToolCall(commitToolCallId, 'FAILED', undefined, message).catch(() => undefined);
    throw error;
  }
}

async function failGenerationRun(run: GenerationRun, message: string): Promise<void> {
  await prisma.generationRun.update({
    where: { id: run.id },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      errorMessage: message
    }
  }).catch((updateErr) => {
    console.error('Failed to mark GenerationRun as FAILED.', { generationRunId: run.id, updateErr });
  });

  await recordGenerationMessage(
    run.id,
    'SYSTEM',
    `I hit an error before I could safely finish: ${message}`,
    { error: message }
  ).catch((messageErr) => {
    console.error('Failed to record GenerationRun failure message.', { generationRunId: run.id, messageErr });
  });

  await restoreSubmittedRefinementState(run).catch((restoreErr) => {
    console.error('Failed to restore submitted refinement state after GenerationRun failure.', {
      generationRunId: run.id,
      restoreErr
    });
  });
}

export async function runGenerationRunJob(payload: GenerationRunJobPayload): Promise<void> {
  const { generationRunId } = payload;
  let run: GenerationRun | null = null;

  try {
    run = await prisma.generationRun.findUnique({
      where: { id: generationRunId }
    });

    if (!run) {
      console.error('GenerationRun not found.', { generationRunId });
      return;
    }

    if (run.status !== 'PENDING' && !isRecoverableRunningAgenticRun(run)) {
      console.warn('GenerationRun is not PENDING, skipping.', { generationRunId, status: run.status });
      return;
    }

    if (run.status === 'RUNNING') {
      console.warn('GenerationRun is RUNNING; recovering interrupted agentic attempt.', {
        generationRunId,
        kind: run.kind,
        startedAt: run.startedAt
      });
    }

    if (isAgenticTextGenerationKind(run.kind)) {
      await runAgenticTextGenerationRun(run);
      return;
    }

    if (isLegacyTextGenerationKind(run.kind)) {
      await failGenerationRun(
        run,
        `Legacy text generation kind ${run.kind} is no longer supported. Submit AGENT_COMMAND with commandContextJson.intent instead.`
      );
      return;
    }

    if (run.kind === 'GENERATE_IMAGE' || run.kind === 'REGENERATE_IMAGE') {
      const completeUpdate = await prisma.generationRun.updateMany({
        where: { id: generationRunId, status: { not: 'CANCELLED' } },
        data: {
          status: 'COMPLETED',
          completedAt: new Date()
        }
      });
      if (completeUpdate.count === 0) {
        throw new GenerationRunCancelledError();
      }
      return;
    }

    // Mark as RUNNING
    const runningUpdate = await prisma.generationRun.updateMany({
      where: { id: generationRunId, status: { not: 'CANCELLED' } },
      data: { status: 'RUNNING', startedAt: new Date() }
    });

    if (runningUpdate.count === 0) {
      throw new GenerationRunCancelledError();
    }

    // Load deck content for context
    const readToolCallId = await startGenerationToolCall(
      generationRunId,
      'read_deck_state',
      'Reading deck state',
      { deckId: run.deckId }
    );
    let deck: { contentJson: Prisma.JsonValue | null; title: string; workspaceId: string };

    try {
      deck = await prisma.deck.findUniqueOrThrow({
        where: { id: run.deckId },
        select: { contentJson: true, title: true, workspaceId: true }
      });
      await finishGenerationToolCall(readToolCallId, 'COMPLETED', {
        title: deck.title,
        workspaceId: deck.workspaceId,
        hasContent: !!deck.contentJson
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishGenerationToolCall(readToolCallId, 'FAILED', undefined, message).catch(() => undefined);
      throw error;
    }

    const deckJson = deck.contentJson
      ? JSON.stringify(deck.contentJson)
      : undefined;

    // Resolve provider context
    const providerId = run.textProviderId;
    if (!providerId) {
      throw new Error('No text provider configured for this generation run.');
    }

    const providerCtx = await resolveProviderContext(providerId);

    const providerInput = {
      kind: providerCtx.kind,
      baseUrl: providerCtx.baseUrl,
      credential: providerCtx.credential,
      ...(run.textModelId ? { model: run.textModelId } : {})
    };

    const promptBuild = await buildPromptInputForRun(run, deckJson, {
      providerId,
      kind: providerCtx.kind,
      baseUrl: providerCtx.baseUrl,
      credential: providerCtx.credential
    });
    const promptInput = await compactPromptInputForRun(run, promptBuild.promptInput, {
      kind: providerCtx.kind,
      baseUrl: providerCtx.baseUrl,
      credential: providerCtx.credential,
      model: run.textModelId ?? 'unknown'
    });

    const mastra = createPepeteXMastra({ disableTelemetry: config.disableExternalTelemetry });
    let resultRevisionId: string | null = null;
    let aiSummary: string | null = null;

    if (run.kind === 'SINGLE_SLIDE') {
      const workflow = mastra.getWorkflow('generateSingleSlideWorkflow');
      const wfRun = await workflow.createRun();
      const result = await wfRun.start({
        inputData: {
          workspaceId: run.workspaceId,
          deckId: run.deckId,
          actorUserId: run.createdByUserId,
          slideInstruction: run.slideInstruction ?? run.manualInstruction ?? 'Generate a slide.',
          provider: providerInput,
          promptInput
        }
      });

      if (result.status === 'suspended') {
        const sp = (result as { suspendPayload?: Record<string, unknown> }).suspendPayload ?? {};
        await suspendGenerationRunWithAsk(generationRunId, sp);
        return;
      }

      if (result.status !== 'success') {
        throw new Error(buildWorkflowFailureMessage(result as { status: string } & Record<string, unknown>));
      }

      const output = (result as { result?: { mode?: string; result?: DeckPatchResult } }).result;
      if (!output || output.mode !== 'deck_patch' || !output.result?.patch) {
        throw new Error(`Workflow returned unexpected mode: ${output?.mode}`);
      }

      resultRevisionId = await applyPatchToDeck(
        run.deckId,
        run.createdByUserId,
        output.result.patch,
        DeckRevisionSource.AI_SINGLE_SLIDE_INSERTED,
        'AI single-slide insert',
        'AI inserted a new slide.'
      );

    } else if (run.kind === 'REGENERATE_SLIDE') {
      const workflow = mastra.getWorkflow('regenerateSlideWorkflow');
      const wfRun = await workflow.createRun();
      const result = await wfRun.start({
        inputData: {
          workspaceId: run.workspaceId,
          deckId: run.deckId,
          slideId: run.targetSlideId ?? '',
          actorUserId: run.createdByUserId,
          regenerateInstruction: run.slideInstruction ?? run.manualInstruction,
          currentSlideSnapshot: deckJson,
          provider: providerInput,
          promptInput
        }
      });

      if (result.status === 'suspended') {
        const sp = (result as { suspendPayload?: Record<string, unknown> }).suspendPayload ?? {};
        await suspendGenerationRunWithAsk(generationRunId, sp);
        return;
      }

      if (result.status !== 'success') {
        throw new Error(buildWorkflowFailureMessage(result as { status: string } & Record<string, unknown>));
      }

      const output = (result as { result?: { mode?: string; result?: DeckPatchResult } }).result;
      if (!output || output.mode !== 'deck_patch' || !output.result?.patch) {
        throw new Error(`Workflow returned unexpected mode: ${output?.mode}`);
      }

      resultRevisionId = await applyPatchToDeck(
        run.deckId,
        run.createdByUserId,
        output.result.patch,
        DeckRevisionSource.AI_SLIDE_REGENERATED,
        'AI slide regeneration',
        'AI regenerated a slide.'
      );

    } else if (run.kind === 'APPLY_COMMENTS') {
      const commentsPayload = parseCommentsPayload(run.manualInstruction);

      const workflow = mastra.getWorkflow('applyCommentsWorkflow');
      const wfRun = await workflow.createRun();
      const result = await wfRun.start({
        inputData: {
          workspaceId: run.workspaceId,
          deckId: run.deckId,
          actorUserId: run.createdByUserId,
          provider: providerInput,
          promptInput,
          comments: commentsPayload.comments,
          currentDeckJson: deckJson
        }
      });

      if (result.status === 'suspended') {
        const sp = (result as { suspendPayload?: Record<string, unknown> }).suspendPayload ?? {};
        await suspendGenerationRunWithAsk(generationRunId, sp);
        return;
      }

      if (result.status !== 'success') {
        throw new Error(buildWorkflowFailureMessage(result as { status: string } & Record<string, unknown>));
      }

      const output = (result as { result?: { mode?: string; result?: DeckPatchResult } }).result;
      if (!output || output.mode !== 'deck_patch' || !output.result?.patch) {
        throw new Error(`Workflow returned unexpected mode: ${output?.mode}`);
      }

      aiSummary = output.result.userVisibleSummary ?? null;
      assertDeckPatchCoversSubmittedComments(output.result.patch, commentsPayload.comments);
      resultRevisionId = await applyPatchToDeck(
        run.deckId,
        run.createdByUserId,
        output.result.patch,
        DeckRevisionSource.AI_COMMENTS_APPLIED,
        'AI applied comments',
        aiSummary ?? 'AI applied comments to the deck.'
      );

      if (commentsPayload.commentIds.length > 0) {
        await prisma.comment.updateMany({
          where: {
            deckId: run.deckId,
            id: { in: commentsPayload.commentIds },
            status: 'SUBMITTED'
          },
          data: { status: 'APPLIED' }
        });
      }

    } else if (run.kind === 'APPLY_TWEAKS') {
      const tweaksPayload = parseTweaksPayload(run.manualInstruction);

      const workflow = mastra.getWorkflow('applyTweaksWorkflow');
      const wfRun = await workflow.createRun();
      const result = await wfRun.start({
        inputData: {
          workspaceId: run.workspaceId,
          deckId: run.deckId,
          actorUserId: run.createdByUserId,
          provider: providerInput,
          promptInput,
          tweaks: tweaksPayload.tweaks,
          currentDeckJson: deckJson
        }
      });

      if (result.status === 'suspended') {
        const sp = (result as { suspendPayload?: Record<string, unknown> }).suspendPayload ?? {};
        await suspendGenerationRunWithAsk(generationRunId, sp);
        return;
      }

      if (result.status !== 'success') {
        throw new Error(buildWorkflowFailureMessage(result as { status: string } & Record<string, unknown>));
      }

      const output = (result as { result?: { mode?: string; result?: DeckPatchResult } }).result;
      if (!output || output.mode !== 'deck_patch' || !output.result?.patch) {
        throw new Error(`Workflow returned unexpected mode: ${output?.mode}`);
      }

      aiSummary = output.result.userVisibleSummary ?? null;
      resultRevisionId = await applyPatchToDeck(
        run.deckId,
        run.createdByUserId,
        output.result.patch,
        DeckRevisionSource.AI_TWEAKS_APPLIED,
        'AI applied tweaks',
        aiSummary ?? 'AI applied tweaks to the deck.'
      );

      if (tweaksPayload.batchId) {
        await prisma.tweakBatch.updateMany({
          where: { id: tweaksPayload.batchId, deckId: run.deckId, status: 'SUBMITTED' },
          data: { status: 'APPLIED', appliedAt: new Date() }
        });
      }

    } else {
      // GENERATE_IMAGE / REGENERATE_IMAGE — handled by image-generate worker
      // Mark COMPLETED here; image jobs are dispatched from the API or image worker
      const completeUpdate = await prisma.generationRun.updateMany({
        where: { id: generationRunId, status: { not: 'CANCELLED' } },
        data: {
          status: 'COMPLETED',
          completedAt: new Date()
        }
      });
      if (completeUpdate.count === 0) {
        throw new GenerationRunCancelledError();
      }
      return;
    }

    // Update Deck lastUsed provider/model
    await prisma.deck.update({
      where: { id: run.deckId },
      data: {
        ...(run.textProviderId ? { lastUsedTextProviderId: run.textProviderId } : {}),
        ...(run.textModelId ? { lastUsedTextModelId: run.textModelId } : {})
      }
    });

    // Complete the run
    const completeUpdate = await prisma.generationRun.updateMany({
      where: { id: generationRunId, status: { not: 'CANCELLED' } },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        resultRevisionId,
        ...(aiSummary ? { aiSummary } : {})
      }
    });

    if (completeUpdate.count === 0) {
      throw new GenerationRunCancelledError();
    }

    console.log('GenerationRun completed.', { generationRunId, kind: run.kind, resultRevisionId });

  } catch (error) {
    if (isGenerationRunCancelledError(error) || await isGenerationRunCancelled(generationRunId)) {
      console.warn('GenerationRun cancelled.', { generationRunId });
      await markGenerationRunCancellationHandled(generationRunId, run);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error('GenerationRun failed.', { generationRunId, error: message });

    await prisma.generationRun.update({
      where: { id: generationRunId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errorMessage: message
      }
    }).catch((updateErr) => {
      console.error('Failed to mark GenerationRun as FAILED.', { generationRunId, updateErr });
    });

    await recordGenerationMessage(
      generationRunId,
      'SYSTEM',
      `I hit an error before I could safely finish: ${message}`,
      { error: message }
    ).catch((messageErr) => {
      console.error('Failed to record GenerationRun failure message.', { generationRunId, messageErr });
    });

    if (run) {
      await restoreSubmittedRefinementState(run).catch((restoreErr) => {
        console.error('Failed to restore submitted refinement state after GenerationRun failure.', {
          generationRunId,
          restoreErr
        });
      });
    }
  }
}

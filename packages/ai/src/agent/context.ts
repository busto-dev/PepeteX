import { RequestContext } from '@mastra/core/request-context';
import type { AgentLanguageModel, ProviderContext, TextProviderKind } from '@pepetex/providers';
import type { DeckPatch, GeneratedDeck, GeneratedSlide } from '../index.js';

export const pepeteXTextGenerationKinds = [
  'AGENT_COMMAND',
  'FULL_DECK',
  'SINGLE_SLIDE',
  'REGENERATE_SLIDE',
  'APPLY_COMMENTS',
  'APPLY_TWEAKS'
] as const;

export type PepeteXTextGenerationKind = (typeof pepeteXTextGenerationKinds)[number];

export interface PepeteXAgentReferenceFile {
  id: string;
  assetId?: string | null;
  source?: 'deck' | 'design-system' | string | null;
  role?: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  imageWidth?: number | null;
  imageHeight?: number | null;
  attachedToModel?: boolean | null;
  attachmentMode?: string | null;
  attachmentReason?: string | null;
  usageHint?: string | null;
  summary?: string | null;
  textExcerpt?: string | null;
}

export interface PepeteXAgentAsset {
  id: string;
  role?: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  imageWidth?: number | null;
  imageHeight?: number | null;
  usageHint?: string | null;
}

export interface PepeteXAgentProviderSelection {
  kind: TextProviderKind;
  providerId: string;
  modelId: string;
  providerName: string | undefined;
  ctx: ProviderContext;
}

export interface PepeteXAgentRequestContext {
  runId: string;
  deckId: string;
  workspaceId: string;
  actorUserId: string;
  generationKind: PepeteXTextGenerationKind;
  languageCode: string;
  manualInstruction: string | undefined;
  targetSlideId: string | undefined;
  targetElementId: string | undefined;
  slideInstruction: string | undefined;
  commandContext: unknown;
  customPromptText: string | undefined;
  comments: unknown[] | undefined;
  tweaks: unknown[] | undefined;
  deckState: unknown;
  selectedDesignSystem: unknown;
  referenceFiles: PepeteXAgentReferenceFile[] | undefined;
  assets: PepeteXAgentAsset[] | undefined;
  provider: PepeteXAgentProviderSelection;
  languageModel: AgentLanguageModel;
  runtime: PepeteXAgentToolRuntime;
}

export interface PepeteXAgentValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  report: unknown;
  deck?: GeneratedDeck;
}

export interface PepeteXAgentDraftMutationResult extends PepeteXAgentValidationResult {
  checkpointId?: string;
  deck: GeneratedDeck;
  candidate: unknown;
  summary: string;
}

export interface PepeteXAgentFinishResult extends PepeteXAgentValidationResult {
  completed: boolean;
  revisionId?: string;
  summary: string;
}

export type PepeteXTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface PepeteXTodoItem {
  content: string;
  activeForm: string;
  status: PepeteXTodoStatus;
}

export interface PepeteXAgentToolRuntime {
  getDraftDeck(): GeneratedDeck | null;
  getCurrentDeck(): GeneratedDeck | null;
  savePlan(plan: unknown): Promise<{ status: 'ok'; plan: unknown }>;
  writeTodos(input: { todos: PepeteXTodoItem[] }): Promise<{ status: 'ok'; todos: PepeteXTodoItem[] }>;
  /** Records a context-compaction event (mirrored to the UI timeline). */
  recordCompactionEvent(input: {
    detail: string;
    tokensBefore: number;
    tokensAfter: number;
  }): Promise<void>;
  /** Model-triggered early compaction: sets a one-shot flag the compaction processor consumes. */
  requestContextCompaction(): void;
  /** Reads and clears the force-compaction flag. */
  consumeForceCompactFlag(): boolean;
  writeSlide(input: {
    slide: GeneratedSlide;
    operation: 'insert' | 'replace';
    position: 'start' | 'end' | 'index' | 'before' | 'after';
    index?: number;
    referenceSlideId?: string;
    summary?: string;
  }): Promise<PepeteXAgentDraftMutationResult>;
  patchSlide(input: {
    patch: DeckPatch;
    summary?: string;
  }): Promise<PepeteXAgentDraftMutationResult>;
  validateSlide(input: {
    slideId?: string;
    candidate?: GeneratedSlide;
  }): Promise<PepeteXAgentValidationResult>;
  validateDeck(): Promise<PepeteXAgentValidationResult>;
  finishGeneration(input: {
    summary: string;
  }): Promise<PepeteXAgentFinishResult>;
}

export interface PepeteXMastraMemoryIds {
  resourceId: string;
  threadId: string;
}

export function createPepeteXMastraMemoryIds(input: {
  deckId: string;
  runId: string;
}): PepeteXMastraMemoryIds {
  return {
    resourceId: `deck:${input.deckId}`,
    threadId: `deck:${input.deckId}:studio`
  };
}

export function resolveAgentLanguageModel({
  requestContext
}: {
  requestContext: RequestContext<unknown>;
}): AgentLanguageModel {
  const model = requestContext.get<'languageModel', AgentLanguageModel | undefined>('languageModel');

  if (!model) {
    throw new Error('PepeteX agent request context is missing languageModel.');
  }

  return model;
}

export function createPepeteXAgentRequestContext(
  input: PepeteXAgentRequestContext
): RequestContext<unknown> {
  return new RequestContext<unknown>(Object.entries(input));
}

export function getPepeteXAgentRequestContext(
  requestContext: RequestContext<unknown> | undefined
): PepeteXAgentRequestContext {
  if (!requestContext) {
    throw new Error('PepeteX agent tool requires a request context.');
  }

  const runId = requestContext.get<'runId', string | undefined>('runId');
  const deckId = requestContext.get<'deckId', string | undefined>('deckId');
  const workspaceId = requestContext.get<'workspaceId', string | undefined>('workspaceId');
  const actorUserId = requestContext.get<'actorUserId', string | undefined>('actorUserId');
  const generationKind = requestContext.get<'generationKind', PepeteXTextGenerationKind | undefined>('generationKind');
  const provider = requestContext.get<'provider', PepeteXAgentProviderSelection | undefined>('provider');
  const languageModel = requestContext.get<'languageModel', AgentLanguageModel | undefined>('languageModel');
  const runtime = requestContext.get<'runtime', PepeteXAgentToolRuntime | undefined>('runtime');

  if (!runId || !deckId || !workspaceId || !actorUserId || !generationKind || !provider || !languageModel || !runtime) {
    throw new Error('PepeteX agent request context is incomplete.');
  }

  return {
    runId,
    deckId,
    workspaceId,
    actorUserId,
    generationKind,
    languageCode: requestContext.get<'languageCode', string | undefined>('languageCode') ?? 'en',
    manualInstruction: requestContext.get<'manualInstruction', string | undefined>('manualInstruction'),
    targetSlideId: requestContext.get<'targetSlideId', string | undefined>('targetSlideId'),
    targetElementId: requestContext.get<'targetElementId', string | undefined>('targetElementId'),
    slideInstruction: requestContext.get<'slideInstruction', string | undefined>('slideInstruction'),
    commandContext: requestContext.get<'commandContext', unknown>('commandContext'),
    customPromptText: requestContext.get<'customPromptText', string | undefined>('customPromptText'),
    comments: requestContext.get<'comments', unknown[] | undefined>('comments'),
    tweaks: requestContext.get<'tweaks', unknown[] | undefined>('tweaks'),
    deckState: requestContext.get<'deckState', unknown>('deckState'),
    selectedDesignSystem: requestContext.get<'selectedDesignSystem', unknown>('selectedDesignSystem'),
    referenceFiles: requestContext.get<'referenceFiles', PepeteXAgentReferenceFile[] | undefined>('referenceFiles'),
    assets: requestContext.get<'assets', PepeteXAgentAsset[] | undefined>('assets'),
    provider,
    languageModel,
    runtime
  };
}

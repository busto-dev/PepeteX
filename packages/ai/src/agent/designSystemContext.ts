import { RequestContext } from '@mastra/core/request-context';
import type { AgentLanguageModel, ProviderContext, TextProviderKind } from '@pepetex/providers';
import type { DesignSystemDocumentV2 } from '@pepetex/design-systems';

export const pepeteXDesignSystemGenerationKinds = ['DS_AGENT_COMMAND', 'DS_FULL_GENERATE'] as const;
export type PepeteXDesignSystemGenerationKind = (typeof pepeteXDesignSystemGenerationKinds)[number];

export interface PepeteXDesignSystemReferenceFile {
  id: string;
  purpose?: 'REFERENCE' | 'ASSET' | string | null;
  assetRole?: string | null;
  role?: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  pageCount?: number | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  attachedToModel?: boolean | null;
  attachmentMode?: string | null;
  usageHint?: string | null;
  summary?: string | null;
  textExcerpt?: string | null;
}

export interface PepeteXDesignSystemAssetInfo {
  /** GeneratedImage id or reference-file id. */
  id: string;
  source: 'reference' | 'generated';
  assetKind?: string | null;
  status?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  available: boolean;
}

export interface PepeteXDesignSystemProviderSelection {
  kind: TextProviderKind;
  providerId: string;
  modelId: string;
  providerName: string | undefined;
  ctx: ProviderContext;
}

export interface PepeteXDesignSystemValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  document?: DesignSystemDocumentV2;
}

export interface PepeteXDesignSystemMutationResult extends PepeteXDesignSystemValidationResult {
  document: DesignSystemDocumentV2;
  summary: string;
  checkpointId?: string;
}

export interface PepeteXDesignSystemAssetImageResult {
  status: 'queued' | 'failed';
  generatedImageId?: string;
  message?: string;
}

export interface PepeteXDesignSystemFinishResult extends PepeteXDesignSystemValidationResult {
  completed: boolean;
  versionId?: string;
  versionNumber?: number;
  summary: string;
}

export type DesignSystemWriteItemInput = {
  bucketId: string;
  subCategoryId: string;
  item: Record<string, unknown>;
  summary?: string;
};

export type DesignSystemUpsertBucketInput = {
  id?: string;
  kind: string;
  label: string;
  description?: string | null;
  summary?: string;
};

export type DesignSystemUpsertSubCategoryInput = {
  bucketId: string;
  id?: string;
  label: string;
  description?: string | null;
  summary?: string;
};

export type DesignSystemDeleteInput = {
  bucketId: string;
  subCategoryId?: string;
  itemId?: string;
  summary?: string;
};

export type DesignSystemGenerateAssetInput = {
  bucketId: string;
  subCategoryId: string;
  label: string;
  assetKind: string;
  prompt: string;
};

/** Worker-supplied side-effecting operations the design system agent tools call. */
export interface PepeteXDesignSystemToolRuntime {
  getDraftDocument(): DesignSystemDocumentV2;
  getDesignSystemMeta(): { id: string; name: string; description: string | null };
  listReferenceFiles(): PepeteXDesignSystemReferenceFile[];
  readReferenceFile(referenceFileId: string): Promise<{
    status: 'ok' | 'not_found';
    file?: PepeteXDesignSystemReferenceFile;
    contentBase64?: string;
    textExcerpt?: string;
  }>;
  listAssets(): PepeteXDesignSystemAssetInfo[];
  upsertBucket(input: DesignSystemUpsertBucketInput): Promise<PepeteXDesignSystemMutationResult>;
  upsertSubCategory(input: DesignSystemUpsertSubCategoryInput): Promise<PepeteXDesignSystemMutationResult>;
  writeItem(input: DesignSystemWriteItemInput): Promise<PepeteXDesignSystemMutationResult>;
  deleteNode(input: DesignSystemDeleteInput): Promise<PepeteXDesignSystemMutationResult>;
  generateAssetImage(input: DesignSystemGenerateAssetInput): Promise<PepeteXDesignSystemAssetImageResult>;
  validateDocument(): Promise<PepeteXDesignSystemValidationResult>;
  finishGeneration(input: { summary: string }): Promise<PepeteXDesignSystemFinishResult>;
}

export interface PepeteXDesignSystemAgentRequestContext {
  runId: string;
  designSystemId: string;
  workspaceId: string | undefined;
  actorUserId: string;
  generationKind: PepeteXDesignSystemGenerationKind;
  languageCode: string;
  manualInstruction: string | undefined;
  feedbackContext: unknown;
  referenceFiles: PepeteXDesignSystemReferenceFile[] | undefined;
  assets: PepeteXDesignSystemAssetInfo[] | undefined;
  provider: PepeteXDesignSystemProviderSelection;
  languageModel: AgentLanguageModel;
  runtime: PepeteXDesignSystemToolRuntime;
}

export function createPepeteXDesignSystemMastraMemoryIds(input: {
  designSystemId: string;
  runId: string;
}): { resourceId: string; threadId: string } {
  return {
    resourceId: `design-system:${input.designSystemId}`,
    threadId: `design-system:${input.designSystemId}:studio`
  };
}

export function createPepeteXDesignSystemAgentRequestContext(
  input: PepeteXDesignSystemAgentRequestContext
): RequestContext<unknown> {
  return new RequestContext<unknown>(Object.entries(input));
}

export function getPepeteXDesignSystemAgentRequestContext(
  requestContext: RequestContext<unknown> | undefined
): PepeteXDesignSystemAgentRequestContext {
  if (!requestContext) {
    throw new Error('PepeteX design system agent tool requires a request context.');
  }

  const runId = requestContext.get<'runId', string | undefined>('runId');
  const designSystemId = requestContext.get<'designSystemId', string | undefined>('designSystemId');
  const actorUserId = requestContext.get<'actorUserId', string | undefined>('actorUserId');
  const generationKind = requestContext.get<'generationKind', PepeteXDesignSystemGenerationKind | undefined>('generationKind');
  const provider = requestContext.get<'provider', PepeteXDesignSystemProviderSelection | undefined>('provider');
  const languageModel = requestContext.get<'languageModel', AgentLanguageModel | undefined>('languageModel');
  const runtime = requestContext.get<'runtime', PepeteXDesignSystemToolRuntime | undefined>('runtime');

  if (!runId || !designSystemId || !actorUserId || !generationKind || !provider || !languageModel || !runtime) {
    throw new Error('PepeteX design system agent request context is incomplete.');
  }

  return {
    runId,
    designSystemId,
    workspaceId: requestContext.get<'workspaceId', string | undefined>('workspaceId'),
    actorUserId,
    generationKind,
    languageCode: requestContext.get<'languageCode', string | undefined>('languageCode') ?? 'en',
    manualInstruction: requestContext.get<'manualInstruction', string | undefined>('manualInstruction'),
    feedbackContext: requestContext.get<'feedbackContext', unknown>('feedbackContext'),
    referenceFiles: requestContext.get<'referenceFiles', PepeteXDesignSystemReferenceFile[] | undefined>('referenceFiles'),
    assets: requestContext.get<'assets', PepeteXDesignSystemAssetInfo[] | undefined>('assets'),
    provider,
    languageModel,
    runtime
  };
}

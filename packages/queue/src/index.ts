export const queueNames = [
  'ai.generateDeck',
  'ai.generateSingleSlide',
  'ai.regenerateSlide',
  'ai.applyComments',
  'ai.applyTweaks',
  'ai.generationRun',
  'ai.generationRunPhase',
  'ai.designSystemGenerationRun',
  'image.generate',
  'export.pptx',
  'export.pdf',
  'thumbnail.generate',
  'cleanup.expireReferenceFiles',
  'cleanup.expireRevisions'
] as const;

export type QueueName = (typeof queueNames)[number];

export const expireReferenceFilesQueueName = 'cleanup.expireReferenceFiles';
export const expireRevisionsQueueName = 'cleanup.expireRevisions';
export const thumbnailGenerateQueueName = 'thumbnail.generate';
export const exportPptxQueueName = 'export.pptx';
export const exportPdfQueueName = 'export.pdf';
export const generationRunQueueName = 'ai.generationRun';
export const generationRunPhaseQueueName = 'ai.generationRunPhase';
export const designSystemGenerationRunQueueName = 'ai.designSystemGenerationRun';
export const imageGenerateQueueName = 'image.generate';

export interface PepeteXJobPayload {
  jobId: string;
  workspaceId: string;
  actorUserId: string;
  deckId?: string;
  revisionId?: string;
  idempotencyKey: string;
  requestedAt: string;
}

export interface ExpireReferenceFilesJobPayload extends PepeteXJobPayload {
  limit?: number;
}

export interface ThumbnailJobSlide {
  id: string;
  title: string;
  html: string;
  css: string;
}

export interface ThumbnailGenerateJobPayload extends PepeteXJobPayload {
  slide: ThumbnailJobSlide;
  allowedAssetHosts?: string[];
  assetUrls?: Record<string, string>;
  fontFaces?: Array<{
    id?: string;
    fontFamily: string;
    mimeType: string;
    dataUrl: string;
    fontWeight?: number | string | null;
    fontStyle?: string | null;
  }>;
  storageBucket?: string;
  storageObjectPath?: string;
}

export type JobStatus = 'queued' | 'running' | 'waiting_for_user' | 'repairing' | 'completed' | 'failed' | 'cancelled' | 'expired';

export interface ExportPptxJobPayload extends PepeteXJobPayload {
  exportJobTokenId: string;
  exportToken: string;
  deckTitle: string;
  internalExportBaseUrl: string;
  gcsBucket: string;
  gcsPath: string;
  fileName: string;
  pepetexVersion: string;
}

// PDF export runs through Chromium's page.pdf() instead of dom-to-pptx. Same
// auth/token model as PPTX so the render route can be one-shot per token.
export interface ExportPdfJobPayload extends PepeteXJobPayload {
  exportJobTokenId: string;
  exportToken: string;
  deckTitle: string;
  internalExportBaseUrl: string;
  gcsBucket: string;
  gcsPath: string;
  fileName: string;
  pepetexVersion: string;
}

export interface GenerationRunJobPayload extends PepeteXJobPayload {
  generationRunId: string;
}

export type GenerationRunPhase = 'prepare' | 'generate' | 'validate' | 'repair' | 'commit';

export interface GenerationRunPhaseJobPayload extends GenerationRunJobPayload {
  phase: GenerationRunPhase;
}

// Agentic design system studio run (parallel to GenerationRunJobPayload).
export interface DesignSystemGenerationRunJobPayload extends PepeteXJobPayload {
  designSystemGenerationRunId: string;
}

export interface ImageGenerateJobPayload extends PepeteXJobPayload {
  // Exactly one of generationRunId (deck) or designSystemGenerationRunId (design system) is set.
  generationRunId?: string;
  designSystemGenerationRunId?: string;
  designSystemId?: string;
  /** Pre-created GeneratedImage row to update on completion (design system asset flow). */
  generatedImageId?: string;
  slideId?: string;
  elementId?: string;
  prompt: string;
  model: string;
  providerKind: string;
  count: number;
  gcsBucket: string;
  gcsObjectPrefix: string;
}

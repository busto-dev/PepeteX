import { z } from 'zod';

export const providerContextSchema = z.object({
  kind: z.enum(['gemini', 'openai-compatible', 'cliproxyapi']),
  baseUrl: z.string().nullable().optional(),
  credential: z.object({
    apiKey: z.string().optional().default(''),
    organizationId: z.string().optional(),
    projectId: z.string().optional(),
    customHeaders: z.record(z.string()).optional()
  }),
  model: z.string().min(1),
  manualModelIds: z.array(z.string()).optional()
});

export type WorkflowProviderContext = z.infer<typeof providerContextSchema>;

export const referenceFileInputSchema = z.object({
  id: z.string().optional(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative().optional(),
  pageCount: z.number().int().positive().optional(),
  imageWidth: z.number().int().positive().optional(),
  imageHeight: z.number().int().positive().optional(),
  usageHint: z.string().optional(),
  summary: z.string().optional(),
  contentBase64: z.string().optional(),
  providerFileId: z.string().optional(),
  providerFileUri: z.string().optional(),
  attachedToModel: z.boolean().optional(),
  attachmentMode: z.enum(['inline', 'provider-file', 'metadata-only']).optional(),
  attachmentReason: z.string().optional()
});

export const promptInputSchema = z.object({
  workspaceInstruction: z.string().optional(),
  designSystemInstruction: z.string().optional(),
  customPromptInstruction: z.string().optional(),
  manualInstruction: z.string().optional(),
  referenceFiles: z.array(referenceFileInputSchema).optional(),
  deckState: z.string().optional(),
  commentsAndTweaks: z.string().optional()
});

export const generationSettingsSchema = z.object({
  maxRepairAttempts: z.number().int().min(1).max(10).optional().default(3)
});

export const askModeOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  value: z.unknown()
});

export const askModeResultSchema = z.object({
  mode: z.literal('ask'),
  reason: z.string(),
  question: z.string(),
  options: z.array(askModeOptionSchema),
  allowManualAnswer: z.boolean(),
  required: z.boolean(),
  assumptionIfSkipped: z.string().optional()
});

export const askResumeSchema = z.object({
  answer: z.unknown(),
  answeredBy: z.string().optional()
});

export type AskResumeData = z.infer<typeof askResumeSchema>;

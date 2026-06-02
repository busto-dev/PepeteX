import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  providerContextSchema,
  askModeResultSchema,
  askResumeSchema
} from './schemas.js';

// Image generation runs outside the text generation path — it talks directly
// to image providers. We keep a lightweight Mastra workflow here so the
// orchestration layer can treat it uniformly (suspend/resume, monitoring).

const imageGenerationInputSchema = z.object({
  workspaceId: z.string(),
  deckId: z.string(),
  actorUserId: z.string(),
  /** Text provider context is kept for future multi-modal models. */
  provider: providerContextSchema.optional(),
  prompt: z.string().min(1),
  model: z.string().min(1),
  providerKind: z.enum(['imagen', 'gemini-image', 'gpt-image-2', 'openai-compatible']),
  count: z.number().int().min(1).max(10).default(1),
  aspectRatio: z.string().optional(),
  slideId: z.string().optional(),
  elementId: z.string().optional()
});

const imageGenerationOutputSchema = z.object({
  mode: z.enum(['images', 'refusal']),
  images: z.array(z.object({
    base64: z.string(),
    mimeType: z.string(),
    revisedPrompt: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional()
  })),
  model: z.string(),
  providerKind: z.string()
});

const generateImageStep = createStep({
  id: 'generateImage',
  description: 'Sends an image generation request to the configured image provider',
  inputSchema: imageGenerationInputSchema,
  outputSchema: imageGenerationOutputSchema,
  suspendSchema: askModeResultSchema,
  resumeSchema: askResumeSchema,
  execute: async ({ inputData }) => {
    // Actual image-provider calls happen in the worker via @pepetex/image-providers.
    // This workflow step is intentionally thin — it validates the input and returns
    // a passthrough so the worker can use the structured result format uniformly.
    return {
      mode: 'images' as const,
      images: [],
      model: inputData.model,
      providerKind: inputData.providerKind
    };
  }
});

export const generateImageWorkflow = createWorkflow({
  id: 'generateImageWorkflow',
  inputSchema: imageGenerationInputSchema,
  outputSchema: imageGenerationOutputSchema
})
  .then(generateImageStep)
  .commit();

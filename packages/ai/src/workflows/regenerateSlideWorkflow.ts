import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  providerContextSchema,
  promptInputSchema,
  generationSettingsSchema,
  askModeResultSchema,
  askResumeSchema
} from './schemas.js';
import { callGenerateStructured, slideHtmlDesignRequirements } from './helpers.js';
import {
  getPepeteXPatchOperationContract,
  getPepeteXRunModeContract,
  type PromptAssemblyInput
} from '@pepetex/prompts';
import { pickDefinedPromptInput } from './promptUtils.js';
import { validateAndRepairDeckPatchResult } from './repair.js';

const regenerateSlideInputSchema = z.object({
  workspaceId: z.string(),
  deckId: z.string(),
  slideId: z.string(),
  actorUserId: z.string(),
  regenerateInstruction: z.string().optional(),
  currentSlideSnapshot: z.string().optional(),
  provider: providerContextSchema,
  promptInput: promptInputSchema,
  settings: generationSettingsSchema.optional()
});

const regenerateSlideOutputSchema = z.object({
  mode: z.enum(['deck_patch', 'refusal']),
  result: z.unknown()
});

const regenerateSlideStep = createStep({
  id: 'regenerateSlide',
  description: 'Regenerates an existing slide, optionally with a new instruction',
  inputSchema: regenerateSlideInputSchema,
  outputSchema: regenerateSlideOutputSchema,
  suspendSchema: askModeResultSchema,
  resumeSchema: askResumeSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    const { promptInput, provider, slideId, regenerateInstruction, currentSlideSnapshot } =
      inputData;
    const { settings } = inputData;

    const resolvedPromptInput: PromptAssemblyInput = pickDefinedPromptInput({
      ...(promptInput as Record<string, unknown>),
      manualInstruction: buildRegenerateInstruction(
        slideId,
        regenerateInstruction,
        currentSlideSnapshot,
        resumeData ? String(resumeData.answer) : undefined
      )
    });

    const aiResult = await callGenerateStructured({
      provider,
      promptInput: resolvedPromptInput
    });

    if (aiResult.mode === 'ask') {
      return suspend(aiResult, { resumeLabel: aiResult.reason });
    }

    if (aiResult.mode === 'deck_patch') {
      const repaired = await validateAndRepairDeckPatchResult(
        {
          provider,
          promptInput: resolvedPromptInput,
          ...(settings?.maxRepairAttempts !== undefined
            ? { maxRepairAttempts: settings.maxRepairAttempts }
            : {})
        },
        aiResult
      );

      return {
        mode: repaired.result.mode as 'deck_patch' | 'refusal',
        result: repaired.result
      };
    }

    return {
      mode: aiResult.mode as 'deck_patch' | 'refusal',
      result: aiResult
    };
  }
});

export const regenerateSlideWorkflow = createWorkflow({
  id: 'regenerateSlideWorkflow',
  description: 'Regenerates an existing slide and returns a replace_slide patch',
  inputSchema: regenerateSlideInputSchema,
  outputSchema: regenerateSlideOutputSchema
})
  .then(regenerateSlideStep)
  .commit();

function buildRegenerateInstruction(
  slideId: string,
  regenerateInstruction?: string,
  currentSlideSnapshot?: string,
  clarification?: string
): string {
  const instructionSection = regenerateInstruction
    ? `Regeneration instruction: ${regenerateInstruction}`
    : 'Regenerate the slide with improved content and design.';

  const snapshotSection = currentSlideSnapshot
    ? `\n\nCurrent slide content for reference:\n${currentSlideSnapshot}`
    : '';

  const clarificationSection = clarification
    ? `\n\nUser clarification: ${clarification}`
    : '';

  return `## Task
Regenerate slide with ID "${slideId}" and return a replace_slide patch.

${instructionSection}${snapshotSection}${clarificationSection}

${slideHtmlDesignRequirements}

${getPepeteXRunModeContract()}

${getPepeteXPatchOperationContract()}

## Required Output Format

{
  "mode": "deck_patch",
  "schemaVersion": "pepetex.patch.v1",
  "patch": {
    "operations": [
      {
        "op": "replace_slide",
        "slideId": "${slideId}",
        "slide": {
          "id": "${slideId}",
          "title": "Slide title",
          "html": "<section class=\\"pepetex-slide\\" data-pepetex-slide-id=\\"${slideId}\\" data-pepetex-width=\\"1920\\" data-pepetex-height=\\"1080\\" style=\\"position:relative;width:1920px;height:1080px;overflow:hidden;background:linear-gradient(135deg,#0f172a 0%,#312e81 52%,#db2777 100%);color:#ffffff;\\">...</section>",
          "css": "[data-pepetex-slide-id=\\"${slideId}\\"] .card { border-radius: 32px; box-shadow: 0 24px 80px rgba(15,23,42,.25); }",
          "assets": [],
          "charts": []
        }
      }
    ]
  },
  "assumptions": [],
  "warnings": [],
  "userVisibleSummary": "Regenerated slide: <brief description of changes>"
}

Return exactly one replace_slide operation for slideId "${slideId}". Do not insert, delete, move, or patch unrelated slides.
If critical information is missing, return ask mode. If the request is impossible, return refusal mode.`;
}

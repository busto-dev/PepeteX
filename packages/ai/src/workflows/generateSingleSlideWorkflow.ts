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

const generateSingleSlideInputSchema = z.object({
  workspaceId: z.string(),
  deckId: z.string(),
  actorUserId: z.string(),
  slideInstruction: z.string().min(1),
  provider: providerContextSchema,
  promptInput: promptInputSchema,
  settings: generationSettingsSchema.optional()
});

const generateSingleSlideOutputSchema = z.object({
  mode: z.enum(['deck_patch', 'refusal']),
  result: z.unknown()
});

const generateSingleSlideStep = createStep({
  id: 'generateSingleSlide',
  description: 'Generates a single new slide and returns a deck_patch to append it',
  inputSchema: generateSingleSlideInputSchema,
  outputSchema: generateSingleSlideOutputSchema,
  suspendSchema: askModeResultSchema,
  resumeSchema: askResumeSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    const { promptInput, provider, slideInstruction, settings } = inputData;

    const resolvedPromptInput: PromptAssemblyInput = pickDefinedPromptInput({
      ...(promptInput as Record<string, unknown>),
      manualInstruction: buildSingleSlideInstruction(
        slideInstruction,
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

export const generateSingleSlideWorkflow = createWorkflow({
  id: 'generateSingleSlideWorkflow',
  description: 'Generates a single new slide and returns a patch to append it to the deck',
  inputSchema: generateSingleSlideInputSchema,
  outputSchema: generateSingleSlideOutputSchema
})
  .then(generateSingleSlideStep)
  .commit();

function buildSingleSlideInstruction(
  slideInstruction: string,
  clarification?: string
): string {
  const base = `## Task\nGenerate a single new slide to add to the existing deck.\n\nSlide request: ${slideInstruction}`;
  const clarificationSection = clarification
    ? `\n\nUser clarification: ${clarification}`
    : '';

  return `${base}${clarificationSection}

${slideHtmlDesignRequirements}

${getPepeteXRunModeContract()}

${getPepeteXPatchOperationContract()}

## Required Output Format

Return a deck_patch that inserts the new slide:
{
  "mode": "deck_patch",
  "schemaVersion": "pepetex.patch.v1",
  "patch": {
    "operations": [
      {
        "op": "insert_slide",
        "position": "end",
        "slide": {
          "id": "slide_<unique_id>",
          "title": "Slide title",
          "html": "<section class=\\"pepetex-slide\\" data-pepetex-slide-id=\\"slide_<unique_id>\\" data-pepetex-width=\\"1920\\" data-pepetex-height=\\"1080\\" style=\\"position:relative;width:1920px;height:1080px;overflow:hidden;background:linear-gradient(135deg,#0f172a 0%,#312e81 52%,#db2777 100%);color:#ffffff;\\">...</section>",
          "css": "[data-pepetex-slide-id=\\"slide_<unique_id>\\"] .card { border-radius: 32px; box-shadow: 0 24px 80px rgba(15,23,42,.25); }",
          "assets": [],
          "charts": [],
          "diagrams": []
        }
      }
    ]
  },
  "assumptions": [],
  "warnings": [],
  "userVisibleSummary": "Added slide: <brief description>"
}

Return exactly one insert_slide operation. Do not modify, replace, delete, move, or restyle any existing slide.
If critical information is missing, return ask mode. If the request is impossible, return refusal mode.`;
}

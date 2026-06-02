import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  providerContextSchema,
  promptInputSchema,
  generationSettingsSchema,
  askModeResultSchema,
  askResumeSchema
} from './schemas.js';
import { callGenerateStructured } from './helpers.js';
import {
  getPepeteXPatchOperationContract,
  getPepeteXRunModeContract,
  type PromptAssemblyInput
} from '@pepetex/prompts';
import { pickDefinedPromptInput } from './promptUtils.js';
import { validateAndRepairDeckPatchResult } from './repair.js';

const tweakItemInputSchema = z.object({
  scope: z.enum(['DECK', 'SLIDE', 'ELEMENT']),
  slideId: z.string().nullable().optional(),
  elementId: z.string().nullable().optional(),
  category: z.string(),
  value: z.unknown()
});

const applyTweaksInputSchema = z.object({
  workspaceId: z.string(),
  deckId: z.string(),
  actorUserId: z.string(),
  provider: providerContextSchema,
  promptInput: promptInputSchema,
  tweaks: z.array(tweakItemInputSchema).min(1),
  currentDeckJson: z.string().optional(),
  settings: generationSettingsSchema.optional()
});

const applyTweaksOutputSchema = z.object({
  mode: z.enum(['deck_patch', 'refusal']),
  result: z.unknown(),
  userVisibleSummary: z.string()
});

const applyTweaksStep = createStep({
  id: 'applyTweaks',
  description: 'Applies a structured tweak batch to the deck as a patch',
  inputSchema: applyTweaksInputSchema,
  outputSchema: applyTweaksOutputSchema,
  suspendSchema: askModeResultSchema,
  resumeSchema: askResumeSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    const { promptInput, provider, tweaks, currentDeckJson, settings } = inputData;

    const resolvedPromptInput: PromptAssemblyInput = pickDefinedPromptInput({
      ...(promptInput as Record<string, unknown>),
      commentsAndTweaks: buildTweaksContext(tweaks, resumeData?.answer),
      ...(currentDeckJson ? { deckState: currentDeckJson } : {})
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

      const summary =
        repaired.result.mode === 'deck_patch'
          ? (repaired.result as { userVisibleSummary?: string }).userVisibleSummary ??
            `Applied ${tweaks.length} tweak(s) to the deck.`
          : 'Tweak application was refused.';

      return {
        mode: repaired.result.mode as 'deck_patch' | 'refusal',
        result: repaired.result,
        userVisibleSummary: summary
      };
    }

    return {
      mode: aiResult.mode as 'deck_patch' | 'refusal',
      result: aiResult,
      userVisibleSummary:
        aiResult.mode === 'refusal'
          ? (aiResult as { userVisibleMessage?: string }).userVisibleMessage ?? 'Request refused.'
          : `Applied ${tweaks.length} tweak(s).`
    };
  }
});

export const applyTweaksWorkflow = createWorkflow({
  id: 'applyTweaksWorkflow',
  description: 'Applies a structured tweak batch to the deck and returns a deck patch',
  inputSchema: applyTweaksInputSchema,
  outputSchema: applyTweaksOutputSchema
})
  .then(applyTweaksStep)
  .commit();

function buildTweaksContext(
  tweaks: Array<{
    scope: 'DECK' | 'SLIDE' | 'ELEMENT';
    slideId?: string | null | undefined;
    elementId?: string | null | undefined;
    category: string;
    value?: unknown;
  }>,
  clarification?: unknown
): string {
  const tweakLines = tweaks.map((tweak, index) => {
    const scopeLabel =
      tweak.scope === 'DECK'
        ? 'Whole deck'
        : tweak.scope === 'SLIDE'
          ? `Slide ${tweak.slideId ?? 'unknown'}`
          : `Element ${tweak.elementId ?? 'unknown'} on slide ${tweak.slideId ?? 'unknown'}`;

    return `${index + 1}. [${scopeLabel}] ${tweak.category}: ${JSON.stringify(tweak.value)}`;
  });

  const base = `## Tweaks to Apply\n\nThe following structured design tweaks have been submitted. Apply only this submitted tweak batch:\n\n${tweakLines.join('\n')}`;

  const clarificationSection =
    clarification != null ? `\n\nUser clarification: ${String(clarification)}` : '';

  return `${base}${clarificationSection}

${getPepeteXRunModeContract()}

${getPepeteXPatchOperationContract()}

## Required Output Format

Return a deck_patch that restyled the slides to match the tweaks:
{
  "mode": "deck_patch",
  "schemaVersion": "pepetex.patch.v1",
  "patch": {
    "operations": [
      { "op": "replace_slide", "slideId": "slide_id", "slide": { "id": "slide_id", "title": "Slide title", "html": "<section class='pepetex-slide' data-pepetex-slide-id='slide_id' data-pepetex-width='1920' data-pepetex-height='1080' style='position:relative;width:1920px;height:1080px;overflow:hidden;'>...</section>", "css": "", "assets": [], "charts": [], "diagrams": [] } }
    ]
  },
  "assumptions": [],
  "warnings": [],
  "userVisibleSummary": "Restyled deck: brief description of changes"
}

Allowed operation names are exactly: replace_slide, update_text, update_element_style, update_element_attributes, replace_element_html, insert_slide, delete_slide, move_slide. Do not invent names such as update_slide, restyle_slide, or modify_element.
Scope rule: DECK tweaks may affect multiple slides, SLIDE tweaks affect only the named slide, and ELEMENT tweaks affect only that element unless a small nearby layout adjustment is required to keep the slide valid.
Do not rewrite narrative, change factual content, add slides, delete slides, reorder slides, or apply unrelated quality repairs unless the submitted tweak explicitly asks for it.

If a tweak cannot be applied without breaking export constraints, explain in warnings. If the request is impossible, return refusal mode.`;
}

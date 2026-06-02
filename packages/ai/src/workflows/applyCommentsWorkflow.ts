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

const commentInputSchema = z.object({
  id: z.string(),
  slideId: z.string().nullable().optional(),
  elementIds: z.array(z.string()),
  text: z.string()
});

const applyCommentsInputSchema = z.object({
  workspaceId: z.string(),
  deckId: z.string(),
  actorUserId: z.string(),
  provider: providerContextSchema,
  promptInput: promptInputSchema,
  comments: z.array(commentInputSchema).min(1),
  currentDeckJson: z.string().optional(),
  settings: generationSettingsSchema.optional()
});

const applyCommentsOutputSchema = z.object({
  mode: z.enum(['deck_patch', 'refusal']),
  result: z.unknown(),
  userVisibleSummary: z.string()
});

const applyCommentsStep = createStep({
  id: 'applyComments',
  description: 'Applies a batch of submitted comments to the deck as a patch',
  inputSchema: applyCommentsInputSchema,
  outputSchema: applyCommentsOutputSchema,
  suspendSchema: askModeResultSchema,
  resumeSchema: askResumeSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    const { promptInput, provider, comments, currentDeckJson, settings } = inputData;

    const resolvedPromptInput: PromptAssemblyInput = pickDefinedPromptInput({
      ...(promptInput as Record<string, unknown>),
      commentsAndTweaks: buildCommentsContext(comments, resumeData?.answer),
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
            `Applied ${comments.length} comment(s) to the deck.`
          : 'Comment application was refused.';

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
          ? (aiResult as { userVisibleMessage?: string }).userVisibleMessage ??
            'Request refused.'
          : `Applied ${comments.length} comment(s).`
    };
  }
});

export const applyCommentsWorkflow = createWorkflow({
  id: 'applyCommentsWorkflow',
  description: 'Applies a submitted comment batch to the deck and returns a deck patch',
  inputSchema: applyCommentsInputSchema,
  outputSchema: applyCommentsOutputSchema
})
  .then(applyCommentsStep)
  .commit();

function buildCommentsContext(
  comments: Array<{ id: string; slideId?: string | null | undefined; elementIds: string[]; text: string }>,
  clarification?: unknown
): string {
  const commentLines = comments.map((comment, index) => {
    const location = comment.slideId
      ? `Slide ${comment.slideId}${comment.elementIds.length > 0 ? `, elements: ${comment.elementIds.join(', ')}` : ''}`
      : 'Whole deck';

    return `${index + 1}. [id=${comment.id}; ${location}] ${comment.text}`;
  });

  const base = `## Comments to Apply\n\nThe following comments have been submitted by users. Apply only these comments as a deck patch:\n\n${commentLines.join('\n')}`;

  const clarificationSection =
    clarification != null ? `\n\nUser clarification: ${String(clarification)}` : '';

  return `${base}${clarificationSection}

${getPepeteXRunModeContract()}

${getPepeteXPatchOperationContract()}

## Required Output Format

Return a deck_patch addressing all comments:
{
  "mode": "deck_patch",
  "schemaVersion": "pepetex.patch.v1",
  "patch": {
    "operations": [
      { "op": "update_text", "slideId": "slide_id", "elementId": "data-pepetex-id", "text": "Replacement text", "commentIds": ["comment_id"] },
      { "op": "update_element_style", "slideId": "slide_id", "elementId": "data-pepetex-id", "styles": { "color": "#ef4444" }, "commentIds": ["comment_id"] },
      { "op": "update_element_attributes", "slideId": "slide_id", "elementId": "data-pepetex-id", "attributes": { "alt": "Image description" }, "commentIds": ["comment_id"] },
      { "op": "replace_element_html", "slideId": "slide_id", "elementId": "data-pepetex-id", "html": "<div data-pepetex-id='data-pepetex-id' data-pepetex-type='body'>Replacement subtree</div>", "commentIds": ["comment_id"] },
      { "op": "replace_slide", "slideId": "slide_id", "slide": { "id": "slide_id", "title": "Slide title", "html": "<section class='pepetex-slide' data-pepetex-slide-id='slide_id' data-pepetex-width='1920' data-pepetex-height='1080' style='position:relative;width:1920px;height:1080px;overflow:hidden;'>...</section>", "css": "", "assets": [], "charts": [], "diagrams": [] }, "commentIds": ["comment_id"] }
    ]
  },
  "assumptions": [],
  "warnings": [],
  "userVisibleSummary": "Applied N comment(s): brief summary of changes"
}

Allowed operation names are exactly: update_text, update_element_style, update_element_attributes, replace_element_html, replace_slide, insert_slide, delete_slide, move_slide. Do not invent names such as edit_text, update_slide, comment_applied, or modify_element.
Use update_text for targeted copy changes. Use update_element_style for simple selected-element visual changes such as color, fill, background, border, stroke, opacity, or shadow. Use update_element_attributes for safe alt/title/ARIA/managed src metadata. Use replace_element_html when one selected content block must be rewritten. Use replace_slide only when the comment is slide-level or structural.
Every operation that addresses a submitted comment must include that submitted id in commentIds. Address every submitted comment id before returning.
For text-only comments on a specific data-pepetex-id, return only an update_text operation for that element. Do not include full slide HTML/CSS and do not repair unrelated quality warnings.
Do not change slides, elements, language, visual style, or content that the submitted comments did not ask to change.

If a comment cannot be applied, explain why in warnings. If applying comments is fundamentally impossible or unsafe, return refusal mode.`;
}

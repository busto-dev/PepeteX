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
  getPepeteXRunModeContract,
  type PromptAssemblyInput
} from '@pepetex/prompts';
import { pickDefinedPromptInput } from './promptUtils.js';
import { validateAndRepairDeckGenerationResult } from './repair.js';

const generateDeckInputSchema = z.object({
  workspaceId: z.string(),
  deckId: z.string().optional(),
  actorUserId: z.string(),
  provider: providerContextSchema,
  promptInput: promptInputSchema,
  settings: generationSettingsSchema.optional()
});

const generateDeckOutputSchema = z.object({
  mode: z.enum(['deck', 'refusal']),
  result: z.unknown()
});

const assembleContextStep = createStep({
  id: 'assembleContext',
  description: 'Builds the prompt input with deck generation schema instructions',
  inputSchema: generateDeckInputSchema,
  outputSchema: z.object({
    promptInput: promptInputSchema,
    provider: providerContextSchema,
    settings: generationSettingsSchema.optional()
  }),
  execute: async ({ inputData }) => {
    const base = inputData.promptInput;
    const deckSchemaInstruction = buildDeckSchemaInstruction();
    const enrichedManual = base.manualInstruction
      ? `${base.manualInstruction}\n\n${deckSchemaInstruction}`
      : deckSchemaInstruction;

    const promptInput = pickDefinedPromptInput({ ...base as Record<string, unknown>, manualInstruction: enrichedManual });

    return {
      promptInput,
      provider: inputData.provider,
      ...(inputData.settings !== undefined ? { settings: inputData.settings } : {})
    };
  }
});

const generateDeckStep = createStep({
  id: 'generateDeck',
  description: 'Calls the AI provider to generate the deck or enter ASK mode',
  inputSchema: z.object({
    promptInput: promptInputSchema,
    provider: providerContextSchema,
    settings: generationSettingsSchema.optional()
  }),
  outputSchema: generateDeckOutputSchema,
  suspendSchema: askModeResultSchema,
  resumeSchema: askResumeSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    const { promptInput, provider, settings } = inputData;

    const resolvedPromptInput: PromptAssemblyInput = pickDefinedPromptInput(promptInput as Record<string, unknown>);

    if (resumeData) {
      const answerText =
        typeof resumeData.answer === 'string'
          ? resumeData.answer
          : JSON.stringify(resumeData.answer);
      const existing = resolvedPromptInput.manualInstruction ?? '';
      resolvedPromptInput.manualInstruction = `${existing}\n\nUser clarification: ${answerText}`.trim();
    }

    const aiResult = await callGenerateStructured({
      provider,
      promptInput: resolvedPromptInput
    });

    if (aiResult.mode === 'ask') {
      return suspend(aiResult, { resumeLabel: aiResult.reason });
    }

    if (aiResult.mode === 'deck') {
      const repaired = await validateAndRepairDeckGenerationResult(
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
        mode: repaired.result.mode as 'deck' | 'refusal',
        result: repaired.result
      };
    }

    return {
      mode: aiResult.mode as 'deck' | 'refusal',
      result: aiResult
    };
  }
});

export const generateDeckWorkflow = createWorkflow({
  id: 'generateDeckWorkflow',
  description: 'Generates a full presentation deck, with optional ASK mode pause for clarification',
  inputSchema: generateDeckInputSchema,
  outputSchema: generateDeckOutputSchema
})
  .then(assembleContextStep)
  .then(generateDeckStep)
  .commit();

function buildDeckSchemaInstruction(): string {
  return `${slideHtmlDesignRequirements}

${getPepeteXRunModeContract()}

## Full Deck Planning Defaults

This is a full-deck generation request. Do not default to a minimal outline.

- Infer the deck type from the prompt: pitch, strategy, status update, lesson, proposal, report, workshop, portfolio, training, or another appropriate archetype.
- Infer the audience and their likely questions, then choose a beginning/middle/end narrative that answers those questions.
- Choose slide count from the complexity of the request. If the user does not specify a count, create enough slides to satisfy the prompt with one main takeaway per slide. Broad requests usually need 6-12 slides or more, not 3 generic slides.
- If the user explicitly asks for a short, minimal, outline-only, or exact low-slide-count deck, honor that constraint while still making each slide useful.
- Include concrete examples, data placeholders, risks, decisions, tradeoffs, or next actions when relevant to the topic.
- Use structured charts when a slide naturally needs comparison, allocation, trend, funnel, traction, market, benchmark, or progress evidence. If no exact data is supplied, illustrative dummy values are allowed only when visibly and subtly labeled, and the chart sourceRef must say "Illustrative model estimate" or similar.
- Vary composition and visual anchors across the deck. Avoid repeating title/body/card-grid layouts.
- Use specific slide titles that communicate the point of the slide, not generic labels.
- For pitch, investor, fundraising, sales, strategy, or business-plan decks, return ask mode when company/product/customer/stage/traction/funding details are missing enough that generated content would be fictional.

## Required Output Format

Return a single JSON object. Choose one of these modes:

**Mode: deck** (when you have enough information)
{
  "mode": "deck",
  "schemaVersion": "pepetex.deck.v1",
  "deck": {
    "title": "Deck title",
    "language": "en",
    "aspectRatio": "16:9",
    "canvas": { "width": 1920, "height": 1080 },
    "slides": [
      {
        "id": "slide_01",
        "title": "Slide title",
        "html": "<section class=\\"pepetex-slide\\" data-pepetex-slide-id=\\"slide_01\\" data-pepetex-width=\\"1920\\" data-pepetex-height=\\"1080\\" style=\\"position:relative;width:1920px;height:1080px;overflow:hidden;background:linear-gradient(135deg,#0f172a 0%,#312e81 52%,#db2777 100%);color:#ffffff;\\"><div data-pepetex-id=\\"chart_growth\\" data-pepetex-type=\\"chart\\" data-pepetex-chart-id=\\"chart_growth\\"></div><p>Illustrative model estimate</p></section>",
        "css": "[data-pepetex-slide-id=\\"slide_01\\"] .card { border-radius: 32px; box-shadow: 0 24px 80px rgba(15,23,42,.25); }",
        "assets": [],
        "charts": [{ "id": "chart_growth", "kind": "bar", "title": "Illustrative growth path", "categories": ["Q1", "Q2", "Q3"], "series": [{ "name": "Revenue", "values": [20, 34, 52] }], "sourceRef": "Illustrative model estimate" }],
        "diagrams": []
      }
    ]
  },
  "assumptions": [],
  "warnings": [],
  "designSystemRulesUsed": []
}

**Mode: ask** (when critical information is missing)
{
  "mode": "ask",
  "reason": "missing_deck_structure",
  "question": "What is the main topic of your presentation?",
  "options": [{ "id": "1", "label": "Business pitch", "value": "business_pitch" }],
  "allowManualAnswer": true,
  "required": true
}

**Mode: refusal** (when request is impossible or out of scope)
{
  "mode": "refusal",
  "reason": "unsupported_feature",
  "userVisibleMessage": "Sorry, this request cannot be completed."
}`;
}

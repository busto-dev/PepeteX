import {
  validateGeneratedDeckContract,
  validateSlide,
  type SlideValidationResult,
  type ValidationError,
  type ValidationWarning
} from '@pepetex/html-contract';
import type { PromptAssemblyInput } from '@pepetex/prompts';

import {
  pepeteXDeckSchemaVersion,
  pepeteXPatchSchemaVersion,
  type DeckGenerationResult,
  type DeckPatchOperation,
  type DeckPatchResult,
  type GeneratedSlide,
  type RefusalResult
} from '../index.js';
import { inspectDeckQuality, type DeckQualityReport } from '../agent/quality.js';
import { callGenerateStructured } from './helpers.js';
import { pickDefinedPromptInput } from './promptUtils.js';
import type { WorkflowProviderContext } from './schemas.js';

const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;

interface RepairLoopContext {
  provider: WorkflowProviderContext;
  promptInput: PromptAssemblyInput;
  maxRepairAttempts?: number;
  assetUrls?: Record<string, string>;
  allowedAssetHosts?: string[];
}

export interface RepairIssuePayload {
  code: ValidationError['code'];
  path?: string;
  message: string;
  repairHint: string;
  elementSnippet?: string;
}

export interface RepairWarningPayload {
  code: ValidationWarning['code'];
  path?: string;
  message: string;
}

export interface DeckRepairSlidePayload {
  slideId: string;
  title: string;
  severity: SlideValidationResult['severity'];
  html: string;
  css: string;
  normalizedHtml?: string;
  normalizedCss?: string;
  errors: RepairIssuePayload[];
  warnings: RepairWarningPayload[];
}

export interface DeckRepairPromptPayload {
  target: 'deck';
  deckTitle: string;
  language: string;
  slideCount: number;
  slidesToRepair: DeckRepairSlidePayload[];
}

export interface DeckPatchRepairTargetPayload {
  operationIndex: number;
  op: 'replace_slide' | 'insert_slide';
  slideId: string;
  title: string;
  severity: SlideValidationResult['severity'];
  html: string;
  css: string;
  normalizedHtml?: string;
  normalizedCss?: string;
  errors: RepairIssuePayload[];
  warnings: RepairWarningPayload[];
}

export interface DeckPatchRepairPromptPayload {
  target: 'deck_patch';
  operationCount: number;
  targetsToRepair: DeckPatchRepairTargetPayload[];
}

interface RepairLoopResult<T> {
  result: T;
  repairAttempts: number;
}

interface RepairablePatchTarget {
  operationIndex: number;
  operation: Extract<DeckPatchOperation, { op: 'replace_slide' | 'insert_slide' }>;
  validation: SlideValidationResult;
}

export function buildDeckRepairPromptPayload(
  result: DeckGenerationResult,
  validationResults: SlideValidationResult[]
): DeckRepairPromptPayload {
  const slidesToRepair = result.deck.slides.flatMap((slide, index) => {
    const validation = validationResults[index];
    if (!validation || isValidationClean(validation)) {
      return [];
    }

    return [buildDeckRepairSlidePayload(slide, validation)];
  });

  return {
    target: 'deck',
    deckTitle: result.deck.title,
    language: result.deck.language,
    slideCount: result.deck.slides.length,
    slidesToRepair
  };
}

export function buildDeckPatchRepairPromptPayload(
  result: DeckPatchResult,
  targets: RepairablePatchTarget[]
): DeckPatchRepairPromptPayload {
  return {
    target: 'deck_patch',
    operationCount: result.patch.operations.length,
    targetsToRepair: targets.map((target) => ({
      operationIndex: target.operationIndex,
      op: target.operation.op,
      ...buildDeckRepairSlidePayload(target.operation.slide, target.validation)
    }))
  };
}

export async function validateAndRepairDeckGenerationResult(
  context: RepairLoopContext,
  initialResult: DeckGenerationResult
): Promise<RepairLoopResult<DeckGenerationResult | RefusalResult>> {
  const maxRepairAttempts = context.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;
  let currentResult: DeckGenerationResult = initialResult;
  let repairAttempts = 0;

  while (true) {
    const validationResults = validateGeneratedDeckContract({
      deck: currentResult.deck,
      ...(context.assetUrls ? { assetUrls: context.assetUrls } : {}),
      ...(context.allowedAssetHosts ? { allowedAssetHosts: context.allowedAssetHosts } : {})
    });

    if (validationResults.every(isValidationClean)) {
      const qualityReport = inspectDeckQuality(
        currentResult.deck,
        buildDeckQualityInspectionOptions(context.promptInput.manualInstruction)
      );

      if (qualityReport.ok) {
        return {
          result: currentResult,
          repairAttempts
        };
      }

      if (repairAttempts >= maxRepairAttempts) {
        throw new Error(
          `PepeteX deck quality repair failed after ${repairAttempts} attempts: ${summarizeDeckQualityFailures(qualityReport)}`
        );
      }

      repairAttempts += 1;
      const repairInstruction = buildDeckQualityRepairInstruction(
        context.promptInput.manualInstruction,
        currentResult,
        qualityReport,
        repairAttempts
      );

      const repairResult = await callGenerateStructured({
        provider: context.provider,
        promptInput: createRepairPromptInput(context.promptInput, repairInstruction)
      });

      if (repairResult.mode === 'refusal') {
        return {
          result: repairResult,
          repairAttempts
        };
      }

      if (repairResult.mode !== 'deck') {
        throw new Error(
          `PepeteX deck quality repair attempt ${repairAttempts} returned unexpected mode "${repairResult.mode}".`
        );
      }

      currentResult = repairResult;
      continue;
    }

    if (repairAttempts >= maxRepairAttempts) {
      throw new Error(
        `PepeteX deck repair failed after ${repairAttempts} attempts: ${summarizeSlideValidationFailures(validationResults, currentResult.deck.slides)}`
      );
    }

    repairAttempts += 1;
    const repairPayload = buildDeckRepairPromptPayload(currentResult, validationResults);
    const repairInstruction = buildDeckRepairInstruction(
      context.promptInput.manualInstruction,
      repairPayload,
      repairAttempts
    );

    const repairResult = await callGenerateStructured({
      provider: context.provider,
      promptInput: createRepairPromptInput(context.promptInput, repairInstruction)
    });

    if (repairResult.mode === 'refusal') {
      return {
        result: repairResult,
        repairAttempts
      };
    }

    if (repairResult.mode !== 'deck') {
      throw new Error(
        `PepeteX deck repair attempt ${repairAttempts} returned unexpected mode "${repairResult.mode}".`
      );
    }

    currentResult = repairResult;
  }
}

export async function validateAndRepairDeckPatchResult(
  context: RepairLoopContext,
  initialResult: DeckPatchResult
): Promise<RepairLoopResult<DeckPatchResult | RefusalResult>> {
  const maxRepairAttempts = context.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;
  let currentResult: DeckPatchResult = initialResult;
  let repairAttempts = 0;

  while (true) {
    const targets = collectRepairablePatchTargets(
      currentResult,
      context.assetUrls,
      context.allowedAssetHosts
    );

    if (targets.every((target) => isValidationClean(target.validation))) {
      return {
        result: currentResult,
        repairAttempts
      };
    }

    if (repairAttempts >= maxRepairAttempts) {
      throw new Error(
        `PepeteX patch repair failed after ${repairAttempts} attempts: ${summarizePatchValidationFailures(targets)}`
      );
    }

    repairAttempts += 1;
    const repairPayload = buildDeckPatchRepairPromptPayload(
      currentResult,
      targets.filter((target) => !isValidationClean(target.validation))
    );
    const repairInstruction = buildDeckPatchRepairInstruction(
      context.promptInput.manualInstruction,
      repairPayload,
      repairAttempts
    );

    const repairResult = await callGenerateStructured({
      provider: context.provider,
      promptInput: createRepairPromptInput(context.promptInput, repairInstruction)
    });

    if (repairResult.mode === 'refusal') {
      return {
        result: repairResult,
        repairAttempts
      };
    }

    if (repairResult.mode !== 'deck_patch') {
      throw new Error(
        `PepeteX patch repair attempt ${repairAttempts} returned unexpected mode "${repairResult.mode}".`
      );
    }

    currentResult = repairResult;
  }
}

function buildDeckQualityInspectionOptions(originalManualInstruction: string | undefined): {
  requireSubstantialDeck: boolean;
  minSlideCount: number;
} {
  const promptText = originalManualInstruction ?? '';
  const requestedSlideCount = extractRequestedSlideCount(promptText);
  const asksForBriefDeck = /\b(short|brief|minimal|minimalist|quick|outline only|draft outline|few slides|one-pager|single slide|summary only)\b/i.test(promptText);
  const requireSubstantialDeck = !asksForBriefDeck && !(requestedSlideCount !== null && requestedSlideCount <= 5);

  return {
    requireSubstantialDeck,
    minSlideCount: requestedSlideCount && requestedSlideCount > 5 ? requestedSlideCount : 6
  };
}

function extractRequestedSlideCount(input: string): number | null {
  const numericMatch = input.match(/\b(\d{1,2})\s*(?:slides?|pages?)\b/i);
  if (numericMatch?.[1]) {
    const value = Number(numericMatch[1]);
    return Number.isFinite(value) ? value : null;
  }

  const wordToNumber: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12
  };
  const wordMatch = input.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:slides?|pages?)\b/i);
  return wordMatch?.[1] ? wordToNumber[wordMatch[1].toLowerCase()] ?? null : null;
}

function buildDeckQualityRepairInstruction(
  originalManualInstruction: string | undefined,
  result: DeckGenerationResult,
  qualityReport: DeckQualityReport,
  repairAttempt: number
): string {
  const payload = {
    target: 'deck_quality',
    deckTitle: result.deck.title,
    language: result.deck.language,
    slideCount: result.deck.slides.length,
    issues: qualityReport.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      repairHint: issue.repairHint,
      ...(issue.slideId ? { slideId: issue.slideId } : {})
    })),
    currentSlides: result.deck.slides.map((slide, index) => ({
      position: index + 1,
      id: slide.id,
      title: slide.title
    }))
  };

  return [
    '## Task',
    'Repair the generated PepeteX deck so it is a complete, useful, high-quality presentation, not a shallow outline.',
    `Repair attempt: ${repairAttempt}.`,
    originalManualInstruction
      ? `Original user instruction:\n${originalManualInstruction}`
      : 'Original user instruction was not supplied separately; preserve the current deck intent and improve quality.',
    '',
    '## Quality Repair Rules',
    '- Return mode "deck". Do not return ask mode.',
    '- Return the JSON object directly. Do not wrap it in a string, array, markdown code fence, or result/output envelope.',
    '- Preserve explicit user constraints, especially exact slide counts or short/minimal requests.',
    '- If the deck is underdeveloped and no explicit short deck was requested, add enough slides to create a complete beginning/middle/end narrative.',
    '- Give each slide one main takeaway and a specific title that communicates the point of the slide.',
    '- Replace generic outline slides with useful context, evidence, examples, implications, decisions, risks, recommendations, or next actions as appropriate.',
    '- Vary layout composition and visual anchors across the deck. Avoid repeated card grids and dense prose.',
    '- Keep every slide safe for PepeteX HTML contract validation, with stable data-pepetex-id and data-pepetex-type targets.',
    '',
    '## Quality Payload',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    '## Required Output Format',
    '{',
    '  "mode": "deck",',
    `  "schemaVersion": "${pepeteXDeckSchemaVersion}",`,
    '  "deck": {',
    '    "title": "Deck title",',
    '    "language": "en",',
    '    "aspectRatio": "16:9",',
    '    "canvas": { "width": 1920, "height": 1080 },',
    '    "slides": [',
    '      {',
    '        "id": "slide_01",',
    '        "title": "Specific slide takeaway",',
    '        "html": "<section class=\\"pepetex-slide\\" data-pepetex-slide-id=\\"slide_01\\" style=\\"position:relative;width:1920px;height:1080px;overflow:hidden;\\">...</section>",',
    '        "css": "",',
    '        "assets": [],',
    '        "charts": []',
    '      }',
    '    ]',
    '  },',
    '  "assumptions": [],',
    '  "warnings": [],',
    '  "designSystemRulesUsed": []',
    '}'
  ].join('\n');
}

function summarizeDeckQualityFailures(qualityReport: DeckQualityReport): string {
  return qualityReport.issues
    .filter((issue) => issue.severity === 'error')
    .slice(0, 4)
    .map((issue) => `${issue.code}${issue.slideId ? ` on ${issue.slideId}` : ''}`)
    .join('; ');
}

function buildDeckRepairSlidePayload(
  slide: GeneratedSlide,
  validation: SlideValidationResult
): DeckRepairSlidePayload {
  return {
    slideId: slide.id,
    title: slide.title,
    severity: validation.severity,
    html: slide.html,
    css: slide.css,
    ...(validation.normalizedHtml ? { normalizedHtml: validation.normalizedHtml } : {}),
    ...(validation.normalizedCss ? { normalizedCss: validation.normalizedCss } : {}),
    errors: validation.errors.map((error) => ({
      code: error.code,
      ...(error.path ? { path: error.path } : {}),
      message: error.message,
      repairHint: error.repairHint,
      ...(error.elementSnippet ? { elementSnippet: error.elementSnippet } : {})
    })),
    warnings: validation.warnings.map((warning) => ({
      code: warning.code,
      ...(warning.path ? { path: warning.path } : {}),
      message: warning.message
    }))
  };
}

function collectRepairablePatchTargets(
  result: DeckPatchResult,
  assetUrls?: Record<string, string>,
  allowedAssetHosts?: string[]
): RepairablePatchTarget[] {
  return result.patch.operations.flatMap((operation, operationIndex) => {
    if (operation.op !== 'replace_slide' && operation.op !== 'insert_slide') {
      return [];
    }

    const validation = validateSlide({
      slideId: operation.slide.id,
      html: operation.slide.html,
      css: operation.slide.css,
      ...(assetUrls ? { assetUrls } : {}),
      ...(allowedAssetHosts ? { allowedAssetHosts } : {})
    });

    return [
      {
        operationIndex,
        operation,
        validation
      }
    ];
  });
}

function createRepairPromptInput(
  promptInput: PromptAssemblyInput,
  repairInstruction: string
): PromptAssemblyInput {
  return pickDefinedPromptInput({
    ...(promptInput as Record<string, unknown>),
    manualInstruction: repairInstruction
  });
}

function buildDeckRepairInstruction(
  originalManualInstruction: string | undefined,
  payload: DeckRepairPromptPayload,
  repairAttempt: number
): string {
  const strategy =
    repairAttempt <= 1
      ? [
          '## Strategy (attempt 1: targeted patch)',
          '- Make the minimum changes needed to resolve every listed validation error.',
          '- Keep slide narrative, copy, layout, and styling intact except where required by the listed errors.',
          '- Use the elementSnippet on each error to locate the offending element exactly. Error paths are relative to the slide root (the <section class="pepetex-slide">). Wrapper tags from validation are not shown.',
          ''
        ]
      : repairAttempt === 2
        ? [
            '## Strategy (attempt 2: regenerate failing slides from scratch)',
            '- Fully rewrite the HTML and CSS of each slide listed in slidesToRepair, keeping the slide id and the original intent of the slide title.',
            '- Discard the prior broken HTML; do not try to patch it. Build a fresh, contract-clean composition.',
            '- Do not modify slides that are not listed in slidesToRepair.',
            ''
          ]
        : [
            '## Strategy (attempt 3: minimal compliant fallback)',
            '- For each slide in slidesToRepair, output the simplest possible PepeteX-contract-compliant version: a single <section class="pepetex-slide"> root with a headline, an optional body paragraph, and at most one card or image. Use only safe inline styles.',
            '- Preserve slide ids, titles, and overall narrative position. Do not invent new types.',
            '- Do not modify slides that are not listed in slidesToRepair.',
            ''
          ];

  return [
    '## Task',
    'Repair the generated PepeteX deck so it fully passes the PepeteX HTML contract while preserving the original user intent.',
    `Repair attempt: ${repairAttempt}.`,
    originalManualInstruction
      ? `Original user instruction:\n${originalManualInstruction}`
      : 'Original user instruction was not supplied separately; preserve the current deck intent and structure.',
    '',
    ...strategy,
    '## Repair Rules',
    '- Return mode "deck". Do not return ask mode.',
    '- Return the JSON object directly. Do not wrap it in a string, array, markdown code fence, or result/output envelope.',
    '- Keep the same deck title, language, aspect ratio, canvas, and slide count unless a listed contract issue makes that impossible.',
    '- Preserve every slide id and existing data-pepetex-id/data-pepetex-type pairing whenever possible.',
    '- Repair only the invalid slides listed in the payload and keep all other slides semantically unchanged.',
    '- data-pepetex-id and data-pepetex-type must always come together. Plain layout <div>s used only for flexbox/grid/positioning must NOT carry data-pepetex-* attributes.',
    '- Resolve every validation error and follow every repairHint exactly.',
    '- Warnings may stay only if they remain within PepeteX rules and do not require technical user intervention.',
    '',
    '## Repair Payload',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    '## Required Output Format',
    '{',
    '  "mode": "deck",',
    `  "schemaVersion": "${pepeteXDeckSchemaVersion}",`,
    '  "deck": {',
    '    "title": "Deck title",',
    '    "language": "en",',
    '    "aspectRatio": "16:9",',
    '    "canvas": { "width": 1920, "height": 1080 },',
    '    "slides": [',
    '      {',
    '        "id": "slide_01",',
    '        "title": "Slide title",',
    '        "html": "<section class=\\"pepetex-slide\\" data-pepetex-slide-id=\\"slide_01\\" style=\\"position:relative;width:1920px;height:1080px;overflow:hidden;\\">...</section>",',
    '        "css": "",',
    '        "assets": [],',
    '        "charts": []',
    '      }',
    '    ]',
    '  },',
    '  "assumptions": [],',
    '  "warnings": [],',
    '  "designSystemRulesUsed": []',
    '}'
  ].join('\n');
}

function buildDeckPatchRepairInstruction(
  originalManualInstruction: string | undefined,
  payload: DeckPatchRepairPromptPayload,
  repairAttempt: number
): string {
  return [
    '## Task',
    'Repair the generated PepeteX deck patch so every changed slide passes the PepeteX HTML contract while preserving the requested patch behavior.',
    `Repair attempt: ${repairAttempt}.`,
    originalManualInstruction
      ? `Original user instruction:\n${originalManualInstruction}`
      : 'Original user instruction was not supplied separately; preserve the current patch intent.',
    '',
    '## Repair Rules',
    '- Return mode "deck_patch". Do not return ask mode.',
    '- Return the JSON object directly. Do not wrap it in a string, array, markdown code fence, or result/output envelope.',
    '- Keep the same patch operation count, order, slide ids, and operation intent unless a listed contract issue makes that impossible.',
    '- For replace_slide operations, preserve both "slideId" and "slide.id".',
    '- Resolve every validation error and follow every repairHint exactly.',
    '- Do not introduce new unsupported patch operations.',
    '',
    '## Repair Payload',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    '## Required Output Format',
    '{',
    '  "mode": "deck_patch",',
    `  "schemaVersion": "${pepeteXPatchSchemaVersion}",`,
    '  "patch": {',
    '    "operations": [',
    '      {',
    '        "op": "replace_slide",',
    '        "slideId": "slide_01",',
    '        "slide": {',
    '          "id": "slide_01",',
    '          "title": "Slide title",',
    '          "html": "<section class=\\"pepetex-slide\\" data-pepetex-slide-id=\\"slide_01\\" style=\\"position:relative;width:1920px;height:1080px;overflow:hidden;\\">...</section>",',
    '          "css": "",',
    '          "assets": [],',
    '          "charts": []',
    '        }',
    '      }',
    '    ]',
    '  },',
    '  "assumptions": [],',
    '  "warnings": [],',
    '  "userVisibleSummary": "Brief summary of the repaired change."',
    '}'
  ].join('\n');
}

function isValidationClean(validation: SlideValidationResult): boolean {
  return validation.errors.length === 0;
}

function summarizeSlideValidationFailures(
  validationResults: SlideValidationResult[],
  slides?: GeneratedSlide[]
): string {
  const failures: string[] = [];
  for (let index = 0; index < validationResults.length; index += 1) {
    const validation = validationResults[index];
    if (!validation || isValidationClean(validation)) continue;
    const slide = slides?.[index];
    const slideLabel = slide ? `${slide.id}${slide.title ? ` (${slide.title})` : ''}` : `slide[${index}]`;
    for (const error of validation.errors.slice(0, 2)) {
      const pathSuffix = error.path ? ` at ${error.path}` : '';
      failures.push(`${slideLabel}: ${error.code}${pathSuffix}`);
      if (failures.length >= 4) {
        return failures.join('; ');
      }
    }
  }
  return failures.join('; ');
}

function summarizePatchValidationFailures(targets: RepairablePatchTarget[]): string {
  const failures = targets
    .filter((target) => !isValidationClean(target.validation))
    .flatMap((target) =>
      target.validation.errors
        .slice(0, 2)
        .map(
          (error) =>
            `${target.operation.op}[${target.operationIndex}] ${error.code}${error.path ? ` at ${error.path}` : ''}`
        )
    )
    .slice(0, 4);

  return failures.join('; ');
}

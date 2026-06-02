import {
  createTextProviderAdapter,
  type StructuredGenerationAttachment,
  type ProviderContext,
  type TextProviderKind
} from '@pepetex/providers';
import { assemblePrompt, type PromptAssemblyInput, type ReferenceFilePromptInput } from '@pepetex/prompts';
import { validatePepeteXAIResult, type GeneratedDeck, type PepeteXAIResult } from '../index.js';
import type { WorkflowProviderContext } from './schemas.js';

export class AIOutputSchemaValidationError extends Error {
  readonly errors: string[];
  readonly outputPreview: string;

  constructor(errors: string[], output: unknown) {
    super(`AI output failed schema validation: ${errors.join('; ')}`);
    this.name = 'AIOutputSchemaValidationError';
    this.errors = errors;
    this.outputPreview = previewUnknownValue(output);
  }
}

const DECK_STRUCTURED_MAX_OUTPUT_TOKENS = 65_536;
const TITLE_MAX_LENGTH = 80;

const pepeteXAIResultResponseJsonSchema = {
  type: 'object',
  description: 'PepeteX structured workflow result. Return one of deck, deck_patch, ask, or refusal modes.',
  required: ['mode'],
  properties: {
    mode: { type: 'string', enum: ['ask', 'deck', 'deck_patch', 'refusal'] },
    reason: { type: 'string' },
    question: { type: 'string' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'label', 'value'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          description: { type: 'string' },
          value: {}
        }
      }
    },
    allowManualAnswer: { type: 'boolean' },
    required: { type: 'boolean' },
    assumptionIfSkipped: { type: 'string' },
    schemaVersion: { type: 'string', enum: ['pepetex.deck.v1', 'pepetex.patch.v1'] },
    deck: {
      type: 'object',
      required: ['title', 'language', 'aspectRatio', 'canvas', 'slides'],
      properties: {
        title: { type: 'string' },
        language: { type: 'string' },
        aspectRatio: { type: 'string', enum: ['16:9'] },
        canvas: {
          type: 'object',
          required: ['width', 'height'],
          properties: {
            width: { type: 'integer', enum: [1920] },
            height: { type: 'integer', enum: [1080] }
          }
        },
        slides: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['id', 'title', 'html', 'css'],
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              html: { type: 'string' },
              css: { type: 'string' },
              assets: { type: 'array', items: { type: 'object' } },
              charts: { type: 'array', items: { type: 'object' } },
              diagrams: { type: 'array', items: { type: 'object' } },
              validationNotes: { type: 'array', items: { type: 'string' } }
            }
          }
        }
      }
    },
    patch: {
      type: 'object',
      required: ['operations'],
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            required: ['op'],
            properties: {
              op: { type: 'string' },
              slideId: { type: 'string' },
              position: { type: 'string' },
              referenceSlideId: { type: 'string' },
              index: { type: 'integer' },
              toIndex: { type: 'integer' },
              elementId: { type: 'string' },
              text: { type: 'string' },
              newText: { type: 'string' },
              styles: {
                type: 'object',
                additionalProperties: { type: 'string' }
              },
              style: {
                type: 'object',
                additionalProperties: { type: 'string' }
              },
              attributes: {
                type: 'object',
                additionalProperties: {
                  anyOf: [{ type: 'string' }, { type: 'null' }]
                }
              },
              attrs: {
                type: 'object',
                additionalProperties: {
                  anyOf: [{ type: 'string' }, { type: 'null' }]
                }
              },
              html: { type: 'string' },
              replacementHtml: { type: 'string' },
              elementHtml: { type: 'string' },
              commentIds: {
                type: 'array',
                items: { type: 'string' }
              },
              slide: { type: 'object' }
            }
          }
        }
      }
    },
    assumptions: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    designSystemRulesUsed: { type: 'array', items: { type: 'string' } },
    userVisibleSummary: { type: 'string' },
    userVisibleMessage: { type: 'string' }
  }
} as const;

export function buildProviderContext(p: WorkflowProviderContext): ProviderContext {
  const credential: ProviderContext['credential'] = {
    apiKey: p.credential.apiKey ?? ''
  };
  if (p.credential.organizationId !== undefined) credential.organizationId = p.credential.organizationId;
  if (p.credential.projectId !== undefined) credential.projectId = p.credential.projectId;
  if (p.credential.customHeaders !== undefined) credential.customHeaders = p.credential.customHeaders;

  const ctx: ProviderContext = { credential };
  if (p.baseUrl != null) ctx.baseUrl = p.baseUrl;
  if (p.manualModelIds !== undefined) ctx.manualModelIds = p.manualModelIds;
  return ctx;
}

export interface GenerateStructuredOptions {
  provider: WorkflowProviderContext;
  promptInput: PromptAssemblyInput;
}

export interface GenerateStructuredOutputOptions {
  provider: WorkflowProviderContext;
  promptInput: PromptAssemblyInput;
  schema?: unknown;
  maxOutputTokens?: number;
}

export const slideHtmlDesignRequirements = `## Slide HTML Design Requirements

Treat each slide as a designed 1920x1080 PPTX artboard, not a plain webpage or document.

- Create visually rich, presentation-ready HTML: strong hierarchy, deliberate whitespace, cards, bands, panels, callouts, numbers, timelines, comparison grids, badges, and safe SVG shapes where useful.
- Avoid generic white slides with centered titles and bullet lists unless the user explicitly asks for that style. Every slide should have a distinct composition suited to its message.
- Give each slide one clear takeaway and a purposeful role in the larger deck. Avoid filler slides and vague titles such as "Overview" when a specific insight, decision, or question would be stronger.
- Vary slide composition across the deck: mix hero statements, diagrams, timelines, evidence slides, comparisons, metrics, process views, section breaks, and action slides as appropriate for the prompt.
- Prefer visual explanation over dense prose. Use data visualizations, examples, implications, decisions, and next actions when they make the deck more useful.
- Use only safe export-friendly HTML/CSS: no scripts, no event handlers, no external stylesheets, no external URLs. Prefer inline styles plus scoped CSS in the slide css field.
- Use the allowed visual toolkit generously: absolute positioning, flex/grid layouts, gradients, border radius, borders, box shadows, SVG shapes, large typography, accent colors, and data/image placeholders when appropriate.
- Keep CSS aligned with dom-to-pptx export support: avoid transition/animation, avoid clip-path/mask/filter/backdrop-filter/mix-blend-mode, avoid transform scale/translate/skew, use rotate(...) only when rotation is necessary, and prefer simple shapes, borders, bands, and box-shadow over fragile CSS effects for reliable PPTX output.
- Keep all content inside the 1920x1080 canvas. Set the root element to class="pepetex-slide", data-pepetex-slide-id, data-pepetex-width="1920", data-pepetex-height="1080", position:relative, width:1920px, height:1080px, and overflow:hidden.
- Mark meaningful text and visual targets with stable data-pepetex-id and data-pepetex-type values. Use headline/body/cta for editable text, and image/card/chart/table/background/shape/logo/group/decorative for non-text visual elements. Use diagram for flowcharts, architecture diagrams, and process maps.
- When a slide contains a data chart, include a chart container div with data-pepetex-type="chart", data-pepetex-id="<chart id>", and data-pepetex-chart-id="<same chart id>" in the HTML, and put the structured chart data (id, kind, categories, series) in the slide's charts array using the exact same id. The chart data is required: categories must be non-empty and every series must contain finite numeric values with one value per category. Common chart kinds: bar, line, area, pie, donut, scatter, table-like. You may also use any descriptive kind that fits (for example stacked-bar, histogram, waterfall, radar, bubble); the renderer maps unknown kinds to the closest supported kind.
- For each slide, evaluate whether a structured chart would communicate the data more clearly than prose, and prefer the chart when it does. Use charts proactively for comparisons, allocations, trends, market sizing, traction, funnels, benchmarks, distributions, and progress evidence. Preserve exact user-provided values. If the user did not provide exact data, generate plausible illustrative numeric values and label them subtly in slide copy and chart sourceRef, for example "Illustrative estimate". Never leave categories or series empty.
- For each slide, evaluate whether a diagram (flowchart, sequence, timeline, hierarchy, architecture, process, decision tree, ER, gantt, journey, mind map) would communicate the structure more clearly than prose, and prefer the diagram when it does. Compose diagrams entirely in HTML/CSS: positioned <div> nodes laid out with grid/flex/absolute, plus an inline <svg> overlay for connector lines and arrows (<path>, <line>, <polygon> with inline stroke and stroke-width attributes). Always set slide.diagrams to []; the diagrams[] payload is no longer rendered. Tag the outer container with data-pepetex-type="diagram" and a stable data-pepetex-id so it remains editable.
- For each slide that compares structured records, prefer a semantic <table> over inline grids: <thead>/<tbody>/<tr>/<th>/<td>, width:100% (or explicit px), border-collapse:collapse, 12px 16px cell padding, a header row with filled background and contrasting text, and border-bottom on tbody rows. Each cell content is a single text node OR a single block-level element — never two adjacent <span>s in one cell.
- Aim for visually rich, comprehensive content slides. Most content slides should carry at least one structured visual element (chart, diagram, infographic, or strong shape composition). Pure-text slides are appropriate for covers, transitions, and quote callouts.
- data-pepetex-id and data-pepetex-type always come as a pair. If you add one, you must add the other from the allowed list. Plain layout <div> containers (used only for flexbox/grid/positioning) MUST NOT have data-pepetex-id or data-pepetex-type — they are valid as bare structural divs. Do not invent new type names; if no allowed type fits, leave the element untagged.
- Prefer concise slide copy. Replace long bullet stacks with visual groupings, metrics, cards, diagrams, and speaker-friendly summaries.
- Use presentation-grade typography and spacing: no browser-default h1/p styling, no tiny labels below 18px unless purely decorative, no sparse blank pages with small content stranded on the canvas.
- Return a top-level JSON object only, never a JSON string, JSON array, markdown block, or result/output wrapper. The html value is an HTML fragment string and the css value contains scoped CSS for the slide.`;

export async function callGenerateStructured(
  options: GenerateStructuredOptions
): Promise<PepeteXAIResult> {
  const normalizedOutput = await callGenerateStructuredOutput({
    ...options,
    schema: pepeteXAIResultResponseJsonSchema,
    maxOutputTokens: DECK_STRUCTURED_MAX_OUTPUT_TOKENS
  });

  const validated = validatePepeteXAIResult(normalizedOutput);
  if (!validated.ok) {
    throw new AIOutputSchemaValidationError(validated.errors, normalizedOutput);
  }

  return normalizeSlideHtmlFragmentsInResult(validated.value);
}

export async function callGenerateStructuredOutput(
  options: GenerateStructuredOutputOptions
): Promise<unknown> {
  const { provider, promptInput } = options;
  const adapter = createTextProviderAdapter(provider.kind as TextProviderKind);
  const ctx = buildProviderContext(provider);
  const assembled = assemblePrompt(promptInput);

  const generateInput = {
    model: provider.model,
    prompt: assembled.userPrompt,
    systemInstruction: assembled.systemInstruction,
    ...(options.schema !== undefined ? { schema: options.schema } : {}),
    maxOutputTokens: options.maxOutputTokens ?? DECK_STRUCTURED_MAX_OUTPUT_TOKENS,
    attachments: buildStructuredGenerationAttachments(promptInput.referenceFiles ?? [])
  };

  const result = await adapter.generateStructured<unknown>(
    generateInput,
    ctx
  );

  return normalizeStructuredOutputCandidate(result.output);
}

export async function generateDeckTitle(input: {
  provider: WorkflowProviderContext;
  instruction?: string | null;
  deck: GeneratedDeck;
}): Promise<string> {
  const slideTitles = input.deck.slides
    .map((slide, index) => `${index + 1}. ${slide.title.trim()}`)
    .filter((title) => title.length > 3)
    .join('\n');
  const promptInput: PromptAssemblyInput = {
    workspaceInstruction: [
      'Produce a concise, specific presentation title.',
      `Maximum ${TITLE_MAX_LENGTH} characters.`,
      'Do not wrap the title in quotes.',
      'Prefer names like "Pitch Deck for Company X" or "Q3 Product Momentum" over generic labels.'
    ].join('\n'),
    manualInstruction: [
      'Create the best deck title from this source material.',
      '',
      'Original user instruction:',
      input.instruction?.trim() || '(none)',
      '',
      'Generated deck title candidate:',
      input.deck.title,
      '',
      'Generated slide titles:',
      slideTitles || '(no slide titles)'
    ].join('\n')
  };

  const output = await callGenerateStructuredOutput({
    provider: input.provider,
    promptInput,
    schema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' }
      }
    },
    maxOutputTokens: 256
  });

  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error('Deck title generation returned a non-object response.');
  }

  const rawTitle = (output as { title?: unknown }).title;
  if (typeof rawTitle !== 'string') {
    throw new Error('Deck title generation returned no title.');
  }

  const title = normalizeGeneratedTitle(rawTitle);
  if (!title) {
    throw new Error('Deck title generation returned an empty title.');
  }

  return title;
}

const SLIDE_HTML_DOCUMENT_PATTERN = /^\s*(?:<!doctype[^>]*>)?\s*<html[\s>]/i;
const SLIDE_HTML_BODY_PATTERN = /<body[^>]*>([\s\S]*?)<\/body\s*>/i;

function normalizeSlideHtmlFragment(html: string): string {
  if (typeof html !== 'string') return html;
  if (!SLIDE_HTML_DOCUMENT_PATTERN.test(html)) return html;
  const bodyMatch = html.match(SLIDE_HTML_BODY_PATTERN);
  if (bodyMatch && typeof bodyMatch[1] === 'string') {
    return bodyMatch[1].trim();
  }
  // Last resort: strip <!doctype>, <html>, <head>, </html> wrappers.
  return html
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<head[\s\S]*?<\/head\s*>/gi, '')
    .trim();
}

function normalizeSlideHtmlFragmentsInResult(result: PepeteXAIResult): PepeteXAIResult {
  if (result.mode === 'deck' && result.deck?.slides) {
    for (const slide of result.deck.slides) {
      if (typeof slide.html === 'string') {
        slide.html = normalizeSlideHtmlFragment(slide.html);
      }
    }
  }
  if (result.mode === 'deck_patch' && result.patch?.operations) {
    for (const op of result.patch.operations) {
      if ((op.op === 'replace_slide' || op.op === 'insert_slide') && op.slide && typeof op.slide.html === 'string') {
        op.slide.html = normalizeSlideHtmlFragment(op.slide.html);
      }
      if (op.op === 'replace_element_html' && typeof op.html === 'string') {
        op.html = normalizeSlideHtmlFragment(op.html);
      }
    }
  }
  return result;
}

function normalizeStructuredOutputCandidate(input: unknown): unknown {
  let candidate = input;

  for (let depth = 0; depth < 4; depth += 1) {
    const next = unwrapStructuredOutputCandidate(candidate);
    if (!next.changed) return candidate;
    candidate = next.value;
  }

  return candidate;
}

function unwrapStructuredOutputCandidate(input: unknown): { changed: boolean; value: unknown } {
  if (typeof input === 'string') {
    const parsed = parseJsonLikeString(input);
    return parsed.ok ? { changed: true, value: parsed.value } : { changed: false, value: input };
  }

  if (Array.isArray(input) && input.length === 1) {
    return { changed: true, value: input[0] };
  }

  if (isRecord(input)) {
    if (typeof input.mode === 'string' && !hasExpectedModePayload(input) && isStructuredCandidate(input.result)) {
      return { changed: true, value: input.result };
    }

    if (!('mode' in input)) {
      for (const key of ['result', 'output', 'data']) {
        if (isStructuredCandidate(input[key])) {
          return { changed: true, value: input[key] };
        }
      }
    }
  }

  return { changed: false, value: input };
}

function parseJsonLikeString(input: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false };

  const direct = tryParseJson(trimmed);
  if (direct.ok) return direct;

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch?.[1]) {
    const fenced = tryParseJson(fencedMatch[1].trim());
    if (fenced.ok) return fenced;
  }

  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    const embedded = tryParseJson(trimmed.slice(objectStart, objectEnd + 1));
    if (embedded.ok) return embedded;
  }

  return { ok: false };
}

function tryParseJson(input: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch {
    return { ok: false };
  }
}

function isStructuredCandidate(input: unknown): boolean {
  return typeof input === 'string' || Array.isArray(input) || isRecord(input);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === 'object' && !Array.isArray(input);
}

function hasExpectedModePayload(input: Record<string, unknown>): boolean {
  switch (input.mode) {
    case 'deck':
      return 'deck' in input;
    case 'deck_patch':
      return 'patch' in input;
    case 'ask':
      return 'question' in input;
    case 'refusal':
      return 'reason' in input;
    default:
      return false;
  }
}

function previewUnknownValue(input: unknown): string {
  try {
    return JSON.stringify(input).slice(0, 800);
  } catch {
    return String(input).slice(0, 800);
  }
}

function buildStructuredGenerationAttachments(
  referenceFiles: ReferenceFilePromptInput[]
): StructuredGenerationAttachment[] {
  return referenceFiles.flatMap((file) => {
    if ((!file.contentBase64 && !file.providerFileId && !file.providerFileUri) || file.attachedToModel === false) {
      return [];
    }

    return [{
      filename: file.filename,
      mimeType: file.mimeType,
      ...(file.contentBase64 ? { contentBase64: file.contentBase64 } : {}),
      ...(file.providerFileId ? { providerFileId: file.providerFileId } : {}),
      ...(file.providerFileUri ? { providerFileUri: file.providerFileUri } : {})
    }];
  });
}

function normalizeGeneratedTitle(value: string): string {
  const title = value
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'`]+|[\s"'`.]+$/g, '')
    .trim();

  if (title.length <= TITLE_MAX_LENGTH) {
    return title;
  }

  return `${title.slice(0, TITLE_MAX_LENGTH - 3).trim()}...`;
}

export function buildDeckGenerationPrompt(manualInstruction: string): PromptAssemblyInput {
  return {
    manualInstruction: buildStructuredOutputInstruction(manualInstruction, 'deck')
  };
}

export function buildSingleSlidePrompt(manualInstruction: string): PromptAssemblyInput {
  return {
    manualInstruction: buildStructuredOutputInstruction(manualInstruction, 'single_slide')
  };
}

function buildStructuredOutputInstruction(userRequest: string, mode: 'deck' | 'single_slide'): string {
  const schemaSection =
    mode === 'deck'
      ? `Return a JSON object with:
- mode: "deck"
- schemaVersion: "pepetex.deck.v1"
- deck: { title: string, language: "en"|"id"|string, aspectRatio: "16:9", canvas: { width: 1920, height: 1080 }, slides: GeneratedSlide[] }
- assumptions: string[]
- warnings: string[]
- designSystemRulesUsed: string[]

Each GeneratedSlide must have: id (unique string), title, html (valid HTML fragment), css (scoped CSS), assets: [], charts: [], diagrams: [].`
      : `Return a JSON object with:
- mode: "deck_patch"
- schemaVersion: "pepetex.patch.v1"
- patch: { operations: [{ op: "insert_slide", position: "end", slide: GeneratedSlide }] }
- assumptions: string[]
- warnings: string[]
- userVisibleSummary: string

The GeneratedSlide must have: id (unique string), title, html (valid HTML fragment), css (scoped CSS), assets: [], charts: [], diagrams: [].`;

  const askSection = `If critical information is missing (deck structure, language, audience), return:
{ mode: "ask", reason: "<reason>", question: "<question>", options: [], allowManualAnswer: true, required: true }`;

  const refusalSection = `If the request is impossible or unsupported within PepeteX V1, return:
{ mode: "refusal", reason: "<reason>", userVisibleMessage: "<friendly message>" }`;

  const deckQualitySection = mode === 'deck'
    ? `## Deck Quality Defaults
Before writing JSON, internally decide the deck archetype, audience, narrative arc, and appropriate slide count from the user's request.
- Use as many slides as needed to fulfill the prompt well. For broad full-deck requests with no explicit count, usually create a developed deck rather than a 3-slide outline.
- Keep one main takeaway per slide and make every slide title specific.
- Include relevant context, evidence, examples, implications, decisions, or next actions where useful.
- Vary layouts and visual anchors. Avoid repeating the same card grid or title/body composition across the deck.
- Preserve explicit user constraints, including requests for a short deck or a specific slide count.`
    : '';

  return [
    `## Task`,
    userRequest,
    deckQualitySection,
    ``,
    `## Output Schema`,
    schemaSection,
    ``,
    `## ASK Mode`,
    askSection,
    ``,
    `## Refusal`,
    refusalSection
  ].join('\n');
}

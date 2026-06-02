import { createTool } from '@mastra/core/tools';
import { getPepeteXAgentRequestContext } from './context.js';
import type {
  DeckPatch,
  DeckPatchOperation,
  GeneratedDeck,
  GeneratedSlide,
  SlideAssetRef,
  SlideChartData,
  SlideDiagramData
} from '../index.js';

interface AskOptionInput {
  id: string;
  label: string;
  description?: string;
  value?: unknown;
}

interface ApplyCommentRecord {
  id?: string;
  slideId?: string;
  elementIds: string[];
  text: string;
}

interface DeckPlanInput {
  summary: string;
  slides: Array<{
    title: string;
    intent: string;
    visualDirection?: string;
  }>;
}

type SlideAssetInput = Partial<SlideAssetRef> & Record<string, unknown>;
type SlideChartInput = Partial<SlideChartData> & Record<string, unknown>;
type SlideDiagramInput = Partial<SlideDiagramData> & Record<string, unknown>;
type GeneratedSlideInput = Partial<GeneratedSlide> & { content?: string };

type PassthroughStandardSchema<T> = {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => { value: T };
    readonly jsonSchema: {
      readonly input: () => Record<string, unknown>;
      readonly output: () => Record<string, unknown>;
    };
  };
};

function passthroughObjectSchema<T>(jsonSchema?: Record<string, unknown>): PassthroughStandardSchema<T> {
  const schema = jsonSchema ?? { type: 'object', additionalProperties: true };

  return {
    '~standard': {
      version: 1,
      vendor: 'pepetex-passthrough',
      validate: (value) => ({ value: value as T }),
      jsonSchema: {
        input: () => schema,
        output: () => schema
      }
    }
  };
}

const noArgInputSchema = passthroughObjectSchema<Record<string, never>>({
  type: 'object',
  properties: {},
  additionalProperties: false
});

function normalizeSlideInput(slide: GeneratedSlideInput | Record<string, unknown>): GeneratedSlide {
  const record = slide as Record<string, unknown>;
  const html = typeof record.html === 'string'
    ? record.html
    : typeof record.content === 'string'
      ? record.content
      : '';
  const id = typeof record.id === 'string' && record.id.trim()
    ? record.id
    : extractSlideIdFromHtml(html) ?? `slide_${Math.random().toString(36).slice(2, 10)}`;
  const title = typeof record.title === 'string' && record.title.trim()
    ? record.title
    : extractTitleFromHtml(html) ?? 'Untitled slide';

  return {
    id,
    title,
    html,
    css: typeof record.css === 'string' ? record.css : '',
    assets: (Array.isArray(record.assets) ? record.assets : []).map((asset) => ({
      ...(asset as SlideAssetInput),
      assetId: asset.assetId,
      role: asset.role,
      required: asset.required
    })),
    charts: (Array.isArray(record.charts) ? record.charts : []).map((chart) => ({
      ...(chart as SlideChartInput),
      id: chart.id,
      kind: chart.kind,
      categories: chart.categories,
      series: chart.series,
      ...(chart.title ? { title: chart.title } : {}),
      ...(chart.unit ? { unit: chart.unit } : {}),
      ...(chart.sourceRef ? { sourceRef: chart.sourceRef } : {})
    } as SlideChartData)),
    diagrams: (Array.isArray(record.diagrams) ? record.diagrams : []).map((diagram) => ({
      ...(diagram as SlideDiagramInput),
      id: diagram.id,
      kind: diagram.kind,
      source: diagram.source,
      ...(diagram.title ? { title: diagram.title } : {})
    })),
    ...(Array.isArray(record.validationNotes) ? { validationNotes: record.validationNotes as string[] } : {})
  };
}

function extractSlideIdFromHtml(html: string): string | undefined {
  return html.match(/data-pepetex-slide-id=["']([^"']+)["']/i)?.[1];
}

function extractTitleFromHtml(html: string): string | undefined {
  const title = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?? html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  return title?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requirePatchRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object.`);
  }

  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }

  return value;
}

function normalizeCommentIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const commentIds = Array.from(
    new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0))
  );

  return commentIds.length > 0 ? commentIds : undefined;
}

function normalizeStringRecord(value: unknown, path: string): Record<string, string> {
  const record = requirePatchRecord(value, path);
  const normalized: Record<string, string> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error(`${path}.${key} must be a non-empty string.`);
    }

    normalized[key] = entry;
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error(`${path} must contain at least one entry.`);
  }

  return normalized;
}

function normalizeNullableStringRecord(value: unknown, path: string): Record<string, string | null> {
  const record = requirePatchRecord(value, path);
  const normalized: Record<string, string | null> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (entry !== null && typeof entry !== 'string') {
      throw new Error(`${path}.${key} must be a string or null.`);
    }

    normalized[key] = entry;
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error(`${path} must contain at least one entry.`);
  }

  return normalized;
}

function looksLikeSlidePatch(record: Record<string, unknown>): boolean {
  return typeof record.html === 'string' || typeof record.content === 'string';
}

function normalizePatchOperation(operation: unknown, path: string, inheritedSlideId?: string): DeckPatchOperation {
  const record = requirePatchRecord(operation, path);
  const rawOp = record.op ?? record.command ?? record.action ?? record.type;
  const op = typeof rawOp === 'string'
    ? rawOp.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : undefined;
  const rawText = record.text ?? record.newText ?? record.html ?? record.content ?? record.value;
  const rawStyles = record.styles ?? record.style;
  const rawAttributes = record.attributes ?? record.attrs;
  const rawElementHtml = record.html ?? record.replacementHtml ?? record.elementHtml;
  const commentIds = normalizeCommentIds(record.commentIds);
  const slideId = typeof record.slideId === 'string' && record.slideId.trim()
    ? record.slideId
    : inheritedSlideId;

  if (
    (op === 'update_text' || op === 'edit_text' || op === 'replace_text' || op === 'change_text') &&
    typeof slideId === 'string' &&
    typeof record.elementId === 'string' &&
    typeof rawText === 'string'
  ) {
    return {
      op: 'update_text',
      slideId,
      elementId: record.elementId,
      text: rawText,
      ...(commentIds ? { commentIds } : {})
    };
  }

  if (
    !op &&
    typeof slideId === 'string' &&
    typeof record.elementId === 'string' &&
    isRecord(rawStyles)
  ) {
    return {
      op: 'update_element_style',
      slideId,
      elementId: record.elementId,
      styles: normalizeStringRecord(rawStyles, `${path}.styles`),
      ...(commentIds ? { commentIds } : {})
    };
  }

  if (
    !op &&
    typeof slideId === 'string' &&
    typeof record.elementId === 'string' &&
    isRecord(rawAttributes)
  ) {
    return {
      op: 'update_element_attributes',
      slideId,
      elementId: record.elementId,
      attributes: normalizeNullableStringRecord(rawAttributes, `${path}.attributes`),
      ...(commentIds ? { commentIds } : {})
    };
  }

  if (
    !op &&
    typeof slideId === 'string' &&
    typeof record.elementId === 'string' &&
    typeof (record.replacementHtml ?? record.elementHtml) === 'string'
  ) {
    return {
      op: 'replace_element_html',
      slideId,
      elementId: record.elementId,
      html: requireString(record.replacementHtml ?? record.elementHtml, `${path}.html`),
      ...(commentIds ? { commentIds } : {})
    };
  }

  if (!rawOp && typeof slideId === 'string' && typeof record.elementId === 'string' && typeof rawText === 'string') {
    return {
      op: 'update_text',
      slideId,
      elementId: record.elementId,
      text: rawText,
      ...(commentIds ? { commentIds } : {})
    };
  }

  if (!rawOp && looksLikeSlidePatch(record)) {
    const slide = normalizeSlideInput(record);
    return {
      op: 'replace_slide',
      slideId: slideId ?? slide.id,
      slide,
      ...(commentIds ? { commentIds } : {})
    };
  }

  const requiredOp = op ?? requireString(rawOp, `${path}.op`);

  if (
    ['update_element_style', 'set_style', 'style_element', 'update_style', 'change_element_style', 'change_color'].includes(requiredOp) ||
    (['update_element', 'edit_element', 'modify_element'].includes(requiredOp) && isRecord(rawStyles))
  ) {
    return {
      op: 'update_element_style',
      slideId: slideId ?? requireString(record.slideId, `${path}.slideId`),
      elementId: requireString(record.elementId, `${path}.elementId`),
      styles: normalizeStringRecord(rawStyles, `${path}.styles`),
      ...(commentIds ? { commentIds } : {})
    };
  }

  if (
    ['update_element_attributes', 'set_attribute', 'set_attributes', 'update_attribute', 'update_attributes', 'update_attrs', 'set_attrs'].includes(requiredOp) ||
    (['update_element', 'edit_element', 'modify_element'].includes(requiredOp) && isRecord(rawAttributes))
  ) {
    return {
      op: 'update_element_attributes',
      slideId: slideId ?? requireString(record.slideId, `${path}.slideId`),
      elementId: requireString(record.elementId, `${path}.elementId`),
      attributes: normalizeNullableStringRecord(rawAttributes, `${path}.attributes`),
      ...(commentIds ? { commentIds } : {})
    };
  }

  if (
    ['replace_element_html', 'replace_element', 'replace_element_content', 'edit_element_html', 'update_element_html'].includes(requiredOp) ||
    (['update_element', 'edit_element', 'modify_element'].includes(requiredOp) && typeof rawElementHtml === 'string')
  ) {
    return {
      op: 'replace_element_html',
      slideId: slideId ?? requireString(record.slideId, `${path}.slideId`),
      elementId: requireString(record.elementId, `${path}.elementId`),
      html: requireString(rawElementHtml ?? record.content, `${path}.html`),
      ...(commentIds ? { commentIds } : {})
    };
  }

  if (requiredOp === 'replace_slide' || requiredOp === 'update_slide' || requiredOp === 'modify_slide' || requiredOp === 'edit_slide') {
    const slideSource = isRecord(record.slide) ? record.slide : record;
    const slide = normalizeSlideInput(slideSource);
    return {
      op: 'replace_slide',
      slideId: slideId ?? slide.id,
      slide,
      ...(commentIds ? { commentIds } : {})
    };
  }

  if (requiredOp === 'insert_slide') {
    const slideSource = isRecord(record.slide) ? record.slide : record;
    return {
      op: 'insert_slide',
      position: ['before', 'after', 'start', 'end', 'index'].includes(String(record.position))
        ? record.position as 'before' | 'after' | 'start' | 'end' | 'index'
        : 'end',
      slide: normalizeSlideInput(slideSource),
      ...(typeof record.referenceSlideId === 'string' && record.referenceSlideId.trim() ? { referenceSlideId: record.referenceSlideId } : {}),
      ...(typeof record.index === 'number' ? { index: record.index } : {}),
      ...(commentIds ? { commentIds } : {})
    };
  }

  if (requiredOp === 'delete_slide') {
    return {
      op: 'delete_slide',
      slideId: slideId ?? requireString(record.slideId, `${path}.slideId`),
      ...(commentIds ? { commentIds } : {})
    };
  }

  if (requiredOp === 'move_slide') {
    return {
      op: 'move_slide',
      slideId: slideId ?? requireString(record.slideId, `${path}.slideId`),
      toIndex: typeof record.toIndex === 'number' ? record.toIndex : 0,
      ...(commentIds ? { commentIds } : {})
    };
  }

  if (
    requiredOp === 'update_text' ||
    requiredOp === 'edit_text' ||
    requiredOp === 'replace_text' ||
    requiredOp === 'change_text' ||
    requiredOp === 'update_copy' ||
    requiredOp === 'update_element_text' ||
    requiredOp === 'modify_text' ||
    requiredOp === 'update_element' ||
    requiredOp === 'edit_element' ||
    requiredOp === 'modify_element'
  ) {
    return {
      op: 'update_text',
      slideId: slideId ?? requireString(record.slideId, `${path}.slideId`),
      elementId: requireString(record.elementId, `${path}.elementId`),
      text: requireString(rawText, `${path}.text`),
      ...(commentIds ? { commentIds } : {})
    };
  }

  throw new Error(`${path}.op must be one of replace_slide, insert_slide, delete_slide, move_slide, update_text, update_element_style, update_element_attributes, replace_element_html.`);
}

export function normalizePatchInput(patch: unknown): DeckPatch {
  const record = requirePatchRecord(patch, 'patch');
  const inheritedSlideId = typeof record.slideId === 'string' && record.slideId.trim() ? record.slideId : undefined;

  if (isRecord(record.patch)) {
    return normalizePatchInput(record.patch);
  }

  if (Array.isArray(record.operations)) {
    if (record.operations.length === 0) {
      throw new Error('patch.operations must contain at least one operation.');
    }

    return {
      operations: record.operations.map((operation, index) => normalizePatchOperation(operation, `patch.operations[${index}]`, inheritedSlideId))
    };
  }

  if (Array.isArray(record.slides)) {
    if (record.slides.length === 0) {
      throw new Error('patch.slides must contain at least one slide.');
    }

    return {
      operations: record.slides.map((slide, index) => normalizePatchOperation(slide, `patch.slides[${index}]`, inheritedSlideId))
    };
  }

  if (isRecord(record.slide)) {
    return {
      operations: [normalizePatchOperation(record, 'patch', inheritedSlideId)]
    };
  }

  if (typeof (record.op ?? record.command ?? record.action ?? record.type) === 'string' || looksLikeSlidePatch(record)) {
    return {
      operations: [normalizePatchOperation(record, 'patch', inheritedSlideId)]
    };
  }

  throw new Error('patch_slide expects patch.operations, patch.slides, or a full slide object with html/css to replace.');
}

function normalizeCommentRecord(comment: unknown): ApplyCommentRecord | null {
  if (!isRecord(comment)) return null;

  return {
    ...(typeof comment.id === 'string' && comment.id.trim() ? { id: comment.id } : {}),
    ...(typeof comment.slideId === 'string' && comment.slideId.trim() ? { slideId: comment.slideId } : {}),
    elementIds: Array.isArray(comment.elementIds)
      ? comment.elementIds.filter((elementId): elementId is string => typeof elementId === 'string' && elementId.trim().length > 0)
      : [],
    text: typeof comment.text === 'string' ? comment.text : ''
  };
}

function isCopyEditComment(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  if (/\b(color|background|fill|border|font size|layout|position|spacing|image|icon|shape|gradient|red|blue|green|yellow|purple|orange|warna|latar|posisi|gambar|ikon|bentuk|gradien|merah|biru|hijau|kuning|ungu|oranye)\b/.test(normalized)) {
    return false;
  }

  return (
    /\bchange\s+"[^"]+"\s+to\s+"[^"]+"/i.test(text) ||
    /\breplace\s+"[^"]+"\s+with\s+"[^"]+"/i.test(text) ||
    /\b(change|replace|rename|update)\s+(the\s+)?(text|copy|wording|title|headline|label|body|content)\s+(to|with)\b/i.test(text) ||
    /\b(change|replace|rename|update)\s+to\s+\S+/i.test(text) ||
    /\b(ubah|ganti|perbarui)\b.+\b(menjadi|ke|dengan)\b/i.test(text)
  );
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractTargetElementText(html: string, elementId: string): string | null {
  const quotedId = escapeRegExp(elementId);
  const pattern = new RegExp(`<([a-z][\\w:-]*)\\b(?=[^>]*\\bdata-pepetex-id=["']${quotedId}["'])[^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
  const match = html.match(pattern);
  const text = match?.[2] ? decodeHtmlText(match[2]) : '';
  return text || null;
}

export function constrainApplyCommentsPatch(patch: DeckPatch, comments: unknown[] | undefined): DeckPatch {
  const normalizedComments = (comments ?? []).map(normalizeCommentRecord).filter((comment): comment is ApplyCommentRecord => !!comment);
  if (normalizedComments.length === 0) return patch;

  return {
    operations: patch.operations.flatMap((operation) => {
      if (operation.op !== 'replace_slide') return operation;

      const slideComments = normalizedComments.filter((comment) => comment.slideId === operation.slideId);
      if (slideComments.length === 0) return operation;

      const targetedCopyComments = slideComments.filter(
        (comment) => comment.elementIds.length === 1 && isCopyEditComment(comment.text)
      );

      if (targetedCopyComments.length !== slideComments.length) {
        return operation;
      }

      const textOperations = targetedCopyComments.map((comment) => {
        const targetElementId = comment.elementIds[0];
        const replacementText = targetElementId ? extractTargetElementText(operation.slide.html, targetElementId) : null;
        if (!targetElementId || !replacementText) return null;

        return {
          op: 'update_text' as const,
          slideId: operation.slideId,
          elementId: targetElementId,
          text: replacementText,
          ...(comment.id ? { commentIds: [comment.id] } : {})
        };
      });

      if (textOperations.some((textOperation) => textOperation === null)) return operation;

      return textOperations as DeckPatchOperation[];
    })
  };
}

function operationCommentIds(operation: DeckPatchOperation): string[] {
  return Array.isArray(operation.commentIds)
    ? operation.commentIds.filter((commentId): commentId is string => typeof commentId === 'string' && commentId.trim().length > 0)
    : [];
}

function operationSlideId(operation: DeckPatchOperation): string | undefined {
  return 'slideId' in operation ? operation.slideId : undefined;
}

function operationElementId(operation: DeckPatchOperation): string | undefined {
  return 'elementId' in operation ? operation.elementId : undefined;
}

function operationCoversCommentByTarget(operation: DeckPatchOperation, comment: ApplyCommentRecord): boolean {
  const slideId = operationSlideId(operation);
  if (comment.slideId && slideId !== comment.slideId) {
    return false;
  }

  if (operation.op === 'replace_slide') {
    return !!comment.slideId && slideId === comment.slideId;
  }

  const elementId = operationElementId(operation);
  if (elementId && comment.elementIds.includes(elementId)) {
    return true;
  }

  return comment.elementIds.length === 0 && !!comment.slideId && slideId === comment.slideId;
}

export function collectDeckPatchCoveredCommentIds(
  patch: DeckPatch,
  comments: unknown[] | undefined
): string[] {
  const normalizedComments = (comments ?? []).map(normalizeCommentRecord).filter((comment): comment is ApplyCommentRecord => !!comment?.id);
  if (normalizedComments.length === 0) return [];

  const explicitIds = new Set<string>();
  for (const operation of patch.operations) {
    for (const commentId of operationCommentIds(operation)) {
      explicitIds.add(commentId);
    }
  }

  if (explicitIds.size > 0) {
    return normalizedComments
      .filter((comment) => !!comment.id && explicitIds.has(comment.id))
      .map((comment) => comment.id as string);
  }

  return normalizedComments
    .filter((comment) => patch.operations.some((operation) => operationCoversCommentByTarget(operation, comment)))
    .map((comment) => comment.id as string);
}

export function getDeckPatchMissingCommentIds(
  patch: DeckPatch,
  comments: unknown[] | undefined
): string[] {
  const submittedCommentIds = (comments ?? [])
    .map(normalizeCommentRecord)
    .filter((comment): comment is ApplyCommentRecord => !!comment?.id)
    .map((comment) => comment.id as string);
  const coveredCommentIds = new Set(collectDeckPatchCoveredCommentIds(patch, comments));

  return submittedCommentIds.filter((commentId) => !coveredCommentIds.has(commentId));
}

export function assertDeckPatchCoversSubmittedComments(
  patch: DeckPatch,
  comments: unknown[] | undefined
): void {
  const missingCommentIds = getDeckPatchMissingCommentIds(patch, comments);
  if (missingCommentIds.length === 0) return;

  throw new Error(
    `Deck patch did not address submitted comment id(s): ${missingCommentIds.join(', ')}. Add commentIds to each operation or target the submitted slide/element.`
  );
}

function summarizeDeckForTool(deck: GeneratedDeck | null | undefined) {
  if (!deck) return null;
  return {
    title: deck.title,
    language: deck.language,
    aspectRatio: deck.aspectRatio,
    canvas: deck.canvas,
    slideCount: deck.slides.length,
    slides: deck.slides.map((slide, index) => ({
      index,
      id: slide.id,
      title: slide.title,
      assetCount: slide.assets?.length ?? 0,
      chartCount: slide.charts?.length ?? 0,
      cssBytes: slide.css.length,
      htmlBytes: slide.html.length
    }))
  };
}

function summarizeCandidateForTool(candidate: unknown) {
  if (!candidate || typeof candidate !== 'object') return null;
  const record = candidate as Record<string, unknown>;
  return {
    id: typeof record.id === 'string' ? record.id : undefined,
    title: typeof record.title === 'string' ? record.title : undefined,
    operationCount: Array.isArray(record.operations) ? record.operations.length : undefined,
    cssBytes: typeof record.css === 'string' ? record.css.length : undefined,
    htmlBytes: typeof record.html === 'string' ? record.html.length : undefined
  };
}

function compactValidationResult<T extends { ok: boolean; errors: string[]; warnings: string[]; report: unknown; deck?: GeneratedDeck }>(result: T) {
  const { deck, ...rest } = result;
  return {
    ...rest,
    draft: summarizeDeckForTool(deck)
  };
}

function compactDraftMutationResult<T extends { ok: boolean; errors: string[]; warnings: string[]; report: unknown; deck: GeneratedDeck; candidate: unknown; summary: string; checkpointId?: string }>(
  result: T,
  status: 'accepted' | 'rejected'
) {
  const { deck, candidate, ...rest } = result;
  return {
    ...rest,
    status,
    draft: summarizeDeckForTool(deck),
    candidate: summarizeCandidateForTool(candidate)
  };
}

export function createPepeteXMastraTools() {
  const requestClarificationTool = createTool({
    id: 'request_clarification',
    description: 'Ask the user a targeted clarification question and suspend the current agent run until they answer.',
    inputSchema: passthroughObjectSchema<{
      question: string;
      options?: AskOptionInput[];
      allowManualAnswer?: boolean;
    }>({
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              description: { type: 'string' },
              value: { type: 'string' }
            },
            required: ['id', 'label']
          }
        },
        allowManualAnswer: { type: 'boolean' }
      },
      required: ['question']
    }),
    suspendSchema: passthroughObjectSchema<{
      question: string;
      options?: AskOptionInput[];
      allowManualAnswer: boolean;
    }>({
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              description: { type: 'string' },
              value: { type: 'string' }
            },
            required: ['id', 'label']
          }
        },
        allowManualAnswer: { type: 'boolean' }
      },
      required: ['question', 'allowManualAnswer']
    }),
    resumeSchema: passthroughObjectSchema<{ answer: string }>({
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: true
    }),
    execute: async (input, context) => {
      if (!context.agent?.suspend) {
        return { status: 'not_available' as const, answer: null, question: input.question };
      }

      if (!context.agent.resumeData) {
        await context.agent.suspend({
          question: input.question,
          ...(input.options ? { options: input.options } : {}),
          allowManualAnswer: input.allowManualAnswer ?? true
        });
      }

      return {
        status: context.agent.resumeData ? 'answered' as const : 'suspended' as const,
        answer: context.agent.resumeData?.answer ?? null,
        question: input.question
      };
    }
  });

  const requestApprovalTool = createTool({
    id: 'request_approval',
    description: 'Ask the user to approve or deny a risky deck operation, then suspend the current agent run until they answer. Use before broad rewrites, destructive changes, or risky final operations.',
    inputSchema: passthroughObjectSchema<{
      question: string;
      reason?: string;
      proposedAction?: string;
    }>({
      type: 'object',
      properties: {
        question: { type: 'string' },
        reason: { type: 'string' },
        proposedAction: { type: 'string' }
      },
      required: ['question'],
      additionalProperties: true
    }),
    suspendSchema: passthroughObjectSchema<{
      question: string;
      reason?: string;
      options: AskOptionInput[];
      allowManualAnswer: boolean;
    }>({
      type: 'object',
      properties: {
        question: { type: 'string' },
        reason: { type: 'string' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              description: { type: 'string' },
              value: { type: 'string' }
            },
            required: ['id', 'label']
          }
        },
        allowManualAnswer: { type: 'boolean' }
      },
      required: ['question', 'options', 'allowManualAnswer']
    }),
    resumeSchema: passthroughObjectSchema<{ answer: string }>({
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: true
    }),
    execute: async (input, context) => {
      if (!context.agent?.suspend) {
        return { status: 'not_available' as const, approved: false, answer: null, question: input.question };
      }

      const options: AskOptionInput[] = [
        {
          id: 'approve',
          label: 'Approve',
          description: input.proposedAction ?? 'Allow PepeteX to perform this operation.',
          value: 'approve'
        },
        {
          id: 'deny',
          label: 'Deny',
          description: 'Do not perform this operation.',
          value: 'deny'
        }
      ];

      if (!context.agent.resumeData) {
        await context.agent.suspend({
          question: input.question,
          ...(input.reason ? { reason: input.reason } : {}),
          options,
          allowManualAnswer: true
        });
      }

      const answer = context.agent.resumeData?.answer ?? null;
      const normalized = String(answer ?? '').trim().toLowerCase();
      const approved = normalized === 'approve' ||
        normalized === 'approved' ||
        normalized === 'yes' ||
        normalized.startsWith('approve ');

      return {
        status: answer ? 'answered' as const : 'suspended' as const,
        approved,
        answer,
        question: input.question
      };
    }
  });

  const readDeckStateTool = createTool({
    id: 'read_deck_state',
    description: 'Read the source-of-truth current/draft deck summary, selected slide/element context, generation kind, user instructions, comments, and tweaks. Set includeSlides true when full slide HTML/CSS or data-pepetex element ids are needed before editing.',
    inputSchema: passthroughObjectSchema<{ includeSlides?: boolean }>({
      type: 'object',
      properties: { includeSlides: { type: 'boolean' } },
      additionalProperties: true
    }),
    execute: async (input, context) => {
      const request = getPepeteXAgentRequestContext(context.requestContext);
      const currentDeck = request.runtime.getCurrentDeck();
      const draftDeck = request.runtime.getDraftDeck();
      const targetSlide = request.targetSlideId
        ? (draftDeck?.slides.find((slide) => slide.id === request.targetSlideId)
          ?? currentDeck?.slides.find((slide) => slide.id === request.targetSlideId)
          ?? null)
        : null;
      const includeSlides = input.includeSlides === true;

      return {
        status: 'ok' as const,
        runId: request.runId,
        deckId: request.deckId,
        workspaceId: request.workspaceId,
        generationKind: request.generationKind,
        languageCode: request.languageCode,
        targetSlideId: request.targetSlideId ?? null,
        targetElementId: request.targetElementId ?? null,
        commandContext: request.commandContext ?? null,
        currentDeck: includeSlides ? currentDeck : summarizeDeckForTool(currentDeck),
        draftDeck: includeSlides ? draftDeck : summarizeDeckForTool(draftDeck),
        targetSlide,
        compact: !includeSlides,
        note: includeSlides ? null : 'Decks are compact summaries. Call read_deck_state with includeSlides true only if full HTML/CSS is needed.',
        comments: request.comments ?? [],
        tweaks: request.tweaks ?? []
      };
    }
  });

  const planDeckTool = createTool({
    id: 'plan_deck',
    description: 'Capture or update the narrative plan, slide intents, and visual direction before writing slide HTML.',
    inputSchema: passthroughObjectSchema<{ plan: DeckPlanInput }>({
      type: 'object',
      properties: { plan: { type: 'object', additionalProperties: true } },
      required: ['plan'],
      additionalProperties: true
    }),
    execute: async (input, _context) => {
      return { status: 'ok' as const, plan: input.plan };
    }
  });

  const readDesignSystemTool = createTool({
    id: 'read_design_system',
    description: 'Read the selected design system tokens, components, example slides, and asset rules before creating or visually replacing slides.',
    inputSchema: noArgInputSchema,
    execute: async (_input, context) => {
      const request = getPepeteXAgentRequestContext(context.requestContext);
      return { status: 'ok' as const, designSystem: request.selectedDesignSystem ?? null };
    }
  });

  const listReferenceFilesTool = createTool({
    id: 'list_reference_files',
    description: 'List uploaded reference files and available summaries/excerpts that the user authorized for the deck.',
    inputSchema: noArgInputSchema,
    execute: async (_input, context) => {
      const request = getPepeteXAgentRequestContext(context.requestContext);
      return { status: 'ok' as const, files: request.referenceFiles ?? [] };
    }
  });

  const readReferenceFileTool = createTool({
    id: 'read_reference_file',
    description: 'Read a safe text excerpt or summary for one uploaded reference file.',
    inputSchema: passthroughObjectSchema<{ fileId: string }>({
      type: 'object',
      properties: { fileId: { type: 'string' } },
      required: ['fileId'],
      additionalProperties: true
    }),
    execute: async (input, context) => {
      const request = getPepeteXAgentRequestContext(context.requestContext);
      const file = request.referenceFiles?.find((candidate) => candidate.id === input.fileId) ?? null;
      return { status: 'ok' as const, file };
    }
  });

  const listAssetsTool = createTool({
    id: 'list_assets',
    description: 'List available reusable assets (images, logos, SVGs) that can be placed in slide HTML as pepetex://asset/{id}.',
    inputSchema: noArgInputSchema,
    execute: async (_input, context) => {
      const request = getPepeteXAgentRequestContext(context.requestContext);
      return { status: 'ok' as const, assets: request.assets ?? [] };
    }
  });

  const writeSlideTool = createTool({
    id: 'write_slide',
    description: 'Validate and save exactly one newly written or replacement slide candidate into the draft deck for an AGENT_COMMAND. Each candidate must include substantial slide.css for a polished 1920x1080 presentation artboard; plain HTML or empty CSS is rejected and not checkpointed.',
    inputSchema: passthroughObjectSchema<{
      slide: GeneratedSlideInput;
      operation?: 'insert' | 'replace';
      position?: 'start' | 'end' | 'index' | 'before' | 'after';
      index?: number;
      referenceSlideId?: string;
      summary?: string;
    }>({
      type: 'object',
      properties: {
        slide: {
          type: 'object',
          description: 'GeneratedSlide object: { id, title, html, css, assets, charts, diagrams }. The root HTML element must be class pepetex-slide with stable data-pepetex-slide-id and meaningful data-pepetex-id/type targets. If the HTML includes a chart container, charts[] must include matching structured data with non-empty categories and numeric series values; use clearly labeled illustrative estimates when exact values are unavailable.',
          additionalProperties: true
        },
        operation: {
          type: 'string',
          enum: ['insert', 'replace'],
          description: 'Use insert for new slides. Use replace only for an existing slide id that is already present in deck state.'
        },
        position: {
          type: 'string',
          enum: ['start', 'end', 'index', 'before', 'after'],
          description: 'Insertion position. Defaults to end unless the user asked for another position.'
        },
        index: { type: 'number', description: 'Required only when position is index.' },
        referenceSlideId: { type: 'string', description: 'Required only when position is before or after.' },
        summary: { type: 'string', description: 'Concise summary of this one slide mutation.' }
      },
      required: ['slide'],
      additionalProperties: true
    }),
    execute: async (input, context) => {
      const request = getPepeteXAgentRequestContext(context.requestContext);
      const result = await request.runtime.writeSlide({
        slide: normalizeSlideInput(input.slide),
        operation: input.operation ?? 'insert',
        position: input.position ?? 'end',
        ...(input.index !== undefined ? { index: input.index } : {}),
        ...(input.referenceSlideId ? { referenceSlideId: input.referenceSlideId } : {}),
        ...(input.summary ? { summary: input.summary } : {})
      });

      return compactDraftMutationResult(result, result.ok ? 'accepted' : 'rejected');
    }
  });

  const patchSlideTool = createTool({
    id: 'patch_slide',
    description: 'Validate and save a targeted AGENT_COMMAND deck patch into the draft deck. Use this for selected-slide regeneration, submitted comments, submitted tweaks, reorder/delete, and other bounded edits. Invalid patches are returned but not checkpointed. The exact shape is { patch: { operations: [...] }, summary }. Allowed operation names are replace_slide, insert_slide, delete_slide, move_slide, update_text, update_element_style, update_element_attributes, replace_element_html. When submitted comments are present, include commentIds on operations that address them.',
    inputSchema: passthroughObjectSchema<{ patch: DeckPatch; summary?: string }>({
      type: 'object',
      properties: {
        patch: {
          type: 'object',
          description: 'DeckPatch object with operations. update_text uses { op:"update_text", slideId, elementId, text, commentIds }. update_element_style uses { op:"update_element_style", slideId, elementId, styles:{ color:"#ef4444" }, commentIds }. update_element_attributes uses { op:"update_element_attributes", slideId, elementId, attributes:{ alt:"..." }, commentIds }. replace_element_html uses { op:"replace_element_html", slideId, elementId, html, commentIds }. replace_slide is only for slide-level redesigns or layout rewrites.',
          additionalProperties: true
        },
        summary: { type: 'string', description: 'Concise summary of the scoped patch.' }
      },
      required: ['patch'],
      additionalProperties: true
    }),
    execute: async (input, context) => {
      const request = getPepeteXAgentRequestContext(context.requestContext);
      const patch = normalizePatchInput(input.patch);
      const effectivePatch = (request.comments?.length ?? 0) > 0
        ? constrainApplyCommentsPatch(patch, request.comments)
        : patch;
      const result = await request.runtime.patchSlide({
        patch: effectivePatch,
        ...(input.summary ? { summary: input.summary } : {})
      });

      return compactDraftMutationResult(result, result.ok ? 'accepted' : 'rejected');
    }
  });

  const validateSlideTool = createTool({
    id: 'validate_slide',
    description: 'Dry-run the PepeteX HTML contract and quality checks for one candidate slide or an existing draft slide. Validation results are repair guidance within the current run scope, not permission to redesign unrelated content.',
    inputSchema: passthroughObjectSchema<{
      slideId?: string;
      candidate?: GeneratedSlideInput;
    }>({
      type: 'object',
      properties: {
        slideId: { type: 'string' },
        candidate: { type: 'object', additionalProperties: true }
      },
      additionalProperties: true
    }),
    execute: async (input, context) => {
      const request = getPepeteXAgentRequestContext(context.requestContext);
      const result = await request.runtime.validateSlide({
        ...(input.slideId ? { slideId: input.slideId } : {}),
        ...(input.candidate ? { candidate: normalizeSlideInput(input.candidate) } : {})
      });

      return compactValidationResult(result);
    }
  });

  const validateDeckTool = createTool({
    id: 'validate_deck',
    description: 'Dry-run full deck validation before final commit. For scoped AGENT_COMMAND edits, fix only errors caused by the scoped patch unless the user asked for broader repairs.',
    inputSchema: noArgInputSchema,
    execute: async (_input, context) => {
      const request = getPepeteXAgentRequestContext(context.requestContext);
      const result = await request.runtime.validateDeck();
      return compactValidationResult(result);
    }
  });

  const finishGenerationTool = createTool({
    id: 'finish_generation',
    description: 'Final-validate the draft deck, commit a DeckRevision, apply comment/tweak side effects, and complete the generation run. Call only after the intended scoped changes are accepted and validation passes.',
    inputSchema: passthroughObjectSchema<{ summary: string }>({
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
      additionalProperties: true
    }),
    execute: async (input, context) => {
      const request = getPepeteXAgentRequestContext(context.requestContext);
      const result = await request.runtime.finishGeneration({ summary: input.summary });
      return compactValidationResult(result);
    }
  });

  return {
    request_clarification: requestClarificationTool,
    request_approval: requestApprovalTool,
    read_deck_state: readDeckStateTool,
    plan_deck: planDeckTool,
    read_design_system: readDesignSystemTool,
    list_reference_files: listReferenceFilesTool,
    read_reference_file: readReferenceFileTool,
    list_assets: listAssetsTool,
    write_slide: writeSlideTool,
    patch_slide: patchSlideTool,
    validate_slide: validateSlideTool,
    validate_deck: validateDeckTool,
    finish_generation: finishGenerationTool
  };
}

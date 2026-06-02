import { assemblePrompt, type PromptAssemblyInput, type PromptLayer, type ReferenceFilePromptInput } from '@pepetex/prompts';
import type { StructuredGenerationAttachment } from '@pepetex/providers';
import type { WorkflowProviderContext } from './workflows/schemas.js';
import { callGenerateStructuredOutput } from './workflows/helpers.js';

const SUMMARY_MAX_INPUT_CHARS = 180_000;
const REFERENCE_SUMMARY_TARGET_CHARS = 4_000;
const DESIGN_SYSTEM_SUMMARY_TARGET_CHARS = 8_000;
const DECK_STATE_SUMMARY_TARGET_CHARS = 10_000;
const LAST_RESORT_TEXT_CHARS = 24_000;

export interface CompactionEvent {
  layer: PromptLayer | 'manual-instruction';
  action: 'summarized' | 'metadata-only' | 'truncated';
  detail: string;
  beforeTokens: number;
  afterTokens: number;
  tokensSaved: number;
}

export interface ContinuitySummaryInput {
  text: string;
  instructions: string;
  targetCharacters?: number;
}

export type ContinuitySummarizer = (input: ContinuitySummaryInput) => Promise<string>;
export type PromptTokenCounter<TContext> = (context: TContext) => Promise<number>;

export interface CompactionStrategyInput<TContext> {
  context: TContext;
  budgetTokens: number;
  countTokens: PromptTokenCounter<TContext>;
  summarize: ContinuitySummarizer;
}

export interface CompactionStrategyResult<TContext> {
  context: TContext;
  events: CompactionEvent[];
  finalTokens: number;
  withinBudget: boolean;
}

export interface CompactionStrategy<TContext> {
  compact(input: CompactionStrategyInput<TContext>): Promise<CompactionStrategyResult<TContext>>;
}

export interface RunCompactionInput<TContext> {
  context: TContext;
  budgetTokens: number;
  countTokens: PromptTokenCounter<TContext>;
  strategy: CompactionStrategy<TContext>;
  summarize: ContinuitySummarizer;
}

export interface RunCompactionResult<TContext> extends CompactionStrategyResult<TContext> {
  initialTokens: number;
}

export async function runCompaction<TContext>({
  context,
  budgetTokens,
  countTokens,
  strategy,
  summarize
}: RunCompactionInput<TContext>): Promise<RunCompactionResult<TContext>> {
  const initialTokens = await countTokens(context);
  if (initialTokens <= budgetTokens) {
    return {
      context,
      events: [],
      initialTokens,
      finalTokens: initialTokens,
      withinBudget: true
    };
  }

  const result = await strategy.compact({
    context,
    budgetTokens,
    countTokens,
    summarize
  });

  return {
    ...result,
    initialTokens
  };
}

export async function summarizeForContinuity(
  provider: WorkflowProviderContext,
  text: string,
  instructions: string,
  targetCharacters = 6_000
): Promise<string> {
  const boundedText = boundSummarizerInput(text);
  const output = await callGenerateStructuredOutput({
    provider,
    promptInput: {
      workspaceInstruction: [
        'Compact context for a presentation-generation agent.',
        'Preserve decisions, named entities, constraints, facts, metrics, source caveats, and next-step relevance.',
        'Do not invent new facts. Do not include filler.'
      ].join('\n'),
      manualInstruction: [
        instructions,
        '',
        `Target maximum summary length: ${targetCharacters} characters.`,
        '',
        'Context to compact:',
        boundedText
      ].join('\n')
    },
    schema: {
      type: 'object',
      required: ['summary'],
      properties: {
        summary: { type: 'string' }
      }
    },
    maxOutputTokens: 4_096
  });

  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error('Compaction summary returned a non-object response.');
  }

  const summary = (output as { summary?: unknown }).summary;
  if (typeof summary !== 'string' || summary.trim() === '') {
    throw new Error('Compaction summary returned no summary.');
  }

  return summary.trim();
}

export function createPromptLayerCompactionStrategy(options: {
  targetSlideIds?: string[];
} = {}): CompactionStrategy<PromptAssemblyInput> {
  const targetSlideIds = [...new Set((options.targetSlideIds ?? []).filter((id) => id.trim().length > 0))];

  return {
    compact: async ({ context, budgetTokens, countTokens, summarize }) => {
      let current = clonePromptInput(context);
      let tokens = await countTokens(current);
      const events: CompactionEvent[] = [];

      const record = async (
        layer: CompactionEvent['layer'],
        action: CompactionEvent['action'],
        detail: string,
        mutate: () => Promise<void> | void
      ): Promise<void> => {
        const beforeTokens = tokens;
        await mutate();
        tokens = await countTokens(current);
        events.push({
          layer,
          action,
          detail,
          beforeTokens,
          afterTokens: tokens,
          tokensSaved: Math.max(beforeTokens - tokens, 0)
        });
      };

      if (tokens > budgetTokens && current.referenceFiles?.length) {
        const orderedReferences = [...current.referenceFiles]
          .map((file, index) => ({ file, index, weight: getReferenceWeight(file) }))
          .sort((left, right) => right.weight - left.weight);

        for (const entry of orderedReferences) {
          if (tokens <= budgetTokens) break;
          const original = current.referenceFiles?.[entry.index];
          if (!original || !isCompactionCandidateReference(original)) continue;

          const decoded = decodeReferenceText(original);
          if (decoded) {
            await record('reference-files', 'summarized', `summarized reference file "${original.filename}"`, async () => {
              const summary = await safeSummarize(
                summarize,
                decoded,
                [
                  `Summarize reference file "${original.filename}" for deck generation.`,
                  'Keep facts, figures, terminology, source caveats, and brand/product details that may affect slides.'
                ].join('\n'),
                REFERENCE_SUMMARY_TARGET_CHARS
              );
              current = replaceReferenceAt(current, entry.index, compactReferenceFile(original, summary));
            });
            continue;
          }

          await record('reference-files', 'metadata-only', `kept metadata only for reference file "${original.filename}"`, () => {
            current = replaceReferenceAt(current, entry.index, compactReferenceFile(original));
          });
        }
      }

      if (tokens > budgetTokens && current.designSystemInstruction) {
        const designSystemInstruction = current.designSystemInstruction;
        await record('design-system', 'summarized', 'condensed selected design system guidance', async () => {
          const summary = await safeSummarize(
            summarize,
            designSystemInstruction,
            'Summarize this design system for slide generation. Preserve color, typography, spacing, logo/asset usage, components, archetypes, and explicit brand rules.',
            DESIGN_SYSTEM_SUMMARY_TARGET_CHARS
          );
          current = {
            ...current,
            designSystemInstruction: `Auto-compacted design system digest:\n${summary}`
          };
        });
      }

      if (tokens > budgetTokens && current.deckState) {
        const deckState = current.deckState;
        await record('deck-state', 'summarized', 'condensed current deck state while preserving target slides', async () => {
          current = {
            ...current,
            deckState: await compactDeckState(deckState, targetSlideIds, summarize)
          };
        });
      }

      if (tokens > budgetTokens && current.referenceFiles?.some((file) => file.summary && file.summary.length > LAST_RESORT_TEXT_CHARS)) {
        await record('reference-files', 'truncated', 'truncated oversized reference summaries', () => {
          const referenceFiles = current.referenceFiles?.map((file) => ({
            ...file,
            ...(file.summary && file.summary.length > LAST_RESORT_TEXT_CHARS
              ? { summary: truncateMiddle(file.summary, LAST_RESORT_TEXT_CHARS) }
              : {})
          }));
          current = {
            ...current,
            ...(referenceFiles ? { referenceFiles } : {})
          };
        });
      }

      if (tokens > budgetTokens && current.manualInstruction && current.manualInstruction.length > LAST_RESORT_TEXT_CHARS) {
        await record('manual-instruction', 'truncated', 'truncated the tail of an oversized manual instruction', () => {
          current = {
            ...current,
            manualInstruction: truncateMiddle(current.manualInstruction ?? '', LAST_RESORT_TEXT_CHARS)
          };
        });
      }

      return {
        context: current,
        events,
        finalTokens: tokens,
        withinBudget: tokens <= budgetTokens
      };
    }
  };
}

export const promptLayerStrategy = createPromptLayerCompactionStrategy();

export function estimatePromptInputTokensHeuristic(input: PromptAssemblyInput): number {
  const assembled = assemblePrompt(input);
  const promptChars = assembled.systemInstruction.length + assembled.userPrompt.length;
  const attachmentTokens = buildStructuredGenerationAttachments(input.referenceFiles ?? [])
    .reduce((sum, attachment) => {
      if (attachment.contentBase64) {
        return sum + Math.ceil((attachment.contentBase64.length * 0.75) / 4);
      }

      const reference = input.referenceFiles?.find((file) =>
        file.providerFileId === attachment.providerFileId ||
        file.providerFileUri === attachment.providerFileUri
      );
      return sum + Math.ceil((reference?.sizeBytes ?? 0) / 4);
    }, 0);

  return Math.ceil(promptChars / 4) + attachmentTokens;
}

export function buildStructuredGenerationAttachments(
  referenceFiles: ReferenceFilePromptInput[]
): StructuredGenerationAttachment[] {
  return referenceFiles.flatMap((file) => {
    if ((!file.contentBase64 && !file.providerFileId && !file.providerFileUri) || file.attachedToModel === false) {
      return [];
    }

    return [{
      filename: file.filename,
      mimeType: file.mimeType,
      ...(file.sizeBytes !== undefined ? { sizeBytes: file.sizeBytes } : {}),
      ...(file.contentBase64 ? { contentBase64: file.contentBase64 } : {}),
      ...(file.providerFileId ? { providerFileId: file.providerFileId } : {}),
      ...(file.providerFileUri ? { providerFileUri: file.providerFileUri } : {})
    }];
  });
}

function clonePromptInput(input: PromptAssemblyInput): PromptAssemblyInput {
  return {
    ...(input.workspaceInstruction !== undefined ? { workspaceInstruction: input.workspaceInstruction } : {}),
    ...(input.designSystemInstruction !== undefined ? { designSystemInstruction: input.designSystemInstruction } : {}),
    ...(input.customPromptInstruction !== undefined ? { customPromptInstruction: input.customPromptInstruction } : {}),
    ...(input.manualInstruction !== undefined ? { manualInstruction: input.manualInstruction } : {}),
    ...(input.referenceFiles !== undefined ? { referenceFiles: input.referenceFiles.map((file) => ({ ...file })) } : {}),
    ...(input.deckState !== undefined ? { deckState: input.deckState } : {}),
    ...(input.commentsAndTweaks !== undefined ? { commentsAndTweaks: input.commentsAndTweaks } : {})
  };
}

function replaceReferenceAt(
  input: PromptAssemblyInput,
  index: number,
  replacement: ReferenceFilePromptInput
): PromptAssemblyInput {
  const referenceFiles = [...(input.referenceFiles ?? [])];
  referenceFiles[index] = replacement;
  return {
    ...input,
    referenceFiles
  };
}

function compactReferenceFile(file: ReferenceFilePromptInput, summary?: string): ReferenceFilePromptInput {
  const {
    contentBase64: _contentBase64,
    providerFileId: _providerFileId,
    providerFileUri: _providerFileUri,
    ...rest
  } = file;

  return {
    ...rest,
    ...(summary ? { summary } : {}),
    attachedToModel: false,
    attachmentMode: 'metadata-only',
    attachmentReason: summary
      ? 'auto-compacted to a factual summary to fit the model token budget'
      : 'auto-compacted to metadata only to fit the model token budget'
  };
}

function isCompactionCandidateReference(file: ReferenceFilePromptInput): boolean {
  return !!file.contentBase64 || !!file.providerFileId || !!file.providerFileUri || (file.summary?.length ?? 0) > REFERENCE_SUMMARY_TARGET_CHARS;
}

function getReferenceWeight(file: ReferenceFilePromptInput): number {
  return Math.max(
    file.contentBase64?.length ?? 0,
    file.summary?.length ?? 0,
    file.sizeBytes ?? 0,
    file.providerFileId || file.providerFileUri ? file.sizeBytes ?? 1 : 0
  );
}

function decodeReferenceText(file: ReferenceFilePromptInput): string | null {
  if (!file.contentBase64 || !isTextLikeReference(file.mimeType)) {
    return file.summary && file.summary.length > REFERENCE_SUMMARY_TARGET_CHARS ? file.summary : null;
  }

  try {
    const decoded = Buffer.from(file.contentBase64, 'base64').toString('utf8').trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function isTextLikeReference(mimeType: string): boolean {
  return mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || mimeType === 'application/csv'
    || mimeType === 'text/csv'
    || mimeType === 'application/xml';
}

async function compactDeckState(
  deckState: string,
  targetSlideIds: string[],
  summarize: ContinuitySummarizer
): Promise<string> {
  const parsed = tryParseJson(deckState);
  const slides = getDeckSlides(parsed);

  if (!slides) {
    const summary = await safeSummarize(
      summarize,
      deckState,
      'Summarize this current deck state for a bounded edit. Preserve slide ids, target identifiers, user-visible content, and edit-relevant facts.',
      DECK_STATE_SUMMARY_TARGET_CHARS
    );
    return `Auto-compacted deck-state digest:\n${summary}`;
  }

  const targetSet = new Set(targetSlideIds);
  const targetSlides = slides.filter((slide) => {
    const id = getRecordString(slide, 'id');
    return id ? targetSet.has(id) : false;
  });
  const nonTargetSlides = slides.filter((slide) => !targetSlides.includes(slide));

  const nonTargetSummary = nonTargetSlides.length > 0
    ? await safeSummarize(
        summarize,
        JSON.stringify(nonTargetSlides),
        'Summarize these non-target slides for context. Preserve slide ids, titles, core messages, visual intent, and any dependencies on the target edit.',
        DECK_STATE_SUMMARY_TARGET_CHARS
      )
    : 'No non-target slides.';

  return [
    'Auto-compacted current deck state.',
    targetSlides.length > 0
      ? `Target slides preserved verbatim:\n${JSON.stringify(targetSlides)}`
      : 'No explicit target slide id was available.',
    `Non-target slide digest:\n${nonTargetSummary}`
  ].join('\n\n');
}

async function safeSummarize(
  summarize: ContinuitySummarizer,
  text: string,
  instructions: string,
  targetCharacters: number
): Promise<string> {
  try {
    const summary = await summarize({
      text,
      instructions,
      targetCharacters
    });
    return summary.trim() || truncateMiddle(text, targetCharacters);
  } catch {
    return truncateMiddle(text, targetCharacters);
  }
}

function boundSummarizerInput(text: string): string {
  if (text.length <= SUMMARY_MAX_INPUT_CHARS) {
    return text;
  }

  const half = Math.floor((SUMMARY_MAX_INPUT_CHARS - 120) / 2);
  return [
    text.slice(0, half),
    `\n\n[Middle omitted for compaction: ${text.length - (half * 2)} characters]\n\n`,
    text.slice(-half)
  ].join('');
}

function truncateMiddle(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) {
    return text;
  }

  const half = Math.floor((maxCharacters - 80) / 2);
  return [
    text.slice(0, half).trimEnd(),
    `\n[Truncated ${text.length - (half * 2)} characters]\n`,
    text.slice(-half).trimStart()
  ].join('');
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getDeckSlides(value: unknown): Record<string, unknown>[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const slides = Array.isArray(record.slides)
    ? record.slides
    : record.deck && typeof record.deck === 'object' && !Array.isArray(record.deck) && Array.isArray((record.deck as { slides?: unknown }).slides)
      ? (record.deck as { slides: unknown[] }).slides
      : null;

  if (!slides) {
    return null;
  }

  return slides.filter((slide): slide is Record<string, unknown> =>
    !!slide && typeof slide === 'object' && !Array.isArray(slide)
  );
}

function getRecordString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

import type { Processor, ProcessInputStepArgs } from '@mastra/core/processors';
import type { WorkflowProviderContext } from '../workflows/schemas.js';
import { summarizeForContinuity } from '../compaction.js';
import { getPepeteXAgentRequestContext } from './context.js';

export interface ContextCompactionProcessorOptions {
  /** The per-call input token budget (same value used for the prompt-layer compaction budget). */
  inputTokenLimit: number;
  /** Fraction of the budget at which auto-compaction kicks in. */
  autoTriggerRatio?: number;
  /** Fraction of the budget above which the summarize pass runs (after pruning). */
  summarizeRatio?: number;
  /** Approximate tokens of the most-recent conversation to always preserve verbatim. */
  preserveRecentTokens?: number;
  /** Minimum reclaimable tokens before a compaction is considered worthwhile. */
  pruneMinTokens?: number;
}

interface CompactionProcessorState {
  lastCompactedAtStep: number;
}

/**
 * In-band conversation compaction for the PepeteX generation agent.
 *
 * Runs before every model step (like Mastra's built-in TokenLimiterProcessor). When the
 * running conversation approaches the model's input budget, it summarizes the older prefix
 * of the conversation into a single digest message and removes the originals, preserving the
 * most-recent turns verbatim. The draft deck itself is never carried only in the chat — it
 * lives in DB checkpoints and is re-read via read_deck_state — so summarizing the transcript
 * loses no deck state.
 *
 * Safety: the prefix is always cut at a `user`-role boundary so no tool-call/tool-result pair
 * is split, system messages are never touched, and any failure degrades to a no-op (it never
 * throws into the agent loop, which would abort the run).
 */
export class ContextCompactionProcessor implements Processor<'pepetex-context-compaction'> {
  readonly id = 'pepetex-context-compaction';
  readonly name = 'PepeteX Context Compaction';

  private readonly inputTokenLimit: number;
  private readonly autoTriggerRatio: number;
  private readonly summarizeRatio: number;
  private readonly preserveRecentTokens: number;
  private readonly pruneMinTokens: number;

  constructor(options: ContextCompactionProcessorOptions) {
    this.inputTokenLimit = Math.max(4_096, options.inputTokenLimit);
    this.autoTriggerRatio = options.autoTriggerRatio ?? 0.8;
    this.summarizeRatio = options.summarizeRatio ?? 0.9;
    this.preserveRecentTokens = options.preserveRecentTokens ?? 40_000;
    this.pruneMinTokens = options.pruneMinTokens ?? 20_000;
  }

  async processInputStep(args: ProcessInputStepArgs): Promise<void> {
    try {
      await this.compactIfNeeded(args);
    } catch (error) {
      // Never throw into the agent loop — a thrown processor aborts the whole run.
      console.warn('Context compaction skipped after an error.', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async compactIfNeeded(args: ProcessInputStepArgs): Promise<void> {
    const request = getSafeRequestContext(args);
    if (!request) return;

    const forced = request.runtime.consumeForceCompactFlag();
    const messages = args.messages ?? [];
    if (messages.length < 4) return;

    const totalTokens = estimateMessagesTokens(messages);
    const autoThreshold = this.inputTokenLimit * this.autoTriggerRatio;
    if (!forced && totalTokens < autoThreshold) return;

    const state = args.state as Partial<CompactionProcessorState>;
    // Avoid compacting on two consecutive steps unless explicitly forced.
    if (!forced && state.lastCompactedAtStep === args.stepNumber - 1) return;

    // Find a clean cut: remove the oldest messages up to (but not including) the most-recent
    // window, snapping the boundary to a `user` message so tool-call/result pairs stay intact.
    const cutIndex = this.resolveCutIndex(messages);
    if (cutIndex <= 0) return;

    const olderMessages = messages.slice(0, cutIndex);
    const reclaimableTokens = estimateMessagesTokens(olderMessages);
    if (!forced && reclaimableTokens < this.pruneMinTokens) return;

    const olderIds = olderMessages.map((message) => message.id).filter((id): id is string => typeof id === 'string');
    if (olderIds.length === 0) return;

    const provider = buildWorkflowProvider(request.provider);
    const text = serializeMessagesForSummary(olderMessages);
    const summary = await summarizeForContinuity(
      provider,
      text,
      [
        'Summarize the earlier part of an in-progress deck-generation conversation so the agent can continue without the full transcript.',
        'Capture: what has already been done, the current work in progress, any modified/added slide ids and their intent, decisions and constraints, open clarifications, and the immediate next steps.',
        'Keep it factual and concrete. Do not invent anything that was not in the transcript.'
      ].join('\n'),
      8_000
    );

    args.messageList.removeByIds(olderIds);
    args.messageList.add(
      {
        role: 'user',
        content: `[Compacted earlier conversation context]\n${summary}`
      },
      'context'
    );

    const tokensAfter = estimateMessagesTokens(args.messageList.get.all.db());
    state.lastCompactedAtStep = args.stepNumber;

    await request.runtime.recordCompactionEvent({
      detail: `Compacted conversation context to stay within the model token budget (~${Math.round(totalTokens).toLocaleString()} → ~${Math.round(tokensAfter).toLocaleString()} tokens).`,
      tokensBefore: Math.round(totalTokens),
      tokensAfter: Math.round(tokensAfter)
    });
  }

  /**
   * Returns the index marking the end of the prefix to summarize. Walks back from the end of the
   * conversation accumulating tokens until the preserved-recent budget is reached, then snaps the
   * boundary up to the nearest earlier `user` message so a tool-call/result pair is never split.
   * Returns 0 when there is nothing safe to compact.
   */
  private resolveCutIndex(messages: ProcessInputStepArgs['messages']): number {
    let recentTokens = 0;
    let windowStart = messages.length;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (!message) continue;
      recentTokens += estimateMessageTokens(message);
      windowStart = i;
      if (recentTokens >= this.preserveRecentTokens) break;
    }

    // Snap the cut to a user-message boundary at or before the recent-window start.
    for (let i = windowStart; i > 0; i -= 1) {
      if (messages[i]?.role === 'user') return i;
    }
    return 0;
  }
}

function getSafeRequestContext(args: ProcessInputStepArgs) {
  try {
    return getPepeteXAgentRequestContext(args.requestContext);
  } catch {
    return null;
  }
}

function buildWorkflowProvider(provider: ReturnType<typeof getPepeteXAgentRequestContext>['provider']): WorkflowProviderContext {
  return {
    kind: provider.kind,
    baseUrl: provider.ctx.baseUrl ?? null,
    credential: provider.ctx.credential as WorkflowProviderContext['credential'],
    model: provider.modelId
  };
}

function estimateMessagesTokens(messages: ProcessInputStepArgs['messages']): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function estimateMessageTokens(message: ProcessInputStepArgs['messages'][number]): number {
  try {
    return Math.ceil(JSON.stringify(message.content ?? '').length / 4);
  } catch {
    return 0;
  }
}

function serializeMessagesForSummary(messages: ProcessInputStepArgs['messages']): string {
  return messages
    .map((message) => {
      const role = message.role ?? 'unknown';
      const text = extractMessageText(message);
      return `### ${role}\n${text}`;
    })
    .join('\n\n');
}

function extractMessageText(message: ProcessInputStepArgs['messages'][number]): string {
  const content = message.content as { parts?: Array<Record<string, unknown>> } | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts)) {
    try {
      return JSON.stringify(content ?? '');
    } catch {
      return '';
    }
  }

  return parts
    .map((part) => {
      const type = typeof part.type === 'string' ? part.type : '';
      if (type === 'text' && typeof part.text === 'string') return part.text;
      if (type === 'reasoning' && typeof part.text === 'string') return `(reasoning) ${part.text}`;
      if (type.startsWith('tool')) {
        // Keep tool activity compact — names and a short result excerpt are enough for continuity.
        try {
          return `(tool ${type}) ${JSON.stringify(part).slice(0, 600)}`;
        } catch {
          return `(tool ${type})`;
        }
      }
      return '';
    })
    .filter((segment) => segment.length > 0)
    .join('\n');
}

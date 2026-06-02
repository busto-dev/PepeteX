import { describe, expect, it } from 'vitest';
import type { PromptAssemblyInput } from '@pepetex/prompts';
import { createPromptLayerCompactionStrategy, runCompaction } from './compaction.js';

describe('prompt layer compaction', () => {
  it('is a no-op when the prompt is already within budget', async () => {
    const context: PromptAssemblyInput = {
      manualInstruction: 'Create a short deck.'
    };

    const result = await runCompaction({
      context,
      budgetTokens: 100,
      countTokens: async () => 10,
      strategy: createPromptLayerCompactionStrategy(),
      summarize: async () => 'unused'
    });

    expect(result.context).toEqual(context);
    expect(result.events).toEqual([]);
    expect(result.withinBudget).toBe(true);
  });

  it('compacts oversized reference files first and stops once under budget', async () => {
    const context: PromptAssemblyInput = {
      manualInstruction: 'Create a market landscape deck.',
      designSystemInstruction: 'Design system should remain untouched.',
      referenceFiles: [
        {
          filename: 'large-brief.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.from('Important market facts. '.repeat(500)).toString('base64'),
          attachedToModel: true,
          attachmentMode: 'inline'
        },
        {
          filename: 'small-note.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.from('Small note').toString('base64'),
          attachedToModel: true,
          attachmentMode: 'inline'
        }
      ]
    };

    const countTokens = async (input: PromptAssemblyInput) =>
      Math.ceil(
        [
          input.manualInstruction ?? '',
          input.designSystemInstruction ?? '',
          ...(input.referenceFiles ?? []).map((file) => `${file.contentBase64 ?? ''}${file.summary ?? ''}`)
        ].join('').length / 20
      );

    const result = await runCompaction({
      context,
      budgetTokens: 80,
      countTokens,
      strategy: createPromptLayerCompactionStrategy(),
      summarize: async ({ text }) => `summary:${text.slice(0, 40)}`
    });

    expect(result.withinBudget).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.layer).toBe('reference-files');
    expect(result.context.referenceFiles?.[0]?.contentBase64).toBeUndefined();
    expect(result.context.referenceFiles?.[0]?.summary).toContain('summary:');
    expect(result.context.designSystemInstruction).toBe('Design system should remain untouched.');
  });

  it('preserves target slides verbatim when compacting deck state', async () => {
    const deckState = JSON.stringify({
      title: 'Existing deck',
      slides: [
        {
          id: 'slide_target',
          title: 'Target',
          html: '<section>TARGET_HTML_SHOULD_STAY</section>',
          css: '.target { color: red; }'
        },
        {
          id: 'slide_other',
          title: 'Other',
          html: '<section>OTHER_HTML_SHOULD_BE_SUMMARIZED</section>',
          css: '.other { color: blue; }'
        }
      ]
    });

    const result = await runCompaction({
      context: { deckState },
      budgetTokens: 20,
      countTokens: async (input) => Math.ceil((input.deckState ?? '').length / 10),
      strategy: createPromptLayerCompactionStrategy({ targetSlideIds: ['slide_target'] }),
      summarize: async () => 'Other slide summarized for continuity.'
    });

    expect(result.context.deckState).toContain('TARGET_HTML_SHOULD_STAY');
    expect(result.context.deckState).not.toContain('OTHER_HTML_SHOULD_BE_SUMMARIZED');
    expect(result.context.deckState).toContain('Other slide summarized for continuity.');
  });
});

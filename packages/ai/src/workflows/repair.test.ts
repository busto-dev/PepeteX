import { describe, expect, it, vi, beforeEach } from 'vitest';

import { validateGeneratedDeckContract } from '@pepetex/html-contract';

import { createPepeteXMastra } from '../mastra.js';
import type { DeckGenerationResult, DeckPatchResult } from '../index.js';
import {
  buildDeckPatchRepairPromptPayload,
  buildDeckRepairPromptPayload
} from './repair.js';
import type { WorkflowProviderContext } from './schemas.js';

vi.mock('@pepetex/providers', () => ({
  createTextProviderAdapter: vi.fn(() => ({
    generateStructured: vi.fn()
  }))
}));

const testProvider: WorkflowProviderContext = {
  kind: 'gemini',
  baseUrl: null,
  credential: { apiKey: 'test-key' },
  model: 'gemini-3.1-flash-lite-preview'
};

const invalidDeckResult: DeckGenerationResult = {
  mode: 'deck',
  schemaVersion: 'pepetex.deck.v1',
  deck: {
    title: 'Broken Deck',
    language: 'en',
    aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080 },
    slides: [
      {
        id: 'slide_01',
        title: 'Unsafe Intro',
        html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_01" style="position:relative;width:1920px;height:1080px;overflow:hidden;"><script>alert(1)</script><h1 data-pepetex-id="title" data-pepetex-type="headline">Hello</h1></section>',
        css: '',
        assets: [],
        charts: [],
        diagrams: []
      }
    ]
  },
  assumptions: [],
  warnings: [],
  designSystemRulesUsed: []
};

const validDeckResult: DeckGenerationResult = {
  mode: 'deck',
  schemaVersion: 'pepetex.deck.v1',
  deck: {
    title: 'Repaired Strategy Deck',
    language: 'en',
    aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080 },
    slides: [
      buildQualitySlide('slide_01', 'Modernization cuts release risk', 'chart'),
      buildQualitySlide('slide_02', 'A staged roadmap protects delivery', 'group'),
      buildQualitySlide('slide_03', 'Automation removes manual bottlenecks', 'card'),
      buildQualitySlide('slide_04', 'Governance keeps adoption measurable', 'chart'),
      buildQualitySlide('slide_05', 'Operating rhythms sustain momentum', 'group'),
      buildQualitySlide('slide_06', 'The next decision unlocks execution', 'card')
    ]
  },
  assumptions: [],
  warnings: [],
  designSystemRulesUsed: []
};

function buildQualitySlide(
  id: string,
  title: string,
  visualType: 'card' | 'chart' | 'group'
): DeckGenerationResult['deck']['slides'][number] {
  const visualId = `${id}_visual`;
  const chartAttribute = visualType === 'chart' ? ` data-pepetex-chart-id="${visualId}"` : '';

  return {
    id,
    title,
    html: `<section class="pepetex-slide" data-pepetex-slide-id="${id}" data-pepetex-width="1920" data-pepetex-height="1080" style="position:relative;width:1920px;height:1080px;overflow:hidden;"><h1 data-pepetex-id="${id}_headline" data-pepetex-type="headline">${title}</h1><div class="visual" data-pepetex-id="${visualId}" data-pepetex-type="${visualType}"${chartAttribute}>Evidence-backed visual module with clear executive takeaway</div></section>`,
    css: `[data-pepetex-slide-id="${id}"] { background: #f8fafc; color: #0f172a; font-family: Inter, Arial, sans-serif; padding: 96px; } [data-pepetex-slide-id="${id}"] h1 { font-size: 64px; line-height: 1.05; margin: 0 0 36px; } [data-pepetex-slide-id="${id}"] .visual { display: flex; align-items: center; justify-content: center; min-height: 360px; border-radius: 40px; background: linear-gradient(135deg, #dbeafe, #ccfbf1); font-size: 28px; line-height: 1.25; padding: 48px; }`,
    assets: [],
    charts: visualType === 'chart'
      ? [{
          id: visualId,
          kind: 'bar',
          title,
          categories: ['Baseline', 'Improved'],
          series: [{ name: 'Score', values: [42, 78] }],
          sourceRef: 'Test fixture'
        }]
      : [],
    diagrams: []
  };
}

const invalidPatchResult: DeckPatchResult = {
  mode: 'deck_patch',
  schemaVersion: 'pepetex.patch.v1',
  patch: {
    operations: [
      {
        op: 'insert_slide',
        position: 'end',
        slide: {
          id: 'slide_new',
          title: 'Unsafe New Slide',
          html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_new" style="position:relative;width:1920px;height:1080px;overflow:hidden;"><div data-pepetex-id="body" data-pepetex-type="body" onclick="alert(1)">Unsafe</div></section>',
          css: '',
          assets: [],
          charts: [],
          diagrams: []
        }
      }
    ]
  },
  assumptions: [],
  warnings: [],
  userVisibleSummary: 'Added one slide.'
};

const validPatchResult: DeckPatchResult = {
  mode: 'deck_patch',
  schemaVersion: 'pepetex.patch.v1',
  patch: {
    operations: [
      {
        op: 'insert_slide',
        position: 'end',
        slide: {
          id: 'slide_new',
          title: 'Safe New Slide',
          html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_new" style="position:relative;width:1920px;height:1080px;overflow:hidden;"><div data-pepetex-id="body" data-pepetex-type="body">Safe</div></section>',
          css: '',
          assets: [],
          charts: [],
          diagrams: []
        }
      }
    ]
  },
  assumptions: [],
  warnings: [],
  userVisibleSummary: 'Added one slide.'
};

describe('repair prompt payloads', () => {
  it('builds a deck repair payload from contract failures', () => {
    const validationResults = validateGeneratedDeckContract({ deck: invalidDeckResult.deck });
    const payload = buildDeckRepairPromptPayload(invalidDeckResult, validationResults);

    expect(payload.target).toBe('deck');
    expect(payload.slidesToRepair).toHaveLength(1);
    expect(payload.slidesToRepair[0]?.slideId).toBe('slide_01');
    expect(payload.slidesToRepair[0]?.errors.map((error) => error.code)).toContain('FORBIDDEN_TAG');
  });

  it('builds a deck_patch repair payload for changed slides only', () => {
    const payload = buildDeckPatchRepairPromptPayload(invalidPatchResult, [
      {
        operationIndex: 0,
        operation: invalidPatchResult.patch.operations[0] as Extract<
          DeckPatchResult['patch']['operations'][number],
          { op: 'replace_slide' | 'insert_slide' }
        >,
        validation: {
          ok: false,
          severity: 'blocked',
          errors: [
            {
              code: 'SCRIPT_DETECTED',
              message: 'onclick is forbidden.',
              repairHint: 'Remove all inline event handlers.'
            }
          ],
          warnings: [],
          elementIndex: []
        }
      }
    ]);

    expect(payload.target).toBe('deck_patch');
    expect(payload.targetsToRepair).toHaveLength(1);
    expect(payload.targetsToRepair[0]?.op).toBe('insert_slide');
    expect(payload.targetsToRepair[0]?.errors[0]?.code).toBe('SCRIPT_DETECTED');
  });
});

describe('workflow repair loop integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('repairs invalid deck output before completing the deck workflow', async () => {
    const { createTextProviderAdapter } = await import('@pepetex/providers');
    const prompts: string[] = [];
    const mockAdapter = {
      generateStructured: vi
        .fn()
        .mockImplementation(
          (input: { prompt: string }) => {
            prompts.push(input.prompt);
            const output = prompts.length === 1 ? invalidDeckResult : validDeckResult;
            return Promise.resolve({
              model: 'gemini-3.1-flash-lite-preview',
              output
            });
          }
        )
    };
    (createTextProviderAdapter as ReturnType<typeof vi.fn>).mockReturnValue(mockAdapter);

    const mastra = createPepeteXMastra();
    const workflow = mastra.getWorkflow('generateDeckWorkflow');
    const run = await workflow.createRun();

    const result = await run.start({
      inputData: {
        workspaceId: 'ws_01',
        actorUserId: 'user_01',
        provider: testProvider,
        promptInput: { manualInstruction: 'Create a company overview deck' },
        settings: { maxRepairAttempts: 2 }
      }
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.result?.mode).toBe('deck');
    }
    expect(mockAdapter.generateStructured).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toContain('## Repair Payload');
    expect(prompts[1]).toContain('FORBIDDEN_TAG');
  });

  it('normalizes double-encoded deck repair JSON from providers', async () => {
    const { createTextProviderAdapter } = await import('@pepetex/providers');
    const mockAdapter = {
      generateStructured: vi
        .fn()
        .mockImplementationOnce(() => Promise.resolve({
          model: 'gemini-3.1-flash-lite-preview',
          output: invalidDeckResult
        }))
        .mockImplementationOnce(() => Promise.resolve({
          model: 'gemini-3.1-flash-lite-preview',
          output: JSON.stringify(validDeckResult)
        }))
    };
    (createTextProviderAdapter as ReturnType<typeof vi.fn>).mockReturnValue(mockAdapter);

    const mastra = createPepeteXMastra();
    const workflow = mastra.getWorkflow('generateDeckWorkflow');
    const run = await workflow.createRun();

    const result = await run.start({
      inputData: {
        workspaceId: 'ws_01',
        actorUserId: 'user_01',
        provider: testProvider,
        promptInput: { manualInstruction: 'Create a company overview deck' },
        settings: { maxRepairAttempts: 2 }
      }
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.result?.mode).toBe('deck');
    }
    expect(mockAdapter.generateStructured).toHaveBeenCalledTimes(2);
  });

  it('repairs invalid patch output before completing the single-slide workflow', async () => {
    const { createTextProviderAdapter } = await import('@pepetex/providers');
    const prompts: string[] = [];
    const mockAdapter = {
      generateStructured: vi
        .fn()
        .mockImplementation(
          (input: { prompt: string }) => {
            prompts.push(input.prompt);
            const output = prompts.length === 1 ? invalidPatchResult : validPatchResult;
            return Promise.resolve({
              model: 'gemini-3.1-flash-lite-preview',
              output
            });
          }
        )
    };
    (createTextProviderAdapter as ReturnType<typeof vi.fn>).mockReturnValue(mockAdapter);

    const mastra = createPepeteXMastra();
    const workflow = mastra.getWorkflow('generateSingleSlideWorkflow');
    const run = await workflow.createRun();

    const result = await run.start({
      inputData: {
        workspaceId: 'ws_01',
        deckId: 'deck_01',
        actorUserId: 'user_01',
        slideInstruction: 'Add a closing CTA slide.',
        provider: testProvider,
        promptInput: { manualInstruction: 'Add a closing slide' },
        settings: { maxRepairAttempts: 2 }
      }
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.result?.mode).toBe('deck_patch');
    }
    expect(mockAdapter.generateStructured).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toContain('## Repair Payload');
    expect(prompts[1]).toContain('SCRIPT_DETECTED');
  });
});

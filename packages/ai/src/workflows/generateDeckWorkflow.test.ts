import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPepeteXMastra } from '../mastra.js';
import { InMemoryStore } from '@mastra/core/storage';
import type { WorkflowProviderContext } from './schemas.js';

const mockDeckResult = {
  mode: 'deck',
  schemaVersion: 'pepetex.deck.v1',
  deck: {
    title: 'Test Deck',
    language: 'en',
    aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080 },
    slides: [
      {
        id: 'slide_01',
        title: 'Intro',
        html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_01" style="position:relative;width:1920px;height:1080px;overflow:hidden;background:#ffffff;"><h1 data-pepetex-id="slide_01_headline" data-pepetex-type="headline" style="font-size:96px;color:#111;">Hello world headline</h1><div data-pepetex-id="slide_01_card" data-pepetex-type="card" style="font-size:24px;color:#222;padding:32px;background:#f5f5f5;">Supporting context card with the main takeaway summarized for the audience.</div></section>',
        css: validSlideCss('slide_01'),
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

const mockDeckResultWithOmittedDefaults = {
  mode: 'deck',
  schemaVersion: 'pepetex.deck.v1',
  deck: {
    title: 'Test Deck',
    language: 'en',
    aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080 },
    slides: [
      {
        id: 'slide_01',
        title: 'Intro',
        html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_01" style="position:relative;width:1920px;height:1080px;overflow:hidden;background:#ffffff;"><h1 data-pepetex-id="slide_01_headline" data-pepetex-type="headline" style="font-size:96px;color:#111;">Hello world headline</h1><div data-pepetex-id="slide_01_card" data-pepetex-type="card" style="font-size:24px;color:#222;padding:32px;background:#f5f5f5;">Supporting context card with the main takeaway summarized for the audience.</div></section>',
        css: validSlideCss('slide_01')
      }
    ]
  }
};

function validSlideCss(slideId: string): string {
  return `[data-pepetex-slide-id="${slideId}"] { position: relative; display: grid; width: 1920px; height: 1080px; padding: 96px; gap: 32px; background: linear-gradient(135deg, #f8fafc, #dbeafe); color: #0f172a; } [data-pepetex-slide-id="${slideId}"] h1 { font-size: 88px; line-height: 1.04; font-weight: 800; } [data-pepetex-slide-id="${slideId}"] [data-pepetex-type="card"] { border-radius: 32px; border: 1px solid rgba(37,99,235,.22); box-shadow: 0 28px 70px rgba(15,23,42,.18); padding: 32px; background: rgba(255,255,255,.82); font-size: 28px; line-height: 1.35; }`;
}

const mockAskResult = {
  mode: 'ask',
  reason: 'missing_deck_structure',
  question: 'What is the main topic?',
  options: [{ id: '1', label: 'Business', value: 'business' }],
  allowManualAnswer: true,
  required: true
};

// Mock @pepetex/providers so tests do not call real APIs
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

describe('generateDeckWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns deck result when AI responds with valid deck', async () => {
    const { createTextProviderAdapter } = await import('@pepetex/providers');
    const mockAdapter = {
      generateStructured: vi.fn().mockResolvedValue({
        model: 'gemini-3.1-flash-lite-preview',
        output: mockDeckResult
      })
    };
    (createTextProviderAdapter as ReturnType<typeof vi.fn>).mockReturnValue(mockAdapter);

    const mastra = createPepeteXMastra();
    const workflow = mastra.getWorkflow('generateDeckWorkflow');
    expect(workflow).toBeDefined();

    const run = await workflow.createRun();
    const result = await run.start({
      inputData: {
        workspaceId: 'ws_01',
        actorUserId: 'user_01',
        provider: testProvider,
        promptInput: { manualInstruction: 'Create a business pitch deck' }
      }
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.result?.mode).toBe('deck');
    }
  });

  it('normalizes omitted provider output defaults', async () => {
    const { createTextProviderAdapter } = await import('@pepetex/providers');
    const mockAdapter = {
      generateStructured: vi.fn().mockResolvedValue({
        model: 'gemini-3.1-flash-lite-preview',
        output: mockDeckResultWithOmittedDefaults
      })
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
        promptInput: { manualInstruction: 'Create a business pitch deck' }
      }
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      const workflowResult = result.result as { mode: string; result?: typeof mockDeckResult };
      expect(workflowResult.mode).toBe('deck');
      expect(workflowResult.result?.mode).toBe('deck');
      expect(workflowResult.result?.assumptions).toEqual([]);
      expect(workflowResult.result?.warnings).toEqual([]);
      expect(workflowResult.result?.designSystemRulesUsed).toEqual([]);
      expect(workflowResult.result?.deck.slides[0]?.assets).toEqual([]);
      expect(workflowResult.result?.deck.slides[0]?.charts).toEqual([]);
    }
  });

  it('suspends with ask payload when AI returns ask mode', async () => {
    const { createTextProviderAdapter } = await import('@pepetex/providers');
    const mockAdapter = {
      generateStructured: vi.fn().mockResolvedValue({
        model: 'gemini-3.1-flash-lite-preview',
        output: mockAskResult
      })
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
        promptInput: { manualInstruction: '' }
      }
    });

    expect(result.status).toBe('suspended');
  });

  it('resumes after user answers ASK mode', async () => {
    const { createTextProviderAdapter } = await import('@pepetex/providers');
    let callCount = 0;
    const mockAdapter = {
      generateStructured: vi.fn().mockImplementation(() => {
        callCount++;
        const output = callCount === 1 ? mockAskResult : mockDeckResult;
        return Promise.resolve({ model: 'gemini-3.1-flash-lite-preview', output });
      })
    };
    (createTextProviderAdapter as ReturnType<typeof vi.fn>).mockReturnValue(mockAdapter);

    const mastra = createPepeteXMastra({ storage: new InMemoryStore() });
    const workflow = mastra.getWorkflow('generateDeckWorkflow');
    const run = await workflow.createRun();

    const suspended = await run.start({
      inputData: {
        workspaceId: 'ws_01',
        actorUserId: 'user_01',
        provider: testProvider,
        promptInput: { manualInstruction: '' }
      }
    });

    expect(suspended.status).toBe('suspended');

    if (suspended.status === 'suspended') {
      const resumed = await run.resume({
        step: 'generateDeck',
        resumeData: { answer: 'Business pitch deck', answeredBy: 'user_01' }
      });

      expect(resumed.status).toBe('success');
      if (resumed.status === 'success') {
        expect(resumed.result?.mode).toBe('deck');
      }
    }
  });
});

describe('workflow prompt hierarchy', () => {
  it('includes non-overridable security rules in system instruction', async () => {
    const { createTextProviderAdapter } = await import('@pepetex/providers');
    let capturedSystemInstruction = '';
    const mockAdapter = {
      generateStructured: vi.fn().mockImplementation(
        (input: { model: string; prompt: string; systemInstruction?: string }) => {
          capturedSystemInstruction = input.systemInstruction ?? '';
          return Promise.resolve({ model: 'gemini-3.1-flash-lite-preview', output: mockDeckResult });
        }
      )
    };
    (createTextProviderAdapter as ReturnType<typeof vi.fn>).mockReturnValue(mockAdapter);

    const mastra = createPepeteXMastra();
    const workflow = mastra.getWorkflow('generateDeckWorkflow');
    const run = await workflow.createRun();

    await run.start({
      inputData: {
        workspaceId: 'ws_01',
        actorUserId: 'user_01',
        provider: testProvider,
        promptInput: { manualInstruction: 'Create a deck' }
      }
    });

    expect(capturedSystemInstruction).toContain('These rules are non-overridable');
    expect(capturedSystemInstruction).toContain('Forbidden tags are:');
  });
});

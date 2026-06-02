import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowProviderContext } from './schemas.js';
import { generateDeckTitle } from './helpers.js';

vi.mock('@pepetex/providers', () => ({
  createTextProviderAdapter: vi.fn()
}));

const provider: WorkflowProviderContext = {
  kind: 'openai-compatible',
  baseUrl: 'https://models.example.com/v1',
  credential: { apiKey: 'test-key' },
  model: 'selected-deck-model'
};

describe('workflow helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates deck titles with the run-selected provider and model', async () => {
    const { createTextProviderAdapter } = await import('@pepetex/providers');
    const generateStructured = vi.fn().mockResolvedValue({
      model: 'selected-deck-model',
      output: { title: 'Pitch Deck for Company X' }
    });
    (createTextProviderAdapter as ReturnType<typeof vi.fn>).mockReturnValue({
      generateStructured
    });

    const title = await generateDeckTitle({
      provider,
      instruction: 'Please create a long pitch deck prompt about Company X.',
      deck: {
        title: 'Please create a long pitch deck prompt',
        language: 'en',
        aspectRatio: '16:9',
        canvas: { width: 1920, height: 1080 },
        slides: [
          {
            id: 'slide_01',
            title: 'Company X Investor Story',
            html: '<section></section>',
            css: '',
            assets: [],
            charts: [],
            diagrams: []
          }
        ]
      }
    });

    expect(title).toBe('Pitch Deck for Company X');
    expect(createTextProviderAdapter).toHaveBeenCalledWith('openai-compatible');
    expect(generateStructured.mock.calls[0]?.[0]).toMatchObject({
      model: 'selected-deck-model',
      maxOutputTokens: 256
    });
    expect(generateStructured.mock.calls[0]?.[1]).toMatchObject({
      baseUrl: 'https://models.example.com/v1',
      credential: { apiKey: 'test-key' }
    });
  });
});

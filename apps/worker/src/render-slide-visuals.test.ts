import { describe, expect, it } from 'vitest';

import type { GeneratedDeck } from '@pepetex/ai';
import { validateGeneratedDeckContract } from '@pepetex/html-contract';
import { renderDeckVisuals } from './render-slide-visuals.js';

describe('renderDeckVisuals', () => {
  it('renders chart SVGs and stamps chart containers with data-pepetex-chart-id', async () => {
    const deck: GeneratedDeck = {
      title: 'Chart deck',
      language: 'en',
      aspectRatio: '16:9',
      canvas: { width: 1920, height: 1080 },
      slides: [
        {
          id: 'slide_1',
          title: 'Growth',
          html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_1"><div data-pepetex-id="chart_growth" data-pepetex-type="chart"></div></section>',
          css: '.pepetex-slide { position: relative; width: 1920px; height: 1080px; }',
          assets: [],
          charts: [
            {
              id: 'chart_growth',
              kind: 'bar',
              title: 'Illustrative growth',
              categories: ['Q1', 'Q2'],
              series: [{ name: 'Revenue', values: [12, 24] }],
              sourceRef: 'Illustrative model estimate'
            }
          ],
          diagrams: []
        }
      ]
    };

    const rendered = await renderDeckVisuals(deck);
    const html = rendered.slides[0]!.html;

    expect(html).toContain('data-pepetex-chart-id="chart_growth"');
    expect(html).toContain('<svg');
    expect(html).not.toContain('<style');
    expect(rendered.slides[0]!.charts[0]!.sourceRef).toBe('Illustrative model estimate');
    expect(validateGeneratedDeckContract({ deck: rendered }).every((result) => result.ok)).toBe(true);
  });
});

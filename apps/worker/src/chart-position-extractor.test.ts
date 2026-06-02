import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { collectChartPositionsFromDocument } from './chart-position-extractor.js';

describe('collectChartPositionsFromDocument', () => {
  it('finds charts by explicit chart id and by PepeteX chart element id fallback', () => {
    const dom = new JSDOM(`
      <section class="pepetex-slide">
        <div id="explicit" data-pepetex-chart-id="chart_explicit"></div>
        <div id="fallback" data-pepetex-id="chart_fallback" data-pepetex-type="chart"></div>
      </section>
    `);
    const document = dom.window.document;
    const slide = document.querySelector('.pepetex-slide') as HTMLElement;
    const explicit = document.getElementById('explicit') as HTMLElement;
    const fallback = document.getElementById('fallback') as HTMLElement;

    slide.getBoundingClientRect = () => rect(10, 20, 1920, 1080);
    explicit.getBoundingClientRect = () => rect(110, 220, 400, 240);
    fallback.getBoundingClientRect = () => rect(610, 320, 500, 260);

    const positions = collectChartPositionsFromDocument(document);

    expect(positions).toEqual([
      { slideIndex: 0, chartId: 'chart_explicit', x: 100, y: 200, width: 400, height: 240 },
      { slideIndex: 0, chartId: 'chart_fallback', x: 600, y: 300, width: 500, height: 260 }
    ]);
  });
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({})
  } as DOMRect;
}

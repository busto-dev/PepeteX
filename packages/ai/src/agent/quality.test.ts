import { describe, expect, it } from 'vitest';

import type { GeneratedDeck } from '../index.js';
import { inspectDeckQuality } from './quality.js';

describe('inspectDeckQuality', () => {
  it('accepts a varied deck with readable hierarchy and visual anchors', () => {
    const report = inspectDeckQuality({
      title: 'Cloud Strategy',
      language: 'en',
      aspectRatio: '16:9',
      canvas: { width: 1920, height: 1080 },
      slides: [
        slide('slide-1', 'Hero', 'image', 'hero'),
        slide('slide-2', 'Architecture', 'chart', 'diagram'),
        slide('slide-3', 'Action', 'card', 'cards')
      ]
    });

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('warns for tiny text and dense slides while rejecting structural quality failures', () => {
    const denseText = Array.from({ length: 150 }, (_, index) => `word${index}`).join(' ');
    const report = inspectDeckQuality({
      title: 'Dense Deck',
      language: 'en',
      aspectRatio: '16:9',
      canvas: { width: 1920, height: 1080 },
      slides: [
        {
          id: 'slide-dense',
          title: 'Dense',
          html: `<section><h1 data-pepetex-id="h1" data-pepetex-type="headline">Dense</h1><p data-pepetex-id="b1" data-pepetex-type="body">${denseText}</p></section>`,
          css: '.pepetex-slide h1 { font-size: 28px; } .pepetex-slide p { font-size: 12px; }',
          assets: [],
          charts: [],
          diagrams: []
        }
      ]
    });

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['TINY_TEXT', 'EXCESSIVE_PARAGRAPH_DENSITY', 'WEAK_HIERARCHY', 'MISSING_VISUAL_ANCHOR'])
    );
    expect(report.issues.find((issue) => issue.code === 'TINY_TEXT')?.severity).toBe('warning');
    expect(report.issues.find((issue) => issue.code === 'EXCESSIVE_PARAGRAPH_DENSITY')?.severity).toBe('warning');
    expect(report.issues.find((issue) => issue.code === 'WEAK_HIERARCHY')?.severity).toBe('error');
  });

  it('rejects semantic HTML that omits presentation CSS', () => {
    const report = inspectDeckQuality({
      title: 'Plain Deck',
      language: 'en',
      aspectRatio: '16:9',
      canvas: { width: 1920, height: 1080 },
      slides: [
        {
          id: 'slide-plain',
          title: 'Plain',
          html: '<section class="pepetex-slide" data-pepetex-slide-id="slide-plain"><div class="hero" data-pepetex-id="hero" data-pepetex-type="group"><h1 data-pepetex-id="headline" data-pepetex-type="headline">Plain but semantic</h1><div data-pepetex-id="card" data-pepetex-type="card">A visual anchor in name only</div></div></section>',
          css: '',
          assets: [],
          charts: [],
          diagrams: []
        }
      ]
    });

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('UNSTYLED_SLIDE');
  });

  it('rejects repeated card-grid layouts', () => {
    const deck: GeneratedDeck = {
      title: 'Repeated Cards',
      language: 'en',
      aspectRatio: '16:9',
      canvas: { width: 1920, height: 1080 },
      slides: [
        slide('slide-1', 'One', 'card', 'cards'),
        slide('slide-2', 'Two', 'card', 'cards'),
        slide('slide-3', 'Three', 'card', 'cards')
      ]
    };

    const report = inspectDeckQuality(deck);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('REPEATED_CARD_GRID_LAYOUT');
  });

  it('rejects shallow full-deck output when no short deck was requested', () => {
    const report = inspectDeckQuality({
      title: 'Market Expansion Strategy',
      language: 'en',
      aspectRatio: '16:9',
      canvas: { width: 1920, height: 1080 },
      slides: [
        slide('slide-1', 'Overview', 'card', 'cards'),
        slide('slide-2', 'Details', 'chart', 'diagram'),
        slide('slide-3', 'Next steps', 'image', 'hero')
      ]
    }, { requireSubstantialDeck: true, minSlideCount: 6 });

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['UNDERDEVELOPED_DECK', 'WEAK_SLIDE_PURPOSE'])
    );
  });
});

function slide(id: string, title: string, anchorType: 'image' | 'chart' | 'card', layout: string): GeneratedDeck['slides'][number] {
  const anchorHtml =
    anchorType === 'image'
      ? '<img data-pepetex-id="image" data-pepetex-type="image" alt="Cloud platform" src="pepetex://asset/cloud">'
      : anchorType === 'chart'
        ? '<div data-pepetex-id="chart" data-pepetex-type="chart"><svg></svg></div>'
        : Array.from({ length: 4 }, (_, index) => `<div data-pepetex-id="card-${index}" data-pepetex-type="card">Card ${index + 1}</div>`).join('');

  return {
    id,
    title,
    html: `<section><h1 data-pepetex-id="headline" data-pepetex-type="headline">${title}</h1>${anchorHtml}</section>`,
    css: `.pepetex-slide { position: relative; display: ${layout === 'cards' ? 'grid' : 'flex'}; width: 1920px; height: 1080px; padding: 96px; background: linear-gradient(135deg, #0f172a, #2563eb); color: #ffffff; gap: 32px; } .pepetex-slide h1 { font-size: 56px; line-height: 1.05; font-weight: 800; } .pepetex-slide div, .pepetex-slide p { font-size: 24px; line-height: 1.35; } .pepetex-slide [data-pepetex-type="card"] { border-radius: 28px; border: 1px solid rgba(255,255,255,.22); box-shadow: 0 28px 80px rgba(15,23,42,.28); padding: 28px; background: rgba(255,255,255,.14); }`,
    assets: [],
    charts: [],
    diagrams: []
  };
}
import { describe, expect, it } from 'vitest';

import {
  THUMBNAIL_CONTENT_TYPE,
  buildPdfExportDocument,
  buildPptxExportDocument,
  buildSlideThumbnailDocument,
  scopeSlideCssToRoot,
  runExportDryRun
} from './index';

describe('scopeSlideCssToRoot (cross-slide CSS isolation)', () => {
  it('rewrites the .pepetex-slide root token to a per-slide attribute selector', () => {
    const css = '.pepetex-slide { background: #fcfaf7; display: flex; } .pepetex-slide .badge { padding: 8px; }';
    const scoped = scopeSlideCssToRoot(css, 'slide_1');
    expect(scoped).toContain('[data-pepetex-slide-id="slide_1"] { background: #fcfaf7; display: flex; }');
    expect(scoped).toContain('[data-pepetex-slide-id="slide_1"] .badge { padding: 8px; }');
    expect(scoped).not.toMatch(/\.pepetex-slide(?![\w-])/);
  });

  it('does not corrupt class names that merely start with pepetex-slide', () => {
    const css = '.pepetex-slide-inner { color: red; }';
    expect(scopeSlideCssToRoot(css, 'slide_1')).toBe('.pepetex-slide-inner { color: red; }');
  });

  it('isolates conflicting root rules between slides in the PPTX export document', () => {
    const result = buildPptxExportDocument({
      slides: [
        {
          id: 'slide_1',
          title: 'One',
          html: '<div class="pepetex-slide" data-pepetex-slide-id="slide_1"></div>',
          css: '.pepetex-slide { flex-direction: row; background-color: #fcfaf7; }'
        },
        {
          id: 'slide_2',
          title: 'Two',
          html: '<div class="pepetex-slide" data-pepetex-slide-id="slide_2"></div>',
          css: '.pepetex-slide { flex-direction: column; background-color: #2c1a1a; }'
        }
      ],
      fileName: 'deck.pptx',
      domToPptxScriptUrl: '/_pepetex/dom-to-pptx.bundle.js'
    });

    // Each slide's root rule must be scoped to its own id, so slide_2's column
    // layout cannot override slide_1's row layout.
    expect(result.html).toContain('[data-pepetex-slide-id="slide_1"] { flex-direction: row; background-color: #fcfaf7; }');
    expect(result.html).toContain('[data-pepetex-slide-id="slide_2"] { flex-direction: column; background-color: #2c1a1a; }');
  });

  it('isolates conflicting root rules between slides in the PDF export document', () => {
    const result = buildPdfExportDocument({
      slides: [
        {
          id: 'slide_1',
          title: 'One',
          html: '<div class="pepetex-slide" data-pepetex-slide-id="slide_1"></div>',
          css: '.pepetex-slide { flex-direction: row; }'
        },
        {
          id: 'slide_2',
          title: 'Two',
          html: '<div class="pepetex-slide" data-pepetex-slide-id="slide_2"></div>',
          css: '.pepetex-slide { flex-direction: column; }'
        }
      ],
      fileName: 'deck.pdf'
    });

    expect(result.html).toContain('[data-pepetex-slide-id="slide_1"] { flex-direction: row; }');
    expect(result.html).toContain('[data-pepetex-slide-id="slide_2"] { flex-direction: column; }');
  });
});

describe('buildSlideThumbnailDocument', () => {
  it('builds a fixed-size thumbnail render document with restrictive CSP', () => {
    const result = buildSlideThumbnailDocument({
      slide: {
        id: 'slide_1',
        title: 'Board Update',
        html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_1" style="width: 1920px; height: 1080px;"></section>',
        css: '[data-pepetex-slide-id="slide_1"] { background: #fff; }'
      },
      allowedAssetHosts: ['assets.pepetex.internal'],
      assetUrls: {
        hero: 'https://cdn.assets.pepetex.internal/decks/hero.png'
      }
    });

    expect(THUMBNAIL_CONTENT_TYPE).toBe('image/png');
    expect(result.contentType).toBe('text/html');
    expect(result.viewport).toEqual({
      width: 1920,
      height: 1080
    });
    expect(result.csp).toContain("default-src 'none'");
    expect(result.csp).toContain('https://assets.pepetex.internal');
    expect(result.csp).toContain('https://*.assets.pepetex.internal');
    expect(result.csp).toContain('https://cdn.assets.pepetex.internal');
    expect(result.html).toContain('Content-Security-Policy');
    expect(result.html).toContain('Board Update');
    expect(result.html).toContain('data-pepetex-slide-id="slide_1"');
  });

  it('escapes closing style tags inside generated css', () => {
    const result = buildSlideThumbnailDocument({
      slide: {
        id: 'slide_1',
        title: 'Board Update',
        html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_1"></section>',
        css: '.pepetex-slide { color: red; }</style><script>alert(1)</script>'
      }
    });

    expect(result.html).not.toContain('</style><script>');
    expect(result.html).toContain('<\\/style><script>alert(1)</script>');
  });

  it('injects trusted custom font faces into thumbnail documents', () => {
    const result = buildSlideThumbnailDocument({
      slide: {
        id: 'slide_1',
        title: 'Brand Font',
        html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_1"></section>',
        css: '.pepetex-slide { font-family: "Brand Sans"; }'
      },
      fontFaces: [{
        id: 'font_1',
        fontFamily: 'Brand Sans',
        mimeType: 'font/woff2',
        dataUrl: 'data:font/woff2;base64,AAE=',
        fontWeight: 700
      }]
    });

    expect(result.html).toContain('@font-face');
    expect(result.html).toContain('font-family:"Brand Sans"');
    expect(result.html).toContain('data:font/woff2;base64,AAE=');
    expect(result.csp).toContain('font-src');
    expect(result.csp).toContain('data:');
  });
});

describe('buildPptxExportDocument', () => {
  const slide = {
    id: 'slide_1',
    title: 'Title Slide',
    html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_1" style="width:1920px;height:1080px;position:relative;overflow:hidden;"><h1 data-pepetex-id="el_01" data-pepetex-type="headline">Hello</h1></section>',
    css: '.pepetex-slide { background: #fff; }'
  };

  it('builds a PPTX export HTML document with dom-to-pptx script tag', () => {
    const result = buildPptxExportDocument({
      slides: [slide],
      fileName: 'presentation.pptx',
      domToPptxScriptUrl: 'http://localhost:3000/_pepetex/dom-to-pptx.bundle.js'
    });

    expect(result.contentType).toBe('text/html');
    expect(result.html).toContain('<!doctype html>');
    expect(result.html).toContain('dom-to-pptx.bundle.js');
    expect(result.html).toContain('pepetex-slide');
    expect(result.html).toContain('pepetexExportReady');
    expect(result.html).toContain('pepetexRunExport');
    expect(result.html).toContain('getDomToPptxApi');
    expect(result.html).toContain("typeof api.exportToPptx === 'function'");
    expect(result.html).toContain('dom-to-pptx browser API did not load on the export page.');
    expect(result.html).toContain('LAYOUT_16x9');
    expect(result.html).toContain('skipDownload: true');
    expect(result.html).toContain('svgAsVector: true');
  });

  it('includes CSP with script-src self and a nonce for the inline export bootstrap', () => {
    const result = buildPptxExportDocument({
      slides: [slide],
      fileName: 'presentation.pptx',
      domToPptxScriptUrl: '/_pepetex/dom-to-pptx.bundle.js'
    });

    expect(result.csp).toContain("default-src 'none'");
    expect(result.csp).toContain("script-src 'self'");
    expect(result.csp).toContain("'nonce-");
    // style-src now also allows 'self' for the /fonts/inter/inter.css stylesheet.
    expect(result.csp).toContain("style-src 'self' 'unsafe-inline'");
    const nonceMatch = result.csp.match(/'nonce-([^']+)'/);
    expect(nonceMatch?.[1]).toBeTruthy();
    expect(result.html).toContain(`nonce="${nonceMatch?.[1]}"`);
    const scriptDirective = result.csp.split('; ').find((entry) => entry.startsWith('script-src'));
    expect(scriptDirective).not.toContain("'unsafe-inline'");
  });

  it('escapes the file name in the export call', () => {
    const result = buildPptxExportDocument({
      slides: [slide],
      fileName: '<script>alert(1)</script>.pptx',
      domToPptxScriptUrl: '/_pepetex/dom-to-pptx.bundle.js'
    });

    // The fileName is JSON-encoded in the inline script, so the raw HTML should not appear
    expect(result.html).not.toContain('<script>alert(1)</script>');
  });

  it('renders multiple slides', () => {
    const slide2 = { ...slide, id: 'slide_2', title: 'Slide 2' };
    const result = buildPptxExportDocument({
      slides: [slide, slide2],
      fileName: 'deck.pptx',
      domToPptxScriptUrl: '/_pepetex/dom-to-pptx.bundle.js'
    });

    const matchCount = (result.html.match(/pepetex-slide/g) ?? []).length;
    // Should appear at least twice (once per slide's html)
    expect(matchCount).toBeGreaterThanOrEqual(2);
  });

  it('passes custom font faces to dom-to-pptx manual font embedding', () => {
    const result = buildPptxExportDocument({
      slides: [slide],
      fileName: 'deck.pptx',
      domToPptxScriptUrl: '/_pepetex/dom-to-pptx.bundle.js',
      fontFaces: [{
        fontFamily: 'Brand Sans',
        mimeType: 'font/woff',
        dataUrl: 'data:font/woff;base64,AAE=',
        fontWeight: 700
      }]
    });

    expect(result.html).toContain('@font-face');
    expect(result.html).toContain('font-family:"Brand Sans"');
    expect(result.html).toContain('var _fonts = [{"name":"Brand Sans","url":"data:font/woff;base64,AAE=#.woff"}]');
    expect(result.html).toContain('fonts: _fonts');
  });

  it('adds font-family aliases for separate uploaded font files', () => {
    const result = buildPptxExportDocument({
      slides: [slide],
      fileName: 'deck.pptx',
      domToPptxScriptUrl: '/_pepetex/dom-to-pptx.bundle.js',
      fontFaces: [{
        fontFamily: 'Brand-Bold',
        fontAliases: ['Brand Display Bold'],
        mimeType: 'font/ttf',
        dataUrl: 'data:font/ttf;base64,AAE=',
        fontWeight: 700
      }]
    });

    expect(result.html).toContain('font-family:"Brand-Bold"');
    expect(result.html).toContain('font-family:"BrandBold"');
    expect(result.html).toContain('font-family:"Brand Display Bold"');
    expect(result.html).toContain('"name":"BrandBold","url":"data:font/ttf;base64,AAE=#.ttf"');
    expect(result.html).toContain('el.style.fontWeight = \'400\'');
  });

  it('does not pass woff2 fonts to dom-to-pptx manual embedding', () => {
    const result = buildPptxExportDocument({
      slides: [slide],
      fileName: 'deck.pptx',
      domToPptxScriptUrl: '/_pepetex/dom-to-pptx.bundle.js',
      fontFaces: [{
        fontFamily: 'Brand Sans',
        mimeType: 'font/woff2',
        dataUrl: 'data:font/woff2;base64,AAE=',
        fontWeight: 700
      }]
    });

    expect(result.html).toContain('@font-face');
    expect(result.html).toContain('font-family:"Brand Sans"');
    expect(result.html).toContain('var _fonts = []');
  });
});

describe('buildPdfExportDocument', () => {
  it('injects custom font faces into PDF render documents', () => {
    const result = buildPdfExportDocument({
      slides: [{
        id: 'slide_1',
        title: 'Title Slide',
        html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_1"></section>',
        css: '.pepetex-slide { font-family: "Brand Sans"; }'
      }],
      fileName: 'deck.pdf',
      fontFaces: [{
        fontFamily: 'Brand Sans',
        mimeType: 'font/woff2',
        dataUrl: 'data:font/woff2;base64,AAE='
      }]
    });

    expect(result.html).toContain('@font-face');
    expect(result.html).toContain('font-family:"Brand Sans"');
  });
});

describe('runExportDryRun', () => {
  it('returns ok for a valid deck', () => {
    const validDeck = {
      title: 'Test Deck',
      language: 'en',
      aspectRatio: '16:9',
      canvas: { width: 1920, height: 1080 },
      slides: [
        {
          id: 'slide_1',
          title: 'Title Slide',
          html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_1" style="position:relative;width:1920px;height:1080px;overflow:hidden;background:#fff;"><h1 data-pepetex-id="el_01" data-pepetex-type="headline">Hello</h1></section>',
          css: '',
          assets: [],
          charts: []
        }
      ]
    };

    const result = runExportDryRun(validDeck);
    expect(result.slideCount).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('returns errors for an invalid deck', () => {
    const invalidDeck = {
      title: 'Bad Deck',
      language: 'en',
      aspectRatio: '16:9',
      canvas: { width: 1920, height: 1080 },
      slides: [
        {
          id: 'slide_1',
          title: 'Bad Slide',
          html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_1" style="position:relative;width:1920px;height:1080px;overflow:hidden;"><script>alert(1)</script></section>',
          css: '',
          assets: [],
          charts: []
        }
      ]
    };

    const result = runExportDryRun(invalidDeck);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns slideCount 0 for null deck', () => {
    const result = runExportDryRun(null);
    expect(result.slideCount).toBe(0);
  });
});

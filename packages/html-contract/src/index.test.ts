import { describe, expect, it } from 'vitest';

import {
  SLIDE_CANVAS,
  isAllowedElementType,
  resolveAssetUrl,
  validateGeneratedDeckContract,
  validateGeneratedDeckSchema,
  validateSlide,
  replaceSlideElementHtml,
  updateSlideElementAttributes,
  updateSlideElementStyle,
  updateSlideTextElement
} from './index';

const allowedAssetHosts = ['assets.pepetex.test'];
const assetUrls = {
  'asset-1': 'https://assets.pepetex.test/assets/asset-1.png',
  'asset-2': 'https://assets.pepetex.test/assets/asset-2.webp'
};

describe('@pepetex/html-contract', () => {
  it('keeps the required slide constants', () => {
    expect(SLIDE_CANVAS).toEqual({ width: 1920, height: 1080 });
    expect(isAllowedElementType('headline')).toBe(true);
    expect(isAllowedElementType('script')).toBe(false);
  });

  it('validates generated deck schema shape', () => {
    const result = validateGeneratedDeckSchema({
      title: 'Quarterly Review',
      language: 'en',
      aspectRatio: '4:3',
      canvas: {
        width: 1280,
        height: 720
      },
      slides: [
        {
          id: 'slide-1',
          title: 'Overview',
          html: '<section></section>',
          css: '',
          assets: [],
          charts: []
        }
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain('INVALID_CANVAS_SIZE');
    expect(result.errors.map((error) => error.path)).toContain('deck.aspectRatio');
  });

  it('rejects invalid chart shells in generated deck schema', () => {
    const result = validateGeneratedDeckSchema({
      title: 'Chart Deck',
      language: 'en',
      aspectRatio: '16:9',
      canvas: {
        width: 1920,
        height: 1080
      },
      slides: [
        {
          id: 'slide-1',
          title: 'Empty Chart',
          html: `
            <section class="pepetex-slide" data-pepetex-slide-id="slide-1">
              <h1 data-pepetex-id="title" data-pepetex-type="headline">Empty Chart</h1>
              <div data-pepetex-id="chart-1" data-pepetex-type="chart" data-pepetex-chart-id="chart-1"></div>
            </section>
          `,
          css: '',
          assets: [],
          charts: [
            {
              id: 'chart-1',
              kind: 'bar',
              categories: [],
              series: []
            }
          ]
        }
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.path)).toEqual(
      expect.arrayContaining([
        'deck.slides[0].charts[0].categories',
        'deck.slides[0].charts[0].series'
      ])
    );
  });

  it('rejects chart data and chart containers that do not match', () => {
    const missingContainer = validateGeneratedDeckSchema({
      title: 'Chart Deck',
      language: 'en',
      aspectRatio: '16:9',
      canvas: {
        width: 1920,
        height: 1080
      },
      slides: [
        {
          id: 'slide-1',
          title: 'Chart',
          html: `
            <section class="pepetex-slide" data-pepetex-slide-id="slide-1">
              <h1 data-pepetex-id="title" data-pepetex-type="headline">Chart</h1>
            </section>
          `,
          css: '',
          assets: [],
          charts: [
            {
              id: 'chart-1',
              kind: 'line',
              categories: ['Jan', 'Feb'],
              series: [{ name: 'Revenue', values: [10, 12] }]
            }
          ]
        }
      ]
    });

    expect(missingContainer.ok).toBe(false);
    expect(missingContainer.errors.map((error) => error.message)).toContain(
      'Chart "chart-1" has structured data but no matching chart container in slide HTML.'
    );

    const missingData = validateGeneratedDeckSchema({
      title: 'Chart Deck',
      language: 'en',
      aspectRatio: '16:9',
      canvas: {
        width: 1920,
        height: 1080
      },
      slides: [
        {
          id: 'slide-1',
          title: 'Chart',
          html: `
            <section class="pepetex-slide" data-pepetex-slide-id="slide-1">
              <h1 data-pepetex-id="title" data-pepetex-type="headline">Chart</h1>
              <div data-pepetex-id="chart-1" data-pepetex-type="chart" data-pepetex-chart-id="chart-1"></div>
            </section>
          `,
          css: '',
          assets: [],
          charts: []
        }
      ]
    });

    expect(missingData.ok).toBe(false);
    expect(missingData.errors.map((error) => error.message)).toContain(
      'Chart container "chart-1" has no matching structured chart data.'
    );
  });

  it('accepts valid generated chart data for supported chart kinds', () => {
    const charts = [
      { id: 'bar-chart', kind: 'bar', categories: ['A', 'B'], series: [{ name: 'Value', values: [1, 2] }] },
      { id: 'line-chart', kind: 'line', categories: ['Jan', 'Feb'], series: [{ name: 'Revenue', values: [10, 12] }] },
      { id: 'area-chart', kind: 'area', categories: ['Jan', 'Feb'], series: [{ name: 'MAU', values: [98, 102] }] },
      { id: 'donut-chart', kind: 'donut', categories: ['Mobile', 'Broadband'], series: [{ name: 'Share', values: [58, 22] }] },
      { id: 'scatter-chart', kind: 'scatter', categories: ['Java', 'Sumatra'], series: [{ name: 'NPS', values: [67, 61] }] }
    ];

    const result = validateGeneratedDeckSchema({
      title: 'Chart Deck',
      language: 'en',
      aspectRatio: '16:9',
      canvas: {
        width: 1920,
        height: 1080
      },
      slides: [
        {
          id: 'slide-1',
          title: 'Charts',
          html: `
            <section class="pepetex-slide" data-pepetex-slide-id="slide-1">
              <h1 data-pepetex-id="title" data-pepetex-type="headline">Charts</h1>
              ${charts.map((chart) => `<div data-pepetex-id="${chart.id}" data-pepetex-type="chart" data-pepetex-chart-id="${chart.id}"></div>`).join('')}
            </section>
          `,
          css: '',
          assets: [],
          charts
        }
      ]
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('validates and normalizes a valid slide contract', () => {
    const result = validateSlide({
      slideId: 'slide-1',
      html: `
        <section
          class="pepetex-slide"
          data-pepetex-slide-id="slide-1"
          style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
        >
          <h1 data-pepetex-id="el-title" data-pepetex-type="headline">Q3 Plan</h1>
          <img
            data-pepetex-id="el-image"
            data-pepetex-type="image"
            src="pepetex://asset/asset-1"
            alt="Hero"
          >
        </section>
      `,
      css: `
        .pepetex-slide [data-pepetex-type="headline"] {
          font-size: 48px;
          color: #111111;
        }

        .pepetex-slide img {
          width: 320px;
          height: 180px;
          object-fit: cover;
        }
      `,
      assetUrls,
      allowedAssetHosts
    });

    expect(result.ok).toBe(true);
    expect(result.severity).toBe('ok');
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.elementIndex).toHaveLength(2);
    expect(result.normalizedHtml).toContain(assetUrls['asset-1']);
  });

  it('allows PepeteX asset ids to resolve to trusted data images', () => {
    const dataImage = 'data:image/png;base64,iVBORw0KGgo=';
    const result = validateSlide({
      slideId: 'slide-logo',
      html: `
        <section
          class="pepetex-slide"
          data-pepetex-slide-id="slide-logo"
          style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
        >
          <img
            data-pepetex-id="brand-logo"
            data-pepetex-type="logo"
            src="pepetex://asset/logo-asset"
            alt="Brand logo"
          >
        </section>
      `,
      css: '.pepetex-slide img { width: 360px; height: auto; }',
      assetUrls: { 'logo-asset': dataImage }
    });

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.normalizedHtml).toContain(dataImage);
  });

  it('allows safe presentation layout CSS emitted by deck generation models', () => {
    const result = validateSlide({
      slideId: 'slide-layout-css',
      html: `
        <section
          class="pepetex-slide"
          data-pepetex-slide-id="slide-layout-css"
          style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
        >
          <div data-pepetex-id="layout-card" data-pepetex-type="card">Safe layout CSS</div>
        </section>
      `,
      css: `
        .pepetex-slide,
        .pepetex-slide * {
          box-sizing: border-box;
        }

        .pepetex-slide [data-pepetex-type="card"] {
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          flex-basis: 420px;
          align-self: stretch;
          row-gap: 18px;
          border-left: 6px solid #0f766e;
          background-size: cover;
          list-style: none;
          list-style-position: inside;
        }
      `
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('normalizes common AI element type aliases instead of rejecting otherwise valid slides', () => {
    const result = validateSlide({
      slideId: 'slide-type-aliases',
      html: `
        <section
          class="pepetex-slide"
          data-pepetex-slide-id="slide-type-aliases"
          style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
        >
          <div data-pepetex-id="eyebrow" data-pepetex-type="label">AI label</div>
          <h2 data-pepetex-id="subtitle" data-pepetex-type="subtitle">AI subtitle</h2>
          <p data-pepetex-id="copy" data-pepetex-type="text">AI body copy</p>
        </section>
      `,
      css: '.pepetex-slide { font-size: 24px; color: #111111; }'
    });

    expect(result.ok).toBe(true);
    expect(result.severity).toBe('warning');
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain('SANITIZED_HTML');
    expect(result.normalizedHtml).toContain('data-pepetex-type="body"');
  });

  it('rejects radial-gradient while accepting other modern visual CSS', () => {
    const result = validateSlide({
      slideId: 'slide-modern-css',
      html: `
        <section
          class="pepetex-slide"
          data-pepetex-slide-id="slide-modern-css"
          style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
        >
          <h1 data-pepetex-id="title" data-pepetex-type="headline">Modern CSS</h1>
          <div class="halo" data-pepetex-id="halo" data-pepetex-type="decorative"></div>
        </section>
      `,
      css: `
        .halo::before {
          content: "";
          position: absolute;
          margin-top: 20px;
          margin-right: 12px;
          margin-bottom: 20px;
          margin-left: 12px;
          padding-left: 8px;
          background: radial-gradient(circle, rgba(59,130,246,0.3) 0%, rgba(59,130,246,0) 70%);
        }

        h1 {
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-image: linear-gradient(90deg, #2563eb, #7c3aed);
        }
      `
    });

    // radial-gradient is now a FORBIDDEN_CSS error (dom-to-pptx cannot render
    // radial gradients natively; the PPTX export silently diverges from the
    // preview). Linear-gradient is still allowed.
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['FORBIDDEN_CSS'])
    );
    expect(
      result.errors.find((error) => error.message.includes('radial-gradient'))
    ).toBeDefined();
  });

  it('rejects backdrop-filter and mix-blend-mode as FORBIDDEN_CSS', () => {
    const result = validateSlide({
      slideId: 'slide-blend',
      html: `
        <section
          class="pepetex-slide"
          data-pepetex-slide-id="slide-blend"
          style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
        >
          <h1 data-pepetex-id="title" data-pepetex-type="headline">Blends</h1>
          <div data-pepetex-id="overlay" data-pepetex-type="decorative"></div>
        </section>
      `,
      css: `
        .pepetex-slide [data-pepetex-type="decorative"] {
          backdrop-filter: blur(8px);
          mix-blend-mode: multiply;
        }
      `
    });

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['FORBIDDEN_CSS'])
    );
    expect(result.errors.find((error) => error.path === 'css.backdrop-filter')).toBeDefined();
    expect(result.errors.find((error) => error.path === 'css.mix-blend-mode')).toBeDefined();
  });

  it('rejects clip-path / mask / filter as FORBIDDEN_CSS', () => {
    const result = validateSlide({
      slideId: 'slide-clip',
      html: `
        <section
          class="pepetex-slide"
          data-pepetex-slide-id="slide-clip"
          style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
        >
          <h1 data-pepetex-id="title" data-pepetex-type="headline">Clip</h1>
          <div data-pepetex-id="frame" data-pepetex-type="decorative"></div>
        </section>
      `,
      css: `
        .pepetex-slide [data-pepetex-type="decorative"] {
          clip-path: polygon(0 0, 100% 0, 100% 80%, 0 100%);
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3));
        }
      `
    });

    expect(result.ok).toBe(false);
    expect(result.errors.find((error) => error.path === 'css.clip-path')).toBeDefined();
    expect(result.errors.find((error) => error.path === 'css.filter')).toBeDefined();
  });

  it('rejects conic-gradient as FORBIDDEN_CSS', () => {
    const result = validateSlide({
      slideId: 'slide-conic',
      html: `
        <section
          class="pepetex-slide"
          data-pepetex-slide-id="slide-conic"
          style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
        >
          <h1 data-pepetex-id="title" data-pepetex-type="headline">Conic</h1>
          <div data-pepetex-id="ring" data-pepetex-type="decorative"></div>
        </section>
      `,
      css: `
        .pepetex-slide [data-pepetex-type="decorative"] {
          background: conic-gradient(from 0deg, #2563eb, #7c3aed, #2563eb);
        }
      `
    });

    expect(result.ok).toBe(false);
    expect(result.errors.find((error) => error.message.includes('conic-gradient'))).toBeDefined();
  });

  it('normalizes dom-to-pptx limited CSS without blocking deck generation', () => {
    const result = validateSlide({
      slideId: 'slide-dom-to-pptx-css',
      html: `
        <section
          class="pepetex-slide"
          data-pepetex-slide-id="slide-dom-to-pptx-css"
          style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
        >
          <h1 data-pepetex-id="title" data-pepetex-type="headline">Export-safe depth</h1>
          <div data-pepetex-id="card" data-pepetex-type="card">Static card</div>
        </section>
      `,
      css: `
        .pepetex-slide [data-pepetex-type="headline"] {
          text-shadow: 0 3px 12px rgba(15, 23, 42, 0.3);
          transform: rotate(-2deg);
          transition: transform 180ms ease;
        }

        .pepetex-slide [data-pepetex-type="card"] {
          animation: pulse 1s ease-in-out infinite;
        }
      `
    });

    expect(result.ok).toBe(true);
    expect(result.severity).toBe('warning');
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.path)).toEqual(
      expect.arrayContaining(['css.text-shadow', 'css.transition', 'css.animation'])
    );
    expect(result.normalizedCss).toContain('text-shadow');
    expect(result.normalizedCss).toContain('transform: rotate(-2deg)');
    expect(result.normalizedCss).not.toContain('transition');
    expect(result.normalizedCss).not.toContain('animation');
  });

  it('rejects non-rotate transforms (translate/scale/skew/matrix) as forbidden CSS', () => {
    const result = validateSlide({
      slideId: 'slide-bad-transform',
      html: `
        <section
          class="pepetex-slide"
          data-pepetex-slide-id="slide-bad-transform"
          style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
        >
          <h1 data-pepetex-id="title" data-pepetex-type="headline">Bad transform</h1>
          <div data-pepetex-id="card" data-pepetex-type="card">Card</div>
        </section>
      `,
      css: `
        .pepetex-slide [data-pepetex-type="card"] {
          transform: translateY(-8px) scale(1.02);
        }
      `
    });

    expect(result.ok).toBe(false);
    expect(result.severity).toBe('repair_required');
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['FORBIDDEN_CSS'])
    );
    expect(
      result.errors.find((error) => error.path === 'css.transform')
    ).toBeDefined();
  });

  it('updates editable slide text by data-pepetex-id', () => {
    const result = updateSlideTextElement({
      elementId: 'headline-1',
      text: 'Updated headline',
      html: `
        <section class="pepetex-slide" data-pepetex-slide-id="slide-1">
          <h1 data-pepetex-id="headline-1" data-pepetex-type="headline">Old headline</h1>
          <p data-pepetex-id="body-1" data-pepetex-type="body">Body copy</p>
        </section>
      `
    });

    expect(result.html).toContain('Updated headline');
    expect(result.html).not.toContain('Old headline');
    expect(result.title).toBe('Updated headline');
  });

  it('rejects update_text for non-editable visual elements', () => {
    expect(() =>
      updateSlideTextElement({
        elementId: 'card-1',
        text: 'Updated card',
        html: `
          <section class="pepetex-slide" data-pepetex-slide-id="slide-1">
            <div data-pepetex-id="card-1" data-pepetex-type="card">Metric card</div>
          </section>
        `
      })
    ).toThrow('cannot be updated with update_text');
  });

  it('adds scoped CSS overrides for targeted element style patches', () => {
    const result = updateSlideElementStyle({
      slideId: 'slide-1',
      elementId: 'card-1',
      html: `
        <section class="pepetex-slide" data-pepetex-slide-id="slide-1">
          <div data-pepetex-id="card-1" data-pepetex-type="card">Metric card</div>
        </section>
      `,
      css: '.pepetex-slide { color: #111111; }',
      styles: {
        color: '#ef4444',
        'background-color': '#ffffff'
      }
    });

    expect(result.css).toContain('[data-pepetex-slide-id="slide-1"] [data-pepetex-id="card-1"]');
    expect(result.css).toContain('color: #ef4444');
    expect(result.css).toContain('background-color: #ffffff');
  });

  it('allows targeted style patches on SVG shape elements', () => {
    const result = updateSlideElementStyle({
      slideId: 'slide-1',
      elementId: 'shape-1',
      html: `
        <section class="pepetex-slide" data-pepetex-slide-id="slide-1">
          <h1 data-pepetex-id="headline-1" data-pepetex-type="headline">Title</h1>
          <svg data-pepetex-id="shape-1" data-pepetex-type="shape" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40"></circle>
          </svg>
        </section>
      `,
      css: '',
      styles: {
        fill: '#ef4444',
        stroke: '#111111'
      }
    });

    expect(result.css).toContain('fill: #ef4444');
    expect(result.css).toContain('stroke: #111111');
  });

  it('rejects forbidden style properties for targeted style patches', () => {
    expect(() =>
      updateSlideElementStyle({
        slideId: 'slide-1',
        elementId: 'card-1',
        html: `
          <section class="pepetex-slide" data-pepetex-slide-id="slide-1">
            <div data-pepetex-id="card-1" data-pepetex-type="card">Metric card</div>
          </section>
        `,
        css: '',
        styles: {
          position: 'fixed'
        }
      })
    ).toThrow('not allowed');
  });

  it('updates safe element attributes and rejects unsafe attributes', () => {
    const result = updateSlideElementAttributes({
      elementId: 'hero-image',
      html: `
        <section class="pepetex-slide" data-pepetex-slide-id="slide-1">
          <img data-pepetex-id="hero-image" data-pepetex-type="image" alt="Old">
        </section>
      `,
      attributes: {
        alt: 'Updated image description',
        title: 'Hero image'
      }
    });

    expect(result.html).toContain('alt="Updated image description"');
    expect(result.html).toContain('title="Hero image"');
    expect(() =>
      updateSlideElementAttributes({
        elementId: 'hero-image',
        html: result.html,
        attributes: { onclick: 'alert(1)' }
      })
    ).toThrow('not allowed');
  });

  it('replaces one selected element subtree while preserving id and type', () => {
    const result = replaceSlideElementHtml({
      slideId: 'slide-1',
      elementId: 'body-1',
      html: `
        <section class="pepetex-slide" data-pepetex-slide-id="slide-1">
          <h1 data-pepetex-id="headline-1" data-pepetex-type="headline">Title</h1>
          <p data-pepetex-id="body-1" data-pepetex-type="body">Old body</p>
        </section>
      `,
      css: '.pepetex-slide { color: #111111; }',
      replacementHtml: '<p data-pepetex-id="body-1" data-pepetex-type="body">Updated body</p>'
    });

    expect(result.html).toContain('Updated body');
    expect(result.html).not.toContain('Old body');
    expect(result.html).toContain('data-pepetex-id="body-1"');
    expect(result.html).toContain('data-pepetex-type="body"');
  });

  it('rejects element subtree replacements that change the selected id', () => {
    expect(() =>
      replaceSlideElementHtml({
        slideId: 'slide-1',
        elementId: 'body-1',
        html: `
          <section class="pepetex-slide" data-pepetex-slide-id="slide-1">
            <h1 data-pepetex-id="headline-1" data-pepetex-type="headline">Title</h1>
            <p data-pepetex-id="body-1" data-pepetex-type="body">Old body</p>
          </section>
        `,
        css: '',
        replacementHtml: '<p data-pepetex-id="other-body" data-pepetex-type="body">Updated body</p>'
      })
    ).toThrow('preserve data-pepetex-id');
  });

  it('warns when normalizing conditional tags and attributes', () => {
    const result = validateSlide({
      slideId: 'slide-2',
      html: `
        <section
          class="pepetex-slide"
          data-pepetex-slide-id="slide-2"
          style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
        >
          <a
            href="https://assets.pepetex.test/assets/link"
            data-pepetex-id="el-cta"
            data-pepetex-type="cta"
          >
            Learn more
          </a>
          <button
            type="submit"
            form="ignored"
            data-pepetex-id="el-button"
            data-pepetex-type="cta"
          >
            Contact sales
          </button>
        </section>
      `,
      css: '.pepetex-slide a { color: #333333; }',
      allowedAssetHosts
    });

    expect(result.ok).toBe(true);
    expect(result.severity).toBe('warning');
    expect(result.warnings.map((warning) => warning.code)).toContain('CONDITIONAL_TAG_NORMALIZED');
    expect(result.normalizedHtml).not.toContain('href=');
    expect(result.normalizedHtml).not.toContain('type="submit"');
    expect(result.normalizedHtml).not.toContain('form="ignored"');
  });

  it('blocks forbidden tags, handlers, and external asset URLs', () => {
    const result = validateSlide({
      slideId: 'slide-3',
      html: `
        <section
          class="pepetex-slide"
          data-pepetex-slide-id="slide-3"
          style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
        >
          <script>alert('x')</script>
          <div data-pepetex-id="el-1" data-pepetex-type="body" onclick="alert('x')">Unsafe</div>
          <img data-pepetex-id="el-2" data-pepetex-type="image" src="http://evil.test/hero.png">
        </section>
      `,
      css: '.pepetex-slide div { color: #111111; }'
    });

    expect(result.ok).toBe(false);
    expect(result.severity).toBe('blocked');
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['FORBIDDEN_TAG', 'SCRIPT_DETECTED', 'FORBIDDEN_URL'])
    );
  });

  it('reports duplicate ids, invalid types, and forbidden css', () => {
    const result = validateSlide({
      slideId: 'slide-4',
      html: `
        <section
          class="pepetex-slide"
          data-pepetex-slide-id="slide-4"
          style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
        >
          <div data-pepetex-id="el-1" data-pepetex-type="headline">One</div>
          <div data-pepetex-id="el-1" data-pepetex-type="headline">Two</div>
          <div data-pepetex-id="el-3" data-pepetex-type="unknown">Three</div>
          <div data-pepetex-type="body">Missing id</div>
        </section>
      `,
      css: `
        .card { font-size: 2vw; }
        .pepetex-slide .box {
          background-image: url(https://external.example.com/bg.png);
        }
      `,
      allowedAssetHosts
    });

    expect(result.ok).toBe(false);
    expect(result.severity).toBe('blocked');
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining([
        'DUPLICATE_ELEMENT_ID',
        'SCHEMA_INVALID',
        'MISSING_ELEMENT_ID',
        'FORBIDDEN_CSS',
        'EXTERNAL_REQUEST_DETECTED'
      ])
    );
  });

  it('requires at least one meaningful stable targetable element', () => {
    // headline/body/cta still gate on having visible text content; an empty
    // headline plus an untagged plain <h1> means the slide has zero
    // meaningful comment targets and must be repaired.
    const result = validateSlide({
      slideId: 'slide-no-targets',
      html: `
        <section
          class="pepetex-slide"
          data-pepetex-slide-id="slide-no-targets"
          style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
        >
          <div data-pepetex-id="hl-1" data-pepetex-type="headline"></div>
          <h1>Untargeted headline</h1>
        </section>
      `,
      css: '.pepetex-slide h1 { font-size: 64px; }'
    });

    expect(result.ok).toBe(false);
    expect(result.severity).toBe('repair_required');
    expect(result.errors.map((error) => error.code)).toContain('MISSING_TARGETABLE_ELEMENT');
  });

  it('carries duplicate element detection across deck slides', () => {
    const results = validateGeneratedDeckContract({
      deck: {
        title: 'Deck',
        language: 'en',
        aspectRatio: '16:9',
        canvas: {
          width: 1920,
          height: 1080
        },
        slides: [
          {
            id: 'slide-1',
            title: 'One',
            html: `
              <section
                class="pepetex-slide"
                data-pepetex-slide-id="slide-1"
                style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
              >
                <h1 data-pepetex-id="el-shared" data-pepetex-type="headline">First</h1>
              </section>
            `,
            css: '.pepetex-slide h1 { font-size: 48px; }',
            assets: [],
            charts: []
          },
          {
            id: 'slide-2',
            title: 'Two',
            html: `
              <section
                class="pepetex-slide"
                data-pepetex-slide-id="slide-2"
                style="position: relative; width: 1920px; height: 1080px; overflow: hidden"
              >
                <h2 data-pepetex-id="el-shared" data-pepetex-type="headline">Second</h2>
              </section>
            `,
            css: '.pepetex-slide h2 { font-size: 40px; }',
            assets: [],
            charts: []
          }
        ]
      }
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.errors.map((error) => error.code)).toContain('DUPLICATE_ELEMENT_ID');
  });

  it('resolves PepeteX-managed asset URLs only', () => {
    expect(
      resolveAssetUrl('pepetex://asset/asset-2', {
        assetUrls,
        allowedAssetHosts
      })
    ).toEqual({
      ok: true,
      value: assetUrls['asset-2']
    });

    const failure = resolveAssetUrl('https://external.example.com/image.png', {
      allowedAssetHosts
    });

    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.error.code).toBe('EXTERNAL_REQUEST_DETECTED');
    }
  });
});

import { describe, expect, it } from 'vitest';

import {
  DesignSystemValidationError,
  normalizeDesignSystemDocument,
  repairDesignSystemDocument,
  summarizeDesignSystemDocument
} from './index';

describe('@pepetex/design-systems', () => {
  it('normalizes a valid design-system document', () => {
    const document = normalizeDesignSystemDocument({
      tokens: {
        colors: [
          {
            id: 'brand-primary',
            label: 'Brand Primary',
            value: '#0f172a',
            usage: 'Primary headings'
          }
        ],
        typography: [
          {
            id: 'heading-xl',
            label: 'Heading XL',
            fontFamily: 'IBM Plex Sans',
            fontSizePx: 40,
            fontWeight: 700,
            lineHeight: 1.1
          }
        ],
        spacing: [
          {
            id: 'space-24',
            label: 'Space 24',
            valuePx: 24
          }
        ]
      },
      components: [
        {
          id: 'hero-banner',
          name: 'Hero Banner',
          kind: 'hero',
          description: 'Large opener block.',
          html: '<section class="hero-banner" data-pepetex-id="hero-banner" data-pepetex-type="group"><h1>Hero</h1></section>',
          css: '.hero-banner { display: grid; gap: 32px; padding: 64px; background: #0f172a; border-radius: 24px; } .hero-banner h1 { font-size: 72px; font-weight: 800; line-height: 1.02; color: #ffffff; }'
        }
      ],
      exampleSlides: [
        {
          id: 'quarterly-opener',
          name: 'Quarterly opener',
          purpose: 'Title slide for quarterly reviews.',
          html: '<section class="pepetex-slide" data-pepetex-slide-id="quarterly-opener" data-pepetex-width="1920" data-pepetex-height="1080"><h1 data-pepetex-id="headline" data-pepetex-type="headline">Q2 Review</h1></section>',
          css: '.pepetex-slide { position: relative; width: 1920px; height: 1080px; overflow: hidden; display: grid; place-items: center; padding: 96px; background: #ffffff; } .pepetex-slide h1 { font-size: 96px; font-weight: 800; line-height: 1; color: #0f172a; }'
        }
      ]
    });

    expect(document.tokens.colors[0]).toMatchObject({
      id: 'brand-primary',
      value: '#0F172A'
    });
    expect(summarizeDesignSystemDocument(document)).toEqual({
      colorCount: 1,
      typographyCount: 1,
      spacingCount: 1,
      componentCount: 1,
      exampleSlideCount: 1,
      archetypeCount: 0,
      ruleCount: 0
    });
  });

  it('rejects duplicate component ids', () => {
    expect(() =>
      normalizeDesignSystemDocument({
        tokens: {
          colors: [],
          typography: [],
          spacing: []
        },
        components: [
          {
            id: 'card',
            name: 'Card A',
            kind: 'card',
            html: '<div class="card" data-pepetex-id="card" data-pepetex-type="card">Card A</div>',
            css: '.card { display: grid; gap: 16px; padding: 32px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 20px; } .card { font-size: 24px; font-weight: 700; line-height: 1.2; }'
          },
          {
            id: 'card',
            name: 'Card B',
            kind: 'card',
            html: '<div class="card" data-pepetex-id="card" data-pepetex-type="card">Card B</div>',
            css: '.card { display: grid; gap: 16px; padding: 32px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 20px; } .card { font-size: 24px; font-weight: 700; line-height: 1.2; }'
          }
        ],
        exampleSlides: []
      })
    ).toThrowError(new DesignSystemValidationError('Design system component ids must be unique.'));
  });

  it('rejects invalid color tokens', () => {
    expect(() =>
      normalizeDesignSystemDocument({
        tokens: {
          colors: [
            {
              id: 'brand-primary',
              label: 'Brand Primary',
              value: 'navy'
            }
          ],
          typography: [],
          spacing: []
        },
        components: [],
        exampleSlides: []
      })
    ).toThrowError(
      new DesignSystemValidationError('Design system color token #1 value must be a hex color.')
    );
  });

  it('rejects placeholder component css and incomplete example slide canvases', () => {
    expect(() =>
      normalizeDesignSystemDocument({
        tokens: { colors: [], typography: [], spacing: [] },
        components: [
          {
            id: 'card',
            name: 'Card',
            kind: 'card',
            html: '<div data-pepetex-id="card" data-pepetex-type="card">Card</div>',
            css: '.card {}'
          }
        ],
        exampleSlides: []
      })
    ).toThrowError(
      new DesignSystemValidationError('Design system component #1 css must include substantial presentation styling.')
    );

    expect(() =>
      normalizeDesignSystemDocument({
        tokens: { colors: [], typography: [], spacing: [] },
        components: [],
        exampleSlides: [
          {
            id: 'example',
            name: 'Example',
            purpose: 'Incomplete slide.',
            html: '<section><h1>Example</h1></section>',
            css: '.pepetex-slide { display: grid; background: #fff; font-size: 48px; }'
          }
        ]
      })
    ).toThrowError(
      new DesignSystemValidationError('Design system example slide #1 html must include a pepetex-slide root.')
    );
  });

  it('auto-repairs missing component attributes and thin css', () => {
    const result = repairDesignSystemDocument({
      tokens: { colors: [], typography: [], spacing: [] },
      components: [
        {
          id: 'card',
          name: 'Card',
          kind: 'card',
          html: '<div class="card">Card</div>',
          css: '.card {}'
        }
      ],
      exampleSlides: []
    });

    expect(result).not.toBeNull();
    expect(result!.warnings.length).toBeGreaterThan(0);
    expect(result!.document.components[0]!.html).toContain('data-pepetex-id="card"');
    expect(result!.document.components[0]!.html).toContain('data-pepetex-type="card"');
    expect(result!.document.components[0]!.css).toContain('display: flex');
  });

  it('auto-repairs missing example-slide attributes and thin css', () => {
    const result = repairDesignSystemDocument({
      tokens: { colors: [], typography: [], spacing: [] },
      components: [],
      exampleSlides: [
        {
          id: 'title',
          name: 'Title',
          purpose: 'Title slide.',
          html: '<section><h1>Title</h1></section>',
          css: '.slide {}'
        }
      ]
    });

    expect(result).not.toBeNull();
    expect(result!.warnings.length).toBeGreaterThan(0);
    expect(result!.document.exampleSlides[0]!.html).toContain('class="pepetex-slide"');
    expect(result!.document.exampleSlides[0]!.html).toContain('data-pepetex-slide-id="title"');
    expect(result!.document.exampleSlides[0]!.css).toContain('width: 1920px');
  });

  it('returns the document unchanged when it is already valid', () => {
    const input = {
      tokens: {
        colors: [{ id: 'c1', label: 'Red', value: '#ff0000', usage: null }],
        typography: [{ id: 't1', label: 'Heading', fontFamily: 'Inter', fontSizePx: 32, fontWeight: 700, lineHeight: 1.2 }],
        spacing: [{ id: 's1', label: 'Small', valuePx: 8 }]
      },
      components: [
        {
          id: 'hero',
          name: 'Hero',
          kind: 'hero',
          html: '<div data-pepetex-id="hero" data-pepetex-type="hero">Hero</div>',
          css: '.hero { display: flex; font-size: 48px; font-weight: 700; background: #000; border-radius: 8px; }'
        }
      ],
      exampleSlides: [
        {
          id: 'slide-1',
          name: 'Opener',
          purpose: 'Opening slide.',
          html: '<section class="pepetex-slide" data-pepetex-slide-id="slide-1" style="width:1920px;height:1080px;position:relative;overflow:hidden;"><h1>Hello</h1></section>',
          css: '.pepetex-slide { display: grid; font-size: 64px; font-weight: 800; background: #fff; }'
        }
      ]
    };

    const result = repairDesignSystemDocument(input);
    expect(result).not.toBeNull();
    expect(result!.warnings).toHaveLength(0);
    expect(result!.document.components[0]!.html).toBe(input.components[0]!.html);
  });
});

import { describe, expect, it } from 'vitest';

import {
  parsePepeteXAIResult,
  pepeteXDeckSchemaVersion,
  pepeteXPatchSchemaVersion,
  validateGeneratedDeck,
  validatePepeteXAIResult,
  workflowDescriptors
} from './index';

describe('@pepetex/ai', () => {
  it('validates ask-mode results', () => {
    const result = validatePepeteXAIResult({
      mode: 'ask',
      reason: 'missing_audience',
      question: 'Who is the target audience?',
      options: [
        {
          id: 'execs',
          label: 'Executives',
          value: 'executives'
        }
      ],
      allowManualAnswer: true,
      required: true
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('ask');
    }
  });

  it('validates deck generation results', () => {
    const result = validatePepeteXAIResult({
      mode: 'deck',
      schemaVersion: pepeteXDeckSchemaVersion,
      deck: {
        title: 'Q3 Plan',
        language: 'en',
        aspectRatio: '16:9',
        canvas: {
          width: 1920,
          height: 1080
        },
        slides: [
          {
            id: 'slide-1',
            title: 'Overview',
            html: '<section data-pepetex-root="true"></section>',
            css: '.slide {}',
            assets: [
              {
                assetId: 'asset-1',
                role: 'logo',
                required: true
              }
            ],
            charts: [
              {
                id: 'chart-1',
                kind: 'bar',
                categories: ['Q1', 'Q2'],
                series: [
                  {
                    name: 'Revenue',
                    values: [10, 12]
                  }
                ]
              }
            ]
          }
        ]
      },
      assumptions: ['Assumed a two-quarter time horizon.'],
      warnings: [],
      designSystemRulesUsed: ['Use the corporate blue palette.']
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('deck');
      if (result.value.mode === 'deck') {
        expect(result.value.deck.slides).toHaveLength(1);
      }
    }
  });

  it('preserves trusted deck font snapshots during validation', () => {
    const result = validateGeneratedDeck({
      title: 'Brand Deck',
      language: 'en',
      aspectRatio: '16:9',
      canvas: { width: 1920, height: 1080 },
      fonts: [
        {
          id: 'font_1',
          fontFamily: 'Brand Sans',
          mimeType: 'font/woff2',
          dataUrl: 'data:font/woff2;base64,AAE=',
          fontWeight: 700,
          fontStyle: 'normal'
        }
      ],
      slides: [
        {
          id: 'slide-1',
          title: 'Overview',
          html: '<section data-pepetex-root="true"></section>',
          css: '.slide {}',
          assets: [],
          charts: [],
          diagrams: []
        }
      ]
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.fonts?.[0]?.fontFamily).toBe('Brand Sans');
    }
  });

  it('defaults omitted slide assets and charts to empty arrays', () => {
    const result = validatePepeteXAIResult({
      mode: 'deck',
      schemaVersion: pepeteXDeckSchemaVersion,
      deck: {
        title: 'Q3 Plan',
        language: 'en',
        aspectRatio: '16:9',
        canvas: {
          width: 1920,
          height: 1080
        },
        slides: [
          {
            id: 'slide-1',
            title: 'Overview',
            html: '<section data-pepetex-root="true"></section>',
            css: '.slide {}'
          }
        ]
      },
      assumptions: [],
      warnings: [],
      designSystemRulesUsed: []
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.value.mode === 'deck') {
      expect(result.value.deck.slides[0]?.assets).toEqual([]);
      expect(result.value.deck.slides[0]?.charts).toEqual([]);
      expect(result.value.deck.slides[0]?.diagrams).toEqual([]);
    }
  });

  it('defaults omitted deck metadata arrays to empty arrays', () => {
    const result = validatePepeteXAIResult({
      mode: 'deck',
      schemaVersion: pepeteXDeckSchemaVersion,
      deck: {
        title: 'Q3 Plan',
        language: 'en',
        aspectRatio: '16:9',
        canvas: {
          width: 1920,
          height: 1080
        },
        slides: [
          {
            id: 'slide-1',
            title: 'Overview',
            html: '<section data-pepetex-root="true"></section>',
            css: '.slide {}'
          }
        ]
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.value.mode === 'deck') {
      expect(result.value.assumptions).toEqual([]);
      expect(result.value.warnings).toEqual([]);
      expect(result.value.designSystemRulesUsed).toEqual([]);
    }
  });

  it('still rejects malformed slide asset and chart collections', () => {
    const result = validatePepeteXAIResult({
      mode: 'deck',
      schemaVersion: pepeteXDeckSchemaVersion,
      deck: {
        title: 'Q3 Plan',
        language: 'en',
        aspectRatio: '16:9',
        canvas: {
          width: 1920,
          height: 1080
        },
        slides: [
          {
            id: 'slide-1',
            title: 'Overview',
            html: '<section data-pepetex-root="true"></section>',
            css: '.slide {}',
            assets: {},
            charts: []
          }
        ]
      },
      assumptions: [],
      warnings: [],
      designSystemRulesUsed: []
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('result.deck.slides[0].assets must be an array.');
    }
  });

  it('validates deck patch results', () => {
    const result = parsePepeteXAIResult({
      mode: 'deck_patch',
      schemaVersion: pepeteXPatchSchemaVersion,
      patch: {
        operations: [
          {
            op: 'update_text',
            slideId: 'slide-1',
            elementId: 'headline',
            text: 'Sharper value proposition'
          },
          {
            op: 'move_slide',
            slideId: 'slide-2',
            toIndex: 0
          }
        ]
      },
      assumptions: [],
      warnings: ['Data source for one claim should be verified.'],
      userVisibleSummary: 'Updated the headline and moved the summary slide to the front.'
    });

    expect(result.mode).toBe('deck_patch');
    if (result.mode === 'deck_patch') {
      expect(result.patch.operations).toHaveLength(2);
    }
  });

  it('validates hybrid element patch operations with comment ids', () => {
    const result = parsePepeteXAIResult({
      mode: 'deck_patch',
      schemaVersion: pepeteXPatchSchemaVersion,
      patch: {
        operations: [
          {
            op: 'update_element_style',
            slideId: 'slide-1',
            elementId: 'card',
            styles: { color: '#ef4444', 'background-color': '#ffffff' },
            commentIds: ['comment-1']
          },
          {
            op: 'update_element_attributes',
            slideId: 'slide-1',
            elementId: 'hero-image',
            attributes: { alt: 'Updated image description', title: null },
            commentIds: ['comment-2']
          },
          {
            op: 'replace_element_html',
            slideId: 'slide-1',
            elementId: 'body',
            html: '<p data-pepetex-id="body" data-pepetex-type="body">Updated body</p>',
            commentIds: ['comment-3']
          }
        ]
      },
      assumptions: [],
      warnings: [],
      userVisibleSummary: 'Applied scoped element updates.'
    });

    expect(result.mode).toBe('deck_patch');
    if (result.mode === 'deck_patch') {
      expect(result.patch.operations).toEqual([
        expect.objectContaining({
          op: 'update_element_style',
          styles: { color: '#ef4444', 'background-color': '#ffffff' },
          commentIds: ['comment-1']
        }),
        expect.objectContaining({
          op: 'update_element_attributes',
          attributes: { alt: 'Updated image description', title: null },
          commentIds: ['comment-2']
        }),
        expect.objectContaining({
          op: 'replace_element_html',
          commentIds: ['comment-3']
        })
      ]);
    }
  });

  it('defaults omitted deck patch metadata arrays to empty arrays', () => {
    const result = parsePepeteXAIResult({
      mode: 'deck_patch',
      schemaVersion: pepeteXPatchSchemaVersion,
      patch: {
        operations: [
          {
            op: 'update_text',
            slideId: 'slide-1',
            elementId: 'headline',
            text: 'Sharper value proposition'
          }
        ]
      },
      userVisibleSummary: 'Updated the headline.'
    });

    expect(result.mode).toBe('deck_patch');
    if (result.mode === 'deck_patch') {
      expect(result.assumptions).toEqual([]);
      expect(result.warnings).toEqual([]);
    }
  });

  it('normalizes common deck patch operation aliases', () => {
    const result = parsePepeteXAIResult({
      mode: 'deck_patch',
      schemaVersion: pepeteXPatchSchemaVersion,
      patch: {
        operations: [
          {
            op: 'edit_text',
            slideId: 'slide-1',
            elementId: 'headline',
            newText: 'Sharper headline'
          },
          {
            op: 'update_slide',
            slideId: 'slide-2',
            slide: {
              id: 'slide-2',
              title: 'Updated slide',
              html: '<section></section>',
              css: ''
            }
          }
        ]
      },
      assumptions: [],
      warnings: [],
      userVisibleSummary: 'Applied comments.'
    });

    expect(result.mode).toBe('deck_patch');
    if (result.mode === 'deck_patch') {
      expect(result.patch.operations[0]).toMatchObject({
        op: 'update_text',
        text: 'Sharper headline'
      });
      expect(result.patch.operations[1]).toMatchObject({ op: 'replace_slide' });
    }
  });

  it('rejects unsupported deck patch operation names', () => {
    const result = validatePepeteXAIResult({
      mode: 'deck_patch',
      schemaVersion: pepeteXPatchSchemaVersion,
      patch: {
        operations: [
          {
            op: 'comment_applied',
            slideId: 'slide-1'
          }
        ]
      },
      assumptions: [],
      warnings: [],
      userVisibleSummary: 'Applied comments.'
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        'result.patch.operations[0].op must be one of: replace_slide, insert_slide, delete_slide, move_slide, update_text, update_element_style, update_element_attributes, replace_element_html.'
      );
    }
  });

  it('rejects invalid deck payloads', () => {
    const result = validateGeneratedDeck({
      title: 'Broken deck',
      language: 'en',
      aspectRatio: '4:3',
      canvas: {
        width: 1920,
        height: 1080
      },
      slides: []
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('deck.aspectRatio must equal "16:9".');
    }
  });

  it('rejects invalid chart values and unknown modes', () => {
    const result = validatePepeteXAIResult({
      mode: 'deck',
      schemaVersion: pepeteXDeckSchemaVersion,
      deck: {
        title: 'Bad chart',
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
            html: '<section></section>',
            css: '',
            assets: [],
            charts: [
              {
                id: 'chart-1',
                kind: 'bar',
                categories: ['Q1'],
                series: [
                  {
                    name: 'Revenue',
                    values: ['oops']
                  }
                ]
              }
            ]
          }
        ]
      },
      assumptions: [],
      warnings: [],
      designSystemRulesUsed: []
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.includes('values[0] must be a finite number'))).toBe(
        true
      );
    }

    const invalidMode = validatePepeteXAIResult({
      mode: 'something-else'
    });

    expect(invalidMode.ok).toBe(false);
  });

  it('rejects empty chart shells', () => {
    const result = validatePepeteXAIResult({
      mode: 'deck',
      schemaVersion: pepeteXDeckSchemaVersion,
      deck: {
        title: 'Bad chart shell',
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
            html: '<section></section>',
            css: '',
            assets: [],
            charts: [
              {
                id: 'chart-1',
                kind: 'bar',
                categories: [],
                series: []
              }
            ],
            diagrams: []
          }
        ]
      },
      assumptions: [],
      warnings: [],
      designSystemRulesUsed: []
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          'result.deck.slides[0].charts[0].categories must contain at least one category.',
          'result.deck.slides[0].charts[0].series must contain at least one series.'
        ])
      );
    }
  });

  it('rejects chart series that do not match categories', () => {
    const result = validatePepeteXAIResult({
      mode: 'deck',
      schemaVersion: pepeteXDeckSchemaVersion,
      deck: {
        title: 'Bad chart length',
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
            html: '<section></section>',
            css: '',
            assets: [],
            charts: [
              {
                id: 'chart-1',
                kind: 'line',
                categories: ['Jan', 'Feb', 'Mar'],
                series: [{ name: 'Revenue', values: [10, 12] }]
              }
            ],
            diagrams: []
          }
        ]
      },
      assumptions: [],
      warnings: [],
      designSystemRulesUsed: []
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        'result.deck.slides[0].charts[0].series[0].values must contain exactly 3 value(s) to match categories.'
      );
    }
  });

  it('exports the planned workflow descriptors', () => {
    expect(workflowDescriptors).toEqual([
      { name: 'generateDeckWorkflow', humanInTheLoop: true },
      { name: 'generateSingleSlideWorkflow', humanInTheLoop: true },
      { name: 'regenerateSlideWorkflow', humanInTheLoop: true },
      { name: 'applyCommentsWorkflow', humanInTheLoop: true },
      { name: 'applyTweaksWorkflow', humanInTheLoop: true },
      { name: 'generateImageWorkflow', humanInTheLoop: false }
    ]);
  });
});

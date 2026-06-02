import { describe, expect, it } from 'vitest';
import type { DesignSystemDocument } from './index.js';
import {
  DesignSystemValidationError
} from './index.js';
import {
  defaultDesignSystemBuckets,
  designSystemBucketKinds,
  extractV2ChartColors,
  migrateLegacyDesignSystemDocument,
  normalizeDesignSystemDocumentV2,
  projectV2ToLegacyDocument,
  repairDesignSystemDocumentV2,
  summarizeDesignSystemDocumentV2,
  type DesignSystemDocumentV2
} from './document.js';

const goodComponentHtml =
  '<div data-pepetex-id="card-basic" data-pepetex-type="card"><h3>Title</h3><p>Body</p></div>';
const goodComponentCss =
  '[data-pepetex-id="card-basic"]{display:flex;flex-direction:column;font-size:18px;font-weight:600;line-height:1.4;background-color:#ffffff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.1);padding:24px;}';
const goodSlideHtml =
  '<section class="pepetex-slide" data-pepetex-slide-id="title-1" style="width:1920px;height:1080px;position:relative;overflow:hidden;"><h1>Hello</h1></section>';
const goodSlideCss =
  '.pepetex-slide{position:relative;width:1920px;height:1080px;overflow:hidden;display:flex;font-size:64px;font-weight:700;line-height:1.2;background:linear-gradient(135deg,#111,#333);}';

function makeColorBucket() {
  return {
    id: 'colors',
    kind: 'color' as const,
    label: 'Colors',
    description: null,
    subCategories: [
      {
        id: 'primary',
        label: 'Primary',
        description: null,
        items: [{ id: 'brand-blue', label: 'Brand Blue', value: '#1A73E8', usage: 'primary actions' }]
      },
      {
        id: 'neutral',
        label: 'Neutral',
        description: null,
        items: [{ id: 'ink', label: 'Ink', value: '#101418', usage: null }]
      }
    ]
  };
}

function makeValidV2(): DesignSystemDocumentV2 {
  return {
    version: 2,
    buckets: [
      makeColorBucket(),
      {
        id: 'components',
        kind: 'component',
        label: 'Components',
        description: null,
        subCategories: [
          {
            id: 'cards',
            label: 'Cards',
            description: null,
            items: [
              {
                id: 'card-basic',
                label: 'Basic Card',
                kind: 'card',
                description: 'A basic card',
                html: goodComponentHtml,
                css: goodComponentCss
              }
            ]
          }
        ]
      },
      {
        id: 'examples',
        kind: 'example',
        label: 'Example Slides',
        description: null,
        subCategories: [
          {
            id: 'title',
            label: 'Title Slides',
            description: null,
            items: [
              {
                id: 'title-1',
                label: 'Hero Title',
                purpose: 'Opening title slide',
                html: goodSlideHtml,
                css: goodSlideCss
              }
            ]
          }
        ]
      },
      {
        id: 'assets',
        kind: 'asset',
        label: 'Assets',
        description: null,
        subCategories: [
          {
            id: 'logos',
            label: 'Logos',
            description: null,
            items: [
              {
                id: 'primary-logo',
                label: 'Primary Logo',
                assetKind: 'logo',
                source: 'generated',
                referenceFileId: null,
                generatedImageId: null,
                prompt: 'A minimalist wordmark',
                mimeType: null,
                width: null,
                height: null,
                description: null
              }
            ]
          }
        ]
      }
    ]
  };
}

describe('defaultDesignSystemBuckets', () => {
  it('returns the six fixed buckets with the right kinds', () => {
    const buckets = defaultDesignSystemBuckets();
    expect(buckets.map((b) => b.kind)).toEqual([
      'color',
      'typography',
      'spacing',
      'component',
      'example',
      'asset'
    ]);
    for (const bucket of buckets) {
      expect(bucket.subCategories).toEqual([]);
      expect(designSystemBucketKinds).toContain(bucket.kind);
    }
  });
});

describe('normalizeDesignSystemDocumentV2', () => {
  it('accepts a well-formed V2 document', () => {
    const doc = normalizeDesignSystemDocumentV2(makeValidV2(), { enforceQuality: true });
    expect(doc.version).toBe(2);
    expect(doc.buckets).toHaveLength(4);
  });

  it('accepts typography items linked to uploaded font assets', () => {
    const doc = normalizeDesignSystemDocumentV2({
      version: 2,
      buckets: [
        {
          id: 'typography',
          kind: 'typography',
          label: 'Typography',
          description: null,
          subCategories: [
            {
              id: 'display',
              label: 'Display',
              description: null,
              items: [
                {
                  id: 'display-xl',
                  label: 'Display XL',
                  fontFamily: 'Brand Sans',
                  fontSizePx: 72,
                  fontWeight: 700,
                  lineHeight: 1.05,
                  fontAssetId: 'font_asset_1'
                }
              ]
            }
          ]
        }
      ]
    }, { enforceQuality: true });

    const item = doc.buckets[0]?.subCategories[0]?.items[0];
    expect(item).toMatchObject({ fontFamily: 'Brand Sans', fontAssetId: 'font_asset_1' });
  });

  it('rejects an unknown bucket kind', () => {
    const bad = makeValidV2() as unknown as { buckets: Array<{ kind: string }> };
    bad.buckets[0]!.kind = 'wormhole';
    expect(() => normalizeDesignSystemDocumentV2(bad)).toThrow(DesignSystemValidationError);
  });

  it('rejects duplicate item ids within a bucket', () => {
    const bad = makeValidV2() as unknown as { buckets: Array<{ subCategories: Array<{ items: Array<{ id: string }> }> }> };
    bad.buckets[0]!.subCategories[1]!.items[0]!.id = 'brand-blue';
    expect(() => normalizeDesignSystemDocumentV2(bad)).toThrow(/unique/i);
  });

  it('rejects an invalid hex color value', () => {
    const bad = makeValidV2() as unknown as { buckets: Array<{ subCategories: Array<{ items: Array<{ value: string }> }> }> };
    bad.buckets[0]!.subCategories[0]!.items[0]!.value = 'blue';
    expect(() => normalizeDesignSystemDocumentV2(bad)).toThrow(DesignSystemValidationError);
  });

  it('enforces component quality when enforceQuality is true', () => {
    const bad = makeValidV2() as unknown as { buckets: Array<{ subCategories: Array<{ items: Array<{ html: string }> }> }> };
    bad.buckets[1]!.subCategories[0]!.items[0]!.html = '<div>no attributes</div>';
    expect(() => normalizeDesignSystemDocumentV2(bad, { enforceQuality: true })).toThrow(
      DesignSystemValidationError
    );
  });

  it('skips quality enforcement when enforceQuality is false', () => {
    const lenient = makeValidV2() as unknown as { buckets: Array<{ subCategories: Array<{ items: Array<{ html: string; css: string }> }> }> };
    lenient.buckets[1]!.subCategories[0]!.items[0]!.html = '<div>no attributes</div>';
    lenient.buckets[1]!.subCategories[0]!.items[0]!.css = 'color:red;';
    expect(() => normalizeDesignSystemDocumentV2(lenient, { enforceQuality: false })).not.toThrow();
  });
});

describe('repairDesignSystemDocumentV2', () => {
  it('repairs a component missing pepetex data attributes', () => {
    const broken = makeValidV2() as unknown as { buckets: Array<{ subCategories: Array<{ items: Array<{ html: string }> }> }> };
    broken.buckets[1]!.subCategories[0]!.items[0]!.html = '<div><h3>Card</h3></div>';
    const result = repairDesignSystemDocumentV2(broken);
    expect(result).not.toBeNull();
    expect(result?.warnings.length).toBeGreaterThan(0);
    const repairedItem = result?.document.buckets[1]?.subCategories[0]?.items[0];
    expect(JSON.stringify(repairedItem)).toContain('data-pepetex-id');
  });
});

describe('migrateLegacyDesignSystemDocument', () => {
  const legacy: DesignSystemDocument = {
    tokens: {
      colors: [{ id: 'c1', label: 'Blue', value: '#1A73E8', usage: 'primary' }],
      typography: [
        { id: 't1', label: 'Heading', fontFamily: 'Inter', fontSizePx: 48, fontWeight: 700, lineHeight: 1.2 }
      ],
      spacing: [{ id: 's1', label: 'Gap', valuePx: 24 }]
    },
    components: [
      { id: 'comp-card', name: 'Card', kind: 'card', description: null, html: goodComponentHtml, css: goodComponentCss },
      { id: 'comp-hero', name: 'Hero', kind: 'hero', description: null, html: goodComponentHtml.replace('card-basic', 'comp-hero').replace('card', 'hero'), css: goodComponentCss.replace('card-basic', 'comp-hero') }
    ],
    exampleSlides: [
      { id: 'ex-1', name: 'Title', purpose: 'Open', html: goodSlideHtml, css: goodSlideCss }
    ],
    archetypes: [
      { id: 'arch-1', name: 'Title Archetype', purpose: 'Opening', recommendedComponentIds: ['comp-hero'], layoutGuidance: 'Centered', baseCss: '.x{display:flex}', exampleSlideId: 'ex-1' }
    ],
    rules: [
      { id: 'rule-1', scope: 'color', type: 'must', description: 'Use brand blue for CTAs', targetValue: '#1A73E8' }
    ]
  };

  it('maps every legacy section into V2 buckets with no data loss', () => {
    const v2 = migrateLegacyDesignSystemDocument(legacy);
    // round-trips through the lenient normalizer
    expect(() => normalizeDesignSystemDocumentV2(v2, { enforceQuality: false })).not.toThrow();

    const byKind = (kind: string) => v2.buckets.find((b) => b.kind === kind);
    expect(byKind('color')?.subCategories.flatMap((s) => s.items) ?? []).toHaveLength(1);
    expect(byKind('typography')?.subCategories.flatMap((s) => s.items) ?? []).toHaveLength(1);
    expect(byKind('spacing')?.subCategories.flatMap((s) => s.items) ?? []).toHaveLength(1);

    // components grouped one sub-category per kind
    const componentBucket = byKind('component');
    expect((componentBucket?.subCategories ?? []).map((s) => s.id).sort()).toEqual(['card', 'hero']);

    // examples present
    expect(byKind('example')?.subCategories.flatMap((s) => s.items) ?? []).toHaveLength(1);

    // archetypes + rules preserved in a custom guidance bucket
    const guidance = byKind('custom');
    expect(guidance).toBeDefined();
    const guidanceItems = guidance?.subCategories.flatMap((s) => s.items) ?? [];
    expect(guidanceItems.length).toBe(2);
  });

  it('always produces the six default buckets even when legacy is sparse', () => {
    const sparse: DesignSystemDocument = {
      tokens: { colors: [], typography: [], spacing: [] },
      components: [],
      exampleSlides: [],
      archetypes: [],
      rules: []
    };
    const v2 = migrateLegacyDesignSystemDocument(sparse);
    const kinds = v2.buckets.map((b) => b.kind);
    for (const k of ['color', 'typography', 'spacing', 'component', 'example', 'asset']) {
      expect(kinds).toContain(k);
    }
  });
});

describe('extractV2ChartColors', () => {
  it('flattens all color-kind bucket items in order', () => {
    const colors = extractV2ChartColors(normalizeDesignSystemDocumentV2(makeValidV2()));
    expect(colors).toContain('#1A73E8');
    expect(colors).toContain('#101418');
  });
});

describe('projectV2ToLegacyDocument', () => {
  it('flattens buckets into the legacy shape for the deck compliance consumer', () => {
    const legacy = projectV2ToLegacyDocument(normalizeDesignSystemDocumentV2(makeValidV2()));
    expect(legacy.tokens.colors.map((c) => c.value)).toEqual(expect.arrayContaining(['#1A73E8', '#101418']));
    expect(legacy.components).toHaveLength(1);
    expect(legacy.components[0]!.kind).toBe('card');
    expect(legacy.exampleSlides).toHaveLength(1);
    // asset + invented buckets are dropped, never throwing
    expect(legacy.archetypes).toEqual([]);
    expect(legacy.rules).toEqual([]);
  });

  it('does not throw for invented buckets and asset-only documents', () => {
    const doc: DesignSystemDocumentV2 = {
      version: 2,
      buckets: [
        { id: 'mood', kind: 'custom', label: 'Mood', description: null, subCategories: [{ id: 'x', label: 'X', description: null, items: [{ id: 'm1', label: 'Calm', description: null, value: 'soft' }] }] },
        { id: 'assets', kind: 'asset', label: 'Assets', description: null, subCategories: [{ id: 'logos', label: 'Logos', description: null, items: [{ id: 'a1', label: 'Logo', assetKind: 'logo', source: 'generated', referenceFileId: null, generatedImageId: 'gi_1', prompt: null, mimeType: null, width: null, height: null, description: null }] }] }
      ]
    };
    expect(() => projectV2ToLegacyDocument(normalizeDesignSystemDocumentV2(doc))).not.toThrow();
  });
});

describe('summarizeDesignSystemDocumentV2', () => {
  it('counts buckets and items', () => {
    const counts = summarizeDesignSystemDocumentV2(normalizeDesignSystemDocumentV2(makeValidV2()));
    expect(counts.bucketCount).toBe(4);
    expect(counts.itemCount).toBe(5);
  });
});

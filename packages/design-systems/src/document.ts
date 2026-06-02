import {
  DesignSystemValidationError,
  assertComponentQuality,
  assertExampleSlideQuality,
  assertUniqueIds,
  asRecord,
  hasSubstantialPresentationCss,
  normalizeColorValue,
  normalizeComponentKind,
  normalizeIdentifier,
  normalizeNullableText,
  normalizePositiveNumber,
  normalizeRequiredText,
  repairComponentCss,
  repairComponentHtml,
  repairExampleSlideCss,
  repairExampleSlideHtml,
  type DesignSystemComponent,
  type DesignSystemComponentKind,
  type DesignSystemDocument,
  type DesignSystemExampleSlide,
  type DesignSystemSlideArchetype,
  type DesignSystemRule
} from './index.js';

// ---------------------------------------------------------------------------
// V2 flexible document model
//
// The legacy document was a rigid 5-bucket shape (colors/typography/spacing,
// components, exampleSlides, archetypes, rules). V2 generalizes this into an
// ordered list of top-level *buckets*, each with a `kind` that determines how
// its items are validated. Within a bucket the AI invents *sub-categories*
// (e.g. colors -> neutral/primary/gradient), and decides how many items each
// holds. Six default buckets always exist; the AI may add more (`custom`).
// ---------------------------------------------------------------------------

export const designSystemBucketKinds = [
  'color',
  'typography',
  'spacing',
  'component',
  'example',
  'asset',
  'custom'
] as const;
export type DesignSystemBucketKind = (typeof designSystemBucketKinds)[number];

export const designSystemAssetSources = ['reference', 'generated'] as const;
export type DesignSystemAssetSource = (typeof designSystemAssetSources)[number];

export interface DesignSystemColorItem {
  id: string;
  label: string;
  value: string;
  usage: string | null;
}

export interface DesignSystemTypographyItem {
  id: string;
  label: string;
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number;
  lineHeight: number;
  /** Optional DesignSystemReferenceFile id for an uploaded font asset. */
  fontAssetId: string | null;
}

export interface DesignSystemSpacingItem {
  id: string;
  label: string;
  valuePx: number;
}

export interface DesignSystemComponentItem {
  id: string;
  label: string;
  kind: DesignSystemComponentKind;
  description: string | null;
  html: string;
  css: string;
}

export interface DesignSystemExampleItem {
  id: string;
  label: string;
  purpose: string;
  html: string;
  css: string;
}

export interface DesignSystemAssetItem {
  id: string;
  label: string;
  /** Free-form classification chosen by the AI: logo, partner-logo, illustration, icon, image, ... */
  assetKind: string;
  source: DesignSystemAssetSource;
  referenceFileId: string | null;
  generatedImageId: string | null;
  prompt: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  description: string | null;
}

export interface DesignSystemCustomItem {
  id: string;
  label: string;
  description: string | null;
  /** Free-form guidance payload (text or serialized JSON). */
  value: string | null;
}

export type DesignSystemItem =
  | DesignSystemColorItem
  | DesignSystemTypographyItem
  | DesignSystemSpacingItem
  | DesignSystemComponentItem
  | DesignSystemExampleItem
  | DesignSystemAssetItem
  | DesignSystemCustomItem;

export interface DesignSystemSubCategory {
  id: string;
  label: string;
  description: string | null;
  items: DesignSystemItem[];
}

export interface DesignSystemBucket {
  id: string;
  kind: DesignSystemBucketKind;
  label: string;
  description: string | null;
  subCategories: DesignSystemSubCategory[];
}

export interface DesignSystemDocumentV2 {
  version: 2;
  buckets: DesignSystemBucket[];
}

export interface DesignSystemDocumentV2Counts {
  bucketCount: number;
  subCategoryCount: number;
  itemCount: number;
}

interface DefaultBucketSpec {
  id: string;
  kind: DesignSystemBucketKind;
  label: string;
}

const DEFAULT_BUCKET_SPECS: DefaultBucketSpec[] = [
  { id: 'colors', kind: 'color', label: 'Colors' },
  { id: 'typography', kind: 'typography', label: 'Typography' },
  { id: 'spacing', kind: 'spacing', label: 'Spacing' },
  { id: 'components', kind: 'component', label: 'Components' },
  { id: 'examples', kind: 'example', label: 'Example Slides' },
  { id: 'assets', kind: 'asset', label: 'Assets' }
];

export function defaultDesignSystemBuckets(): DesignSystemBucket[] {
  return DEFAULT_BUCKET_SPECS.map((spec) => ({
    id: spec.id,
    kind: spec.kind,
    label: spec.label,
    description: null,
    subCategories: []
  }));
}

export interface DesignSystemNormalizeV2Options {
  enforceQuality?: boolean;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalizeDesignSystemDocumentV2(
  input: unknown,
  options: DesignSystemNormalizeV2Options = {}
): DesignSystemDocumentV2 {
  const candidate = asRecord(input, 'Design system document is required.');
  const rawBuckets = candidate.buckets;
  if (!Array.isArray(rawBuckets)) {
    throw new DesignSystemValidationError('Design system document buckets must be provided as an array.');
  }

  const buckets = rawBuckets.map((entry, index) => normalizeBucket(entry, index, options));
  assertUniqueIds(buckets.map((b) => b.id), 'Design system bucket ids');

  return { version: 2, buckets };
}

function normalizeBucket(
  input: unknown,
  index: number,
  options: DesignSystemNormalizeV2Options
): DesignSystemBucket {
  const bucket = asRecord(input, `Design system bucket #${index + 1} is invalid.`);
  const kind = normalizeBucketKind(bucket.kind, index + 1);
  const label = normalizeRequiredText(bucket.label, `Design system bucket #${index + 1} label`, 120);
  const id = normalizeIdentifier(bucket.id, `Design system bucket #${index + 1} id`, 80);
  const description = normalizeNullableText(
    bucket.description,
    `Design system bucket #${index + 1} description`,
    600
  );

  const rawSubs = bucket.subCategories;
  if (rawSubs !== undefined && rawSubs !== null && !Array.isArray(rawSubs)) {
    throw new DesignSystemValidationError(
      `Design system bucket "${id}" subCategories must be provided as an array.`
    );
  }

  const subCategories = (Array.isArray(rawSubs) ? rawSubs : []).map((sub, subIndex) =>
    normalizeSubCategory(sub, kind, id, subIndex, options)
  );
  assertUniqueIds(subCategories.map((s) => s.id), `Design system bucket "${id}" sub-category ids`);

  // Item ids must be unique across the whole bucket so items are stably addressable.
  const allItemIds = subCategories.flatMap((s) => s.items.map((item) => item.id));
  assertUniqueIds(allItemIds, `Design system bucket "${id}" item ids`);

  return { id, kind, label, description, subCategories };
}

function normalizeSubCategory(
  input: unknown,
  bucketKind: DesignSystemBucketKind,
  bucketId: string,
  index: number,
  options: DesignSystemNormalizeV2Options
): DesignSystemSubCategory {
  const sub = asRecord(input, `Design system bucket "${bucketId}" sub-category #${index + 1} is invalid.`);
  const id = normalizeIdentifier(sub.id, `Bucket "${bucketId}" sub-category #${index + 1} id`, 80);
  const label = normalizeRequiredText(sub.label, `Bucket "${bucketId}" sub-category #${index + 1} label`, 120);
  const description = normalizeNullableText(
    sub.description,
    `Bucket "${bucketId}" sub-category #${index + 1} description`,
    600
  );

  const rawItems = sub.items;
  if (rawItems !== undefined && rawItems !== null && !Array.isArray(rawItems)) {
    throw new DesignSystemValidationError(
      `Bucket "${bucketId}" sub-category "${id}" items must be provided as an array.`
    );
  }

  const items = (Array.isArray(rawItems) ? rawItems : []).map((item, itemIndex) =>
    normalizeItem(item, bucketKind, `${bucketId}/${id}`, itemIndex, options)
  );

  return { id, label, description, items };
}

function normalizeItem(
  input: unknown,
  bucketKind: DesignSystemBucketKind,
  path: string,
  index: number,
  options: DesignSystemNormalizeV2Options
): DesignSystemItem {
  const item = asRecord(input, `Item ${path} #${index + 1} is invalid.`);
  const enforceQuality = options.enforceQuality ?? true;
  const baseId = normalizeIdentifier(item.id, `Item ${path} #${index + 1} id`, 80);
  const baseLabel = normalizeRequiredText(item.label, `Item ${path} #${index + 1} label`, 160);

  switch (bucketKind) {
    case 'color':
      return {
        id: baseId,
        label: baseLabel,
        value: normalizeColorValue(item.value, index + 1),
        usage: normalizeNullableText(item.usage, `Item ${path} #${index + 1} usage`, 200)
      } satisfies DesignSystemColorItem;

    case 'typography':
      return {
        id: baseId,
        label: baseLabel,
        fontFamily: normalizeRequiredText(item.fontFamily, `Item ${path} #${index + 1} fontFamily`, 200),
        fontSizePx: normalizePositiveNumber(item.fontSizePx, `Item ${path} #${index + 1} fontSizePx`, 1, 512),
        fontWeight: normalizePositiveNumber(item.fontWeight, `Item ${path} #${index + 1} fontWeight`, 100, 1000),
        lineHeight: normalizePositiveNumber(item.lineHeight, `Item ${path} #${index + 1} lineHeight`, 0.5, 10),
        fontAssetId: normalizeNullableText(item.fontAssetId, `Item ${path} #${index + 1} fontAssetId`, 80)
      } satisfies DesignSystemTypographyItem;

    case 'spacing':
      return {
        id: baseId,
        label: baseLabel,
        valuePx: normalizePositiveNumber(item.valuePx, `Item ${path} #${index + 1} valuePx`, 0, 4096)
      } satisfies DesignSystemSpacingItem;

    case 'component': {
      const normalized: DesignSystemComponentItem = {
        id: baseId,
        label: baseLabel,
        kind: normalizeComponentKind(item.kind, index + 1),
        description: normalizeNullableText(item.description, `Item ${path} #${index + 1} description`, 400),
        html: normalizeRequiredText(item.html, `Item ${path} #${index + 1} html`, 20000),
        css: normalizeRequiredText(item.css, `Item ${path} #${index + 1} css`, 20000)
      };
      if (enforceQuality) {
        assertComponentQuality(toLegacyComponent(normalized), index + 1);
      }
      return normalized;
    }

    case 'example': {
      const normalized: DesignSystemExampleItem = {
        id: baseId,
        label: baseLabel,
        purpose: normalizeRequiredText(item.purpose, `Item ${path} #${index + 1} purpose`, 500),
        html: normalizeRequiredText(item.html, `Item ${path} #${index + 1} html`, 20000),
        css: normalizeRequiredText(item.css, `Item ${path} #${index + 1} css`, 20000)
      };
      if (enforceQuality) {
        assertExampleSlideQuality(toLegacyExampleSlide(normalized), index + 1);
      }
      return normalized;
    }

    case 'asset':
      return {
        id: baseId,
        label: baseLabel,
        assetKind: normalizeRequiredText(item.assetKind, `Item ${path} #${index + 1} assetKind`, 80),
        source: normalizeAssetSource(item.source, path, index + 1),
        referenceFileId: normalizeNullableText(item.referenceFileId, `Item ${path} #${index + 1} referenceFileId`, 80),
        generatedImageId: normalizeNullableText(item.generatedImageId, `Item ${path} #${index + 1} generatedImageId`, 80),
        prompt: normalizeNullableText(item.prompt, `Item ${path} #${index + 1} prompt`, 2000),
        mimeType: normalizeNullableText(item.mimeType, `Item ${path} #${index + 1} mimeType`, 120),
        width: normalizeNullableNumber(item.width, `Item ${path} #${index + 1} width`, 1, 16384),
        height: normalizeNullableNumber(item.height, `Item ${path} #${index + 1} height`, 1, 16384),
        description: normalizeNullableText(item.description, `Item ${path} #${index + 1} description`, 600)
      } satisfies DesignSystemAssetItem;

    case 'custom':
      return {
        id: baseId,
        label: baseLabel,
        description: normalizeNullableText(item.description, `Item ${path} #${index + 1} description`, 2000),
        value: normalizeNullableText(item.value, `Item ${path} #${index + 1} value`, 8000)
      } satisfies DesignSystemCustomItem;

    default:
      throw new DesignSystemValidationError(`Item ${path} #${index + 1} has an unsupported bucket kind.`);
  }
}

function normalizeBucketKind(value: unknown, index: number): DesignSystemBucketKind {
  if (typeof value !== 'string' || !designSystemBucketKinds.includes(value as DesignSystemBucketKind)) {
    throw new DesignSystemValidationError(
      `Design system bucket #${index} kind must be one of: ${designSystemBucketKinds.join(', ')}.`
    );
  }
  return value as DesignSystemBucketKind;
}

function normalizeAssetSource(value: unknown, path: string, index: number): DesignSystemAssetSource {
  if (typeof value !== 'string' || !designSystemAssetSources.includes(value as DesignSystemAssetSource)) {
    throw new DesignSystemValidationError(
      `Item ${path} #${index} source must be one of: ${designSystemAssetSources.join(', ')}.`
    );
  }
  return value as DesignSystemAssetSource;
}

function normalizeNullableNumber(value: unknown, fieldLabel: string, min: number, max: number): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizePositiveNumber(value, fieldLabel, min, max);
}

function toLegacyComponent(item: DesignSystemComponentItem): DesignSystemComponent {
  return { id: item.id, name: item.label, kind: item.kind, description: item.description, html: item.html, css: item.css };
}

function toLegacyExampleSlide(item: DesignSystemExampleItem): DesignSystemExampleSlide {
  return { id: item.id, name: item.label, purpose: item.purpose, html: item.html, css: item.css };
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isColorItem(item: DesignSystemItem): item is DesignSystemColorItem {
  return typeof (item as DesignSystemColorItem).value === 'string' && !('html' in item);
}

export function isAssetItem(item: DesignSystemItem): item is DesignSystemAssetItem {
  return 'assetKind' in item && 'source' in item;
}

// ---------------------------------------------------------------------------
// Repair (mirror of repairDesignSystemDocument: try normalize, else patch HTML/CSS)
// ---------------------------------------------------------------------------

export function repairDesignSystemDocumentV2(
  input: unknown
): { document: DesignSystemDocumentV2; warnings: string[] } | null {
  const warnings: string[] = [];

  try {
    return { document: normalizeDesignSystemDocumentV2(input), warnings };
  } catch {
    // proceed to repair
  }

  let candidate: { buckets?: unknown };
  try {
    candidate = JSON.parse(JSON.stringify(input)) as { buckets?: unknown };
  } catch {
    return null;
  }

  if (Array.isArray(candidate.buckets)) {
    for (const bucketEntry of candidate.buckets) {
      if (!bucketEntry || typeof bucketEntry !== 'object') continue;
      const bucket = bucketEntry as Record<string, unknown>;
      const kind = String(bucket.kind ?? '');
      if (!Array.isArray(bucket.subCategories)) continue;

      for (const subEntry of bucket.subCategories) {
        if (!subEntry || typeof subEntry !== 'object') continue;
        const sub = subEntry as Record<string, unknown>;
        if (!Array.isArray(sub.items)) continue;

        for (const itemEntry of sub.items) {
          if (!itemEntry || typeof itemEntry !== 'object') continue;
          const item = itemEntry as Record<string, unknown>;
          const id = String(item.id ?? '');

          if (kind === 'component') {
            const componentKind = String(item.kind ?? 'card');
            if (typeof item.html === 'string') {
              const repaired = repairComponentHtml(item.html, id, componentKind);
              if (repaired !== item.html) {
                item.html = repaired;
                warnings.push(`Auto-added data-pepetex attributes to component ${id || 'unknown'}.`);
              }
            }
            if (typeof item.css === 'string' && !hasSubstantialPresentationCss(item.css)) {
              item.css = repairComponentCss(item.css, id);
              warnings.push(`Auto-added presentation CSS to component ${id || 'unknown'}.`);
            }
          } else if (kind === 'example') {
            if (typeof item.html === 'string') {
              const repaired = repairExampleSlideHtml(item.html, id);
              if (repaired !== item.html) {
                item.html = repaired;
                warnings.push(`Auto-added pepetex-slide attributes to example ${id || 'unknown'}.`);
              }
            }
            if (typeof item.css === 'string' && !hasSubstantialPresentationCss(item.css)) {
              item.css = repairExampleSlideCss(item.css);
              warnings.push(`Auto-added presentation CSS to example ${id || 'unknown'}.`);
            }
          }
        }
      }
    }
  }

  try {
    return { document: normalizeDesignSystemDocumentV2(candidate), warnings };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Legacy -> V2 migration (one-time backfill helper, no data loss)
// ---------------------------------------------------------------------------

export function migrateLegacyDesignSystemDocument(legacy: DesignSystemDocument): DesignSystemDocumentV2 {
  const buckets = defaultDesignSystemBuckets();
  const byKind = (kind: DesignSystemBucketKind) => {
    const bucket = buckets.find((b) => b.kind === kind);
    if (!bucket) throw new DesignSystemValidationError(`Missing default bucket for kind ${kind}.`);
    return bucket;
  };

  if (legacy.tokens.colors.length > 0) {
    byKind('color').subCategories.push({
      id: 'general',
      label: 'General',
      description: null,
      items: legacy.tokens.colors.map((c) => ({ id: c.id, label: c.label, value: c.value, usage: c.usage }))
    });
  }

  if (legacy.tokens.typography.length > 0) {
    byKind('typography').subCategories.push({
      id: 'general',
      label: 'General',
      description: null,
      items: legacy.tokens.typography.map((t) => ({
        id: t.id,
        label: t.label,
        fontFamily: t.fontFamily,
        fontSizePx: t.fontSizePx,
        fontWeight: t.fontWeight,
        lineHeight: t.lineHeight,
        fontAssetId: t.fontAssetId ?? null
      }))
    });
  }

  if (legacy.tokens.spacing.length > 0) {
    byKind('spacing').subCategories.push({
      id: 'general',
      label: 'General',
      description: null,
      items: legacy.tokens.spacing.map((s) => ({ id: s.id, label: s.label, valuePx: s.valuePx }))
    });
  }

  if (legacy.components.length > 0) {
    const groups = new Map<string, DesignSystemComponentItem[]>();
    for (const component of legacy.components) {
      const list = groups.get(component.kind) ?? [];
      list.push({
        id: component.id,
        label: component.name,
        kind: component.kind,
        description: component.description,
        html: component.html,
        css: component.css
      });
      groups.set(component.kind, list);
    }
    const componentBucket = byKind('component');
    for (const [kind, items] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      componentBucket.subCategories.push({
        id: kind,
        label: titleCase(kind),
        description: null,
        items
      });
    }
  }

  if (legacy.exampleSlides.length > 0) {
    byKind('example').subCategories.push({
      id: 'general',
      label: 'General',
      description: null,
      items: legacy.exampleSlides.map((s) => ({
        id: s.id,
        label: s.name,
        purpose: s.purpose,
        html: s.html,
        css: s.css
      }))
    });
  }

  const guidanceSubs: DesignSystemSubCategory[] = [];
  if (legacy.archetypes.length > 0) {
    guidanceSubs.push({
      id: 'archetypes',
      label: 'Slide Archetypes',
      description: 'Migrated from legacy slide archetypes.',
      items: legacy.archetypes.map((a) => ({
        id: a.id,
        label: a.name,
        description: a.purpose,
        value: serializeArchetype(a)
      }))
    });
  }
  if (legacy.rules.length > 0) {
    guidanceSubs.push({
      id: 'rules',
      label: 'Brand Rules',
      description: 'Migrated from legacy brand rules.',
      items: legacy.rules.map((r) => ({
        id: r.id,
        label: `${r.type.toUpperCase()} (${r.scope})`,
        description: r.description,
        value: serializeRule(r)
      }))
    });
  }
  if (guidanceSubs.length > 0) {
    buckets.push({
      id: 'guidance',
      kind: 'custom',
      label: 'Guidance',
      description: 'Slide archetypes and brand rules migrated from the legacy format.',
      subCategories: guidanceSubs
    });
  }

  return { version: 2, buckets };
}

function serializeArchetype(a: DesignSystemSlideArchetype): string {
  return JSON.stringify({
    recommendedComponentIds: a.recommendedComponentIds,
    layoutGuidance: a.layoutGuidance,
    baseCss: a.baseCss,
    exampleSlideId: a.exampleSlideId
  });
}

function serializeRule(r: DesignSystemRule): string {
  return JSON.stringify({ scope: r.scope, type: r.type, targetValue: r.targetValue });
}

function titleCase(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

export function summarizeDesignSystemDocumentV2(document: DesignSystemDocumentV2): DesignSystemDocumentV2Counts {
  let subCategoryCount = 0;
  let itemCount = 0;
  for (const bucket of document.buckets) {
    subCategoryCount += bucket.subCategories.length;
    for (const sub of bucket.subCategories) {
      itemCount += sub.items.length;
    }
  }
  return { bucketCount: document.buckets.length, subCategoryCount, itemCount };
}

/**
 * Flattens a V2 document into the legacy DesignSystemDocument shape for in-memory
 * consumers that still expect it (the deck's slide compliance checker and chart-colour
 * extraction). This is NOT used for persistence — V2 (documentJson) is the source of
 * truth. It builds the object directly without re-validating so it never throws on
 * imperfect historical content; unknown component kinds are coerced to a legacy kind.
 */
export function projectV2ToLegacyDocument(document: DesignSystemDocumentV2): DesignSystemDocument {
  const colors: DesignSystemColorItem[] = [];
  const typography: DesignSystemTypographyItem[] = [];
  const spacing: DesignSystemSpacingItem[] = [];
  const components: DesignSystemComponent[] = [];
  const exampleSlides: DesignSystemExampleSlide[] = [];

  for (const bucket of document.buckets) {
    for (const sub of bucket.subCategories) {
      for (const item of sub.items) {
        switch (bucket.kind) {
          case 'color':
            colors.push(item as DesignSystemColorItem);
            break;
          case 'typography':
            typography.push(item as DesignSystemTypographyItem);
            break;
          case 'spacing':
            spacing.push(item as DesignSystemSpacingItem);
            break;
          case 'component': {
            const c = item as DesignSystemComponentItem;
            components.push({ id: c.id, name: c.label, kind: c.kind, description: c.description, html: c.html, css: c.css });
            break;
          }
          case 'example': {
            const e = item as DesignSystemExampleItem;
            exampleSlides.push({ id: e.id, name: e.label, purpose: e.purpose, html: e.html, css: e.css });
            break;
          }
          default:
            break;
        }
      }
    }
  }

  return {
    tokens: { colors, typography, spacing },
    components,
    exampleSlides,
    archetypes: [],
    rules: []
  };
}

/** Flattens every color-kind bucket item value, preserving document order. */
export function extractV2ChartColors(document: DesignSystemDocumentV2): string[] {
  const colors: string[] = [];
  for (const bucket of document.buckets) {
    if (bucket.kind !== 'color') continue;
    for (const sub of bucket.subCategories) {
      for (const item of sub.items) {
        if (isColorItem(item)) colors.push(item.value);
      }
    }
  }
  return colors;
}

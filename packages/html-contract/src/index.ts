import postcss, { type Declaration, type Root, type Rule } from 'postcss';
import { JSDOM } from 'jsdom';

export const SLIDE_CANVAS = {
  width: 1920,
  height: 1080
} as const;

export const allowedElementTypes = [
  'headline',
  'body',
  'image',
  'card',
  'chart',
  'table',
  'cta',
  'background',
  'shape',
  'logo',
  'group',
  'decorative',
  'diagram',
  // design-system component kinds
  'metric',
  'hero',
  'badge',
  'header',
  'footer',
  'list',
  'quote',
  'timeline',
  'divider'
] as const;

export const editableTextElementTypes = ['headline', 'body', 'cta'] as const;

const elementTypeAliases = {
  label: 'body',
  subtitle: 'body',
  text: 'body'
} as const;

export const allowedRootTags = ['section', 'div'] as const;

export const forbiddenHtmlTags = [
  // executable / plugin
  'script', 'noscript', 'iframe', 'frame', 'frameset', 'noframes',
  'object', 'embed', 'applet', 'param', 'portal',
  'template', 'slot', 'foreignobject',
  // media (autoplay / interaction risk in sandboxed preview)
  'video', 'audio', 'track',
  // JS drawing API
  'canvas',
  // form / interactive
  'form', 'input', 'textarea', 'select', 'option', 'optgroup',
  'fieldset', 'legend', 'datalist', 'output', 'progress', 'meter',
  'details', 'summary', 'dialog', 'menu', 'menuitem',
  // image maps
  'map', 'area',
  // document structure (would break slide document model)
  'html', 'head', 'body', 'base', 'link', 'meta', 'title', 'style',
  // legacy / animated
  'marquee', 'blink'
] as const;

// Reference list of well-known CSS properties that render reliably in PPTX export.
// Not enforced by the validator — all standard CSS properties are permitted.
// Add to forbiddenHtmlTags above if a specific property causes breakage in exports.
export const wellKnownCssProperties = [
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'display',
  'box-sizing',
  'flex-direction',
  'flex-wrap',
  'flex',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-items',
  'align-self',
  'justify-content',
  'place-items',
  'place-content',
  'gap',
  'row-gap',
  'column-gap',
  'grid-template-columns',
  'grid-template-rows',
  'grid-column',
  'grid-column-start',
  'grid-column-end',
  'grid-row',
  'grid-row-start',
  'grid-row-end',
  'grid-area',
  'grid-auto-flow',
  'grid-auto-columns',
  'grid-auto-rows',
  'order',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'inset',
  'aspect-ratio',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'background-color',
  'background',
  'background-image',
  'background-clip',
  '-webkit-background-clip',
  'background-size',
  'background-position',
  'background-repeat',
  'color',
  '-webkit-text-fill-color',
  'opacity',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-color',
  'border-width',
  'border-style',
  'border-radius',
  'box-shadow',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-shadow',
  'text-decoration',
  'list-style',
  'list-style-type',
  'list-style-position',
  'content',
  'white-space',
  'vertical-align',
  'word-break',
  'overflow-wrap',
  'overflow',
  'object-fit',
  'object-position',
  'filter',
  'transform',
  'writing-mode',
  'text-orientation',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  // interactive-intent properties safe in static slides
  'cursor',
  'pointer-events',
  'user-select',
  // creative CSS features (PPTX export fidelity may vary)
  'clip-path',
  'mask'
] as const;

// Properties that are valid CSS and render in the live preview but are silently
// dropped by dom-to-pptx — the export will diverge from the preview. Validation
// emits a non-blocking WARNING_CSS so the model can self-correct on the repair
// pass; we deliberately do NOT remove the declaration (the preview still uses
// it). For translucent layered shapes, prefer rgba() fills over mix-blend-mode.
export const pptxUnsupportedCssProperties = [
  'mix-blend-mode',
  'backdrop-filter'
] as const;

export type PepeteXElementType = (typeof allowedElementTypes)[number];
export type SlideValidationSeverity = 'ok' | 'warning' | 'repair_required' | 'blocked';
export type ValidationErrorCode =
  | 'SCHEMA_INVALID'
  | 'FORBIDDEN_TAG'
  | 'FORBIDDEN_ATTR'
  | 'FORBIDDEN_URL'
  | 'FORBIDDEN_CSS'
  | 'MISSING_ROOT'
  | 'INVALID_CANVAS_SIZE'
  | 'MISSING_ELEMENT_ID'
  | 'MISSING_TARGETABLE_ELEMENT'
  | 'DUPLICATE_ELEMENT_ID'
  | 'SCRIPT_DETECTED'
  | 'EXTERNAL_REQUEST_DETECTED'
  | 'RENDER_ERROR'
  | 'EXPORT_DRY_RUN_FAILED'
  | 'TEXT_OVERFLOW'
  | 'ASSET_NOT_FOUND';

export type ValidationWarningCode =
  | 'SANITIZED_HTML'
  | 'CONDITIONAL_TAG_NORMALIZED'
  | 'CONDITIONAL_ATTR_REMOVED'
  | 'WARNING_CSS';

export interface ValidationError {
  code: ValidationErrorCode;
  path?: string;
  message: string;
  repairHint: string;
  elementSnippet?: string;
}

export interface ValidationWarning {
  code: ValidationWarningCode;
  path?: string;
  message: string;
}

export interface ElementIndexEntry {
  id: string;
  type: PepeteXElementType;
  tagName: string;
  path: string;
  slideId: string;
}

export interface SlideValidationResult {
  ok: boolean;
  severity: SlideValidationSeverity;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  normalizedHtml?: string;
  normalizedCss?: string;
  elementIndex: ElementIndexEntry[];
  screenshotAssetId?: string;
}

export interface ValidateSlideInput {
  html: string;
  css: string;
  slideId?: string;
  assetUrls?: Record<string, string>;
  allowedAssetHosts?: string[];
  existingElementIds?: Iterable<string>;
}

export interface ValidateDeckInput {
  deck: unknown;
  assetUrls?: Record<string, string>;
  allowedAssetHosts?: string[];
}

export interface GeneratedDeckSchemaValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

interface MutableValidationState {
  errors: ValidationError[];
  warnings: ValidationWarning[];
  elementIndex: ElementIndexEntry[];
  seenElementIds: Set<string>;
}

interface AssetUrlResolution {
  ok: true;
  value: string;
}

interface AssetUrlResolutionFailure {
  ok: false;
  error: ValidationError;
}

type AssetUrlResolutionResult = AssetUrlResolution | AssetUrlResolutionFailure;

interface ResolveAssetUrlOptions {
  assetUrls?: Record<string, string>;
  allowedAssetHosts?: string[];
}

const forbiddenHtmlTagSet = new Set<string>(forbiddenHtmlTags);
const allowedElementTypeSet = new Set<string>(allowedElementTypes);
const pptxUnsupportedCssPropertySet = new Set<string>(pptxUnsupportedCssProperties);
const ignoredCssPropertySet = new Set<string>([
  'transition',
  'transition-property',
  'transition-duration',
  'transition-delay',
  'transition-timing-function',
  'animation',
  'animation-name',
  'animation-duration',
  'animation-timing-function',
  'animation-delay',
  'animation-iteration-count',
  'animation-direction',
  'animation-fill-mode',
  'animation-play-state',
  'will-change'
]);
const targetableElementTypeSet = new Set<PepeteXElementType>([
  'headline',
  'body',
  'cta',
  'card',
  'chart',
  'image',
  'logo',
  'group',
  'diagram',
  'metric',
  'hero',
  'badge',
  'header',
  'footer',
  'list',
  'quote',
  'timeline',
  'divider',
  // Visual elements: shapes, backgrounds, decoratives, and tables are user-editable
  // via comments (e.g., "make this shape bigger", "change the table border color").
  // The AI must still tag them with data-pepetex-id + data-pepetex-type so they
  // become click targets in the slide canvas.
  'shape',
  'background',
  'decorative',
  'table'
]);
const blockedSeverityCodes = new Set<ValidationErrorCode>([
  'SCRIPT_DETECTED',
  'EXTERNAL_REQUEST_DETECTED',
  'FORBIDDEN_TAG'
]);

export function isAllowedElementType(value: string): value is PepeteXElementType {
  return allowedElementTypeSet.has(value);
}

function normalizePepeteXElementType(value: string): PepeteXElementType | null {
  if (isAllowedElementType(value)) {
    return value;
  }

  return elementTypeAliases[value as keyof typeof elementTypeAliases] ?? null;
}

export function validateGeneratedDeckSchema(input: unknown): GeneratedDeckSchemaValidationResult {
  const errors: ValidationError[] = [];
  const deck = asRecord(input);

  if (!deck) {
    errors.push(
      createError(
        'SCHEMA_INVALID',
        'deck',
        'Deck payload must be an object.',
        'Return a JSON object with title, language, aspectRatio, canvas, and slides.'
      )
    );
    return { ok: false, errors };
  }

  if (!isNonEmptyString(deck.title)) {
    errors.push(
      createError(
        'SCHEMA_INVALID',
        'deck.title',
        'Deck title must be a non-empty string.',
        'Provide a deck title string.'
      )
    );
  }

  if (!isNonEmptyString(deck.language)) {
    errors.push(
      createError(
        'SCHEMA_INVALID',
        'deck.language',
        'Deck language must be a non-empty string.',
        'Provide the deck language code.'
      )
    );
  }

  if (deck.aspectRatio !== '16:9') {
    errors.push(
      createError(
        'SCHEMA_INVALID',
        'deck.aspectRatio',
        'Deck aspect ratio must be "16:9".',
        'Set the deck aspect ratio to 16:9.'
      )
    );
  }

  const canvas = asRecord(deck.canvas);
  if (!canvas || canvas.width !== SLIDE_CANVAS.width || canvas.height !== SLIDE_CANVAS.height) {
    errors.push(
      createError(
        'INVALID_CANVAS_SIZE',
        'deck.canvas',
        'Deck canvas must be 1920x1080.',
        'Return canvas.width=1920 and canvas.height=1080.'
      )
    );
  }

  if (!Array.isArray(deck.slides)) {
    errors.push(
      createError(
        'SCHEMA_INVALID',
        'deck.slides',
        'Deck slides must be an array.',
        'Return slides as an array of slide objects.'
      )
    );
  } else {
    for (const [index, slide] of deck.slides.entries()) {
      const slideRecord = asRecord(slide);
      const basePath = `deck.slides[${index}]`;

      if (!slideRecord) {
        errors.push(
          createError(
            'SCHEMA_INVALID',
            basePath,
            'Each slide must be an object.',
            'Return each slide as an object.'
          )
        );
        continue;
      }

      if (!isNonEmptyString(slideRecord.id)) {
        errors.push(
          createError(
            'SCHEMA_INVALID',
            `${basePath}.id`,
            'Slide id must be a non-empty string.',
            'Provide a stable slide id.'
          )
        );
      }

      if (!isNonEmptyString(slideRecord.title)) {
        errors.push(
          createError(
            'SCHEMA_INVALID',
            `${basePath}.title`,
            'Slide title must be a non-empty string.',
            'Provide a slide title.'
          )
        );
      }

      if (typeof slideRecord.html !== 'string') {
        errors.push(
          createError(
            'SCHEMA_INVALID',
            `${basePath}.html`,
            'Slide html must be a string.',
            'Return html as a string.'
          )
        );
      }

      if (typeof slideRecord.css !== 'string') {
        errors.push(
          createError(
            'SCHEMA_INVALID',
            `${basePath}.css`,
            'Slide css must be a string.',
            'Return css as a string, even when empty.'
          )
        );
      }

      if (!Array.isArray(slideRecord.assets)) {
        errors.push(
          createError(
            'SCHEMA_INVALID',
            `${basePath}.assets`,
            'Slide assets must be an array.',
            'Return assets as an array.'
          )
        );
      }

      if (!Array.isArray(slideRecord.charts)) {
        errors.push(
          createError(
            'SCHEMA_INVALID',
            `${basePath}.charts`,
            'Slide charts must be an array.',
            'Return charts as an array.'
          )
        );
      } else {
        validateSlideChartsForSchema(slideRecord, basePath, errors);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

function validateSlideChartsForSchema(
  slideRecord: Record<string, unknown>,
  basePath: string,
  errors: ValidationError[]
): void {
  const charts = Array.isArray(slideRecord.charts) ? slideRecord.charts : [];
  const chartIds = new Set<string>();

  for (const [chartIndex, chartInput] of charts.entries()) {
    const chart = asRecord(chartInput);
    const chartPath = `${basePath}.charts[${chartIndex}]`;

    if (!chart) {
      errors.push(
        createError(
          'SCHEMA_INVALID',
          chartPath,
          'Slide chart must be an object.',
          'Return each chart as an object with id, kind, categories, and series.'
        )
      );
      continue;
    }

    const id = typeof chart.id === 'string' && chart.id.trim().length > 0 ? chart.id : null;
    const kind = typeof chart.kind === 'string' && chart.kind.trim().length > 0 ? chart.kind : null;
    const categories = Array.isArray(chart.categories) ? chart.categories : null;
    const series = Array.isArray(chart.series) ? chart.series : null;

    if (!id) {
      errors.push(
        createError(
          'SCHEMA_INVALID',
          `${chartPath}.id`,
          'Chart id must be a non-empty string.',
          'Provide a stable chart id and use the same value in data-pepetex-chart-id.'
        )
      );
    } else {
      chartIds.add(id);
    }

    if (!kind) {
      errors.push(
        createError(
          'SCHEMA_INVALID',
          `${chartPath}.kind`,
          'Chart kind must be a non-empty string.',
          'Use bar, line, area, pie, donut, scatter, table-like, or a descriptive kind that can be normalized.'
        )
      );
    }

    if (!categories || categories.length === 0 || !categories.every((category) => isNonEmptyString(category))) {
      errors.push(
        createError(
          'SCHEMA_INVALID',
          `${chartPath}.categories`,
          'Chart categories must contain at least one non-empty label.',
          'Populate chart.categories with the x-axis/category labels. If exact data is unavailable, use clearly labeled illustrative estimates.'
        )
      );
    }

    if (!series || series.length === 0) {
      errors.push(
        createError(
          'SCHEMA_INVALID',
          `${chartPath}.series`,
          'Chart series must contain at least one data series.',
          'Populate chart.series with finite numeric values. Do not return empty chart shells.'
        )
      );
      continue;
    }

    const normalizedKind = kind ? normalizeChartKindForValidation(kind) : 'bar';
    if ((normalizedKind === 'pie' || normalizedKind === 'donut') && series.length !== 1) {
      errors.push(
        createError(
          'SCHEMA_INVALID',
          `${chartPath}.series`,
          `${normalizedKind} charts must contain exactly one data series.`,
          'Use one series whose values align with chart.categories.'
        )
      );
    }

    for (const [seriesIndex, seriesInput] of series.entries()) {
      const seriesRecord = asRecord(seriesInput);
      const values = Array.isArray(seriesRecord?.values) ? seriesRecord.values : null;
      const name = seriesRecord?.name;

      if (!isNonEmptyString(name)) {
        errors.push(
          createError(
            'SCHEMA_INVALID',
            `${chartPath}.series[${seriesIndex}].name`,
            'Chart series name must be a non-empty string.',
            'Provide a concise series label.'
          )
        );
      }

      if (!values || values.length === 0 || !values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
        errors.push(
          createError(
            'SCHEMA_INVALID',
            `${chartPath}.series[${seriesIndex}].values`,
            'Chart series values must contain finite numbers.',
            'Provide numeric chart data. Do not leave chart values empty.'
          )
        );
        continue;
      }

      if (categories && values.length !== categories.length) {
        errors.push(
          createError(
            'SCHEMA_INVALID',
            `${chartPath}.series[${seriesIndex}].values`,
            `Chart series values must match the ${categories.length} chart categories.`,
            'Provide one numeric value per category label.'
          )
        );
      }
    }
  }

  if (typeof slideRecord.html !== 'string') {
    return;
  }

  const dom = new JSDOM(`<!doctype html><body>${slideRecord.html}</body>`);
  const document = dom.window.document;
  const containerIds = new Set<string>();
  for (const container of Array.from(document.querySelectorAll('[data-pepetex-chart-id], [data-pepetex-type="chart"][data-pepetex-id]'))) {
    const chartId = container.getAttribute('data-pepetex-chart-id')
      ?? container.getAttribute('data-pepetex-id');
    if (chartId?.trim()) {
      containerIds.add(chartId);
    }
  }

  for (const chartId of chartIds) {
    if (!containerIds.has(chartId)) {
      errors.push(
        createError(
          'SCHEMA_INVALID',
          `${basePath}.html`,
          `Chart "${chartId}" has structured data but no matching chart container in slide HTML.`,
          `Add a chart container with data-pepetex-type="chart", data-pepetex-id="${chartId}", and data-pepetex-chart-id="${chartId}".`
        )
      );
    }
  }

  for (const chartId of containerIds) {
    if (!chartIds.has(chartId)) {
      errors.push(
        createError(
          'SCHEMA_INVALID',
          `${basePath}.charts`,
          `Chart container "${chartId}" has no matching structured chart data.`,
          `Add a chart object with id "${chartId}", kind, categories, and series, or remove the chart container.`
        )
      );
    }
  }
}

function normalizeChartKindForValidation(rawKind: string): string {
  const kind = rawKind.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (kind.includes('donut') || kind.includes('doughnut') || kind.includes('ring')) return 'donut';
  if (kind.includes('pie') || kind.includes('sunburst') || kind.includes('treemap')) return 'pie';
  if (kind.includes('scatter') || kind.includes('bubble') || kind.includes('radar') || kind.includes('polar')) return 'scatter';
  if (kind.includes('area') || kind.includes('stream')) return 'area';
  if (kind.includes('line') || kind.includes('spline') || kind.includes('trend')) return 'line';
  return 'bar';
}

export function validateGeneratedDeckContract(input: ValidateDeckInput): SlideValidationResult[] {
  const schemaResult = validateGeneratedDeckSchema(input.deck);
  if (!schemaResult.ok) {
    return [
      {
        ok: false,
        severity: deriveSeverity(schemaResult.errors),
        errors: schemaResult.errors,
        warnings: [],
        elementIndex: []
      }
    ];
  }

  const deck = input.deck as { slides: Array<Record<string, unknown>> };
  const seenElementIds = new Set<string>();

  return deck.slides.map((slide) => {
    const validateInput: ValidateSlideInput = {
      html: String(slide.html),
      css: String(slide.css),
      slideId: String(slide.id),
      existingElementIds: seenElementIds
    };

    if (input.assetUrls) {
      validateInput.assetUrls = input.assetUrls;
    }

    if (input.allowedAssetHosts) {
      validateInput.allowedAssetHosts = input.allowedAssetHosts;
    }

    return validateSlide(validateInput);
  });
}

export interface UpdateSlideTextElementResult {
  html: string;
  title?: string;
}

export interface UpdateSlideElementStyleResult {
  html: string;
  css: string;
  title?: string;
}

export interface UpdateSlideElementAttributesResult {
  html: string;
  title?: string;
}

export interface ReplaceSlideElementHtmlResult {
  html: string;
  title?: string;
}

export function updateSlideTextElement(input: {
  html: string;
  elementId: string;
  text: string;
}): UpdateSlideTextElementResult {
  const dom = new JSDOM(`<!doctype html><body>${input.html}</body>`);
  const document = dom.window.document;
  const selector = `[data-pepetex-id="${escapeAttributeSelector(input.elementId)}"]`;
  const element = document.querySelector(selector);

  if (!(element instanceof dom.window.HTMLElement)) {
    throw new Error(`Slide element not found for update_text: ${input.elementId}`);
  }

  const elementType = element.getAttribute('data-pepetex-type');
  if (!isEditableTextElementType(elementType)) {
    throw new Error(
      `Slide element ${input.elementId} cannot be updated with update_text. Use replace_slide for layout or non-text changes.`
    );
  }

  element.textContent = input.text;
  const title = deriveSlideTitle(document);

  return {
    html: document.body.innerHTML.trim(),
    ...(title ? { title } : {})
  };
}

export function updateSlideElementStyle(input: {
  html: string;
  css: string;
  slideId: string;
  elementId: string;
  styles: Record<string, string>;
}): UpdateSlideElementStyleResult {
  const dom = new JSDOM(`<!doctype html><body>${input.html}</body>`);
  const document = dom.window.document;
  const element = findPepeteXElement(dom, document, input.elementId, 'update_element_style');

  if (!element.getAttribute('data-pepetex-type')) {
    throw new Error(`Slide element ${input.elementId} cannot be styled because it is missing data-pepetex-type.`);
  }

  const normalizedStyles = normalizePatchStyleMap(input.styles);
  const selector = `[data-pepetex-slide-id="${escapeAttributeSelector(input.slideId)}"] [data-pepetex-id="${escapeAttributeSelector(input.elementId)}"]`;
  const css = upsertScopedCssRule(input.css, selector, normalizedStyles);
  const title = deriveSlideTitle(document);

  return {
    html: document.body.innerHTML.trim(),
    css,
    ...(title ? { title } : {})
  };
}

export function updateSlideElementAttributes(input: {
  html: string;
  elementId: string;
  attributes: Record<string, string | null>;
}): UpdateSlideElementAttributesResult {
  const dom = new JSDOM(`<!doctype html><body>${input.html}</body>`);
  const document = dom.window.document;
  const element = findPepeteXElement(dom, document, input.elementId, 'update_element_attributes');

  for (const [rawName, rawValue] of Object.entries(input.attributes)) {
    const name = rawName.trim().toLowerCase();
    validatePatchAttributeName(name);

    if (rawValue === null) {
      element.removeAttribute(name);
      continue;
    }

    validatePatchAttributeValue(name, rawValue);
    element.setAttribute(name, rawValue);
  }

  const title = deriveSlideTitle(document);

  return {
    html: document.body.innerHTML.trim(),
    ...(title ? { title } : {})
  };
}

export function replaceSlideElementHtml(input: {
  html: string;
  css: string;
  slideId: string;
  elementId: string;
  replacementHtml: string;
}): ReplaceSlideElementHtmlResult {
  const dom = new JSDOM(`<!doctype html><body>${input.html}</body>`);
  const document = dom.window.document;
  const target = findPepeteXElement(dom, document, input.elementId, 'replace_element_html');
  const existingType = target.getAttribute('data-pepetex-type');

  if (!existingType) {
    throw new Error(`Slide element ${input.elementId} cannot be replaced because it is missing data-pepetex-type.`);
  }

  const replacementDom = new JSDOM(`<!doctype html><body>${input.replacementHtml}</body>`);
  const replacementDocument = replacementDom.window.document;
  const replacementElements = Array.from(replacementDocument.body.children);
  const significantTextNodes = Array.from(replacementDocument.body.childNodes).filter(
    (node) => node.nodeType === replacementDom.window.Node.TEXT_NODE && node.textContent?.trim()
  );

  if (replacementElements.length !== 1 || significantTextNodes.length > 0) {
    throw new Error('replace_element_html replacement must contain exactly one root element and no sibling text.');
  }

  const replacement = replacementElements[0];
  if (!(replacement instanceof replacementDom.window.Element)) {
    throw new Error('replace_element_html replacement root must be an element.');
  }

  const replacementId = replacement.getAttribute('data-pepetex-id');
  const replacementType = replacement.getAttribute('data-pepetex-type');
  if (replacementId && replacementId !== input.elementId) {
    throw new Error(`replace_element_html replacement must preserve data-pepetex-id="${input.elementId}".`);
  }
  if (replacementType && replacementType !== existingType) {
    throw new Error(`replace_element_html replacement must preserve data-pepetex-type="${existingType}".`);
  }

  replacement.setAttribute('data-pepetex-id', input.elementId);
  replacement.setAttribute('data-pepetex-type', existingType);
  target.replaceWith(document.importNode(replacement, true));

  const nextHtml = document.body.innerHTML.trim();
  const validation = validateSlide({
    html: nextHtml,
    css: input.css,
    slideId: input.slideId
  });
  const blockingErrors = validation.errors.filter((error) => error.code !== 'ASSET_NOT_FOUND');
  if (blockingErrors.length > 0) {
    throw new Error(
      `replace_element_html produced invalid slide HTML: ${blockingErrors.map((error) => error.message).join('; ')}`
    );
  }

  const title = deriveSlideTitle(document);

  return {
    html: validation.ok && validation.normalizedHtml ? validation.normalizedHtml : nextHtml,
    ...(title ? { title } : {})
  };
}

export function isEditableTextElementType(value: unknown): value is (typeof editableTextElementTypes)[number] {
  return typeof value === 'string' && editableTextElementTypes.includes(value as (typeof editableTextElementTypes)[number]);
}

function deriveSlideTitle(document: Document): string | undefined {
  return document.querySelector('[data-pepetex-type="headline"]')?.textContent?.trim() || undefined;
}

function escapeAttributeSelector(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function findPepeteXElement(
  dom: JSDOM,
  document: Document,
  elementId: string,
  operation: string
): Element {
  const selector = `[data-pepetex-id="${escapeAttributeSelector(elementId)}"]`;
  const element = document.querySelector(selector);

  if (!(element instanceof dom.window.Element)) {
    throw new Error(`Slide element not found for ${operation}: ${elementId}`);
  }

  return element;
}

function normalizePatchStyleMap(styles: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [rawProperty, rawValue] of Object.entries(styles)) {
    const property = rawProperty.trim().toLowerCase();
    const value = rawValue.trim();

    if (!property || !value) {
      throw new Error('update_element_style styles must contain non-empty property names and values.');
    }

    if (property.startsWith('--') || ignoredCssPropertySet.has(property)) {
      throw new Error(`CSS property "${property}" is not allowed for update_element_style.`);
    }

    if (containsForbiddenStyleValue(value.toLowerCase())) {
      throw new Error(`CSS value for "${property}" contains forbidden CSS.`);
    }

    normalized[property] = value;
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error('update_element_style requires at least one style declaration.');
  }

  return normalized;
}

function upsertScopedCssRule(
  css: string,
  selector: string,
  styles: Record<string, string>
): string {
  let root: Root;

  try {
    root = postcss.parse(css);
  } catch (error) {
    throw new Error(`Existing slide CSS could not be parsed: ${error instanceof Error ? error.message : 'unknown error'}.`);
  }

  let targetRule: Rule | null = null;
  root.walkRules((rule) => {
    if (!targetRule && rule.selector.trim() === selector) {
      targetRule = rule;
    }
  });

  if (!targetRule) {
    targetRule = postcss.rule({ selector });
    root.append(targetRule);
  }

  for (const [property, value] of Object.entries(styles)) {
    let updated = false;
    targetRule.walkDecls((declaration) => {
      if (declaration.prop.toLowerCase() !== property) return;

      if (!updated) {
        declaration.prop = property;
        declaration.value = value;
        updated = true;
      } else {
        declaration.remove();
      }
    });

    if (!updated) {
      targetRule.append(postcss.decl({ prop: property, value }));
    }
  }

  const validation = validateAndNormalizeCss(root.toString(), undefined, undefined);
  if (validation.errors.length > 0) {
    throw new Error(
      `update_element_style produced invalid slide CSS: ${validation.errors.map((error) => error.message).join('; ')}`
    );
  }

  return validation.normalizedCss;
}

const safePatchAttributeNames = new Set([
  'alt',
  'title',
  'aria-label',
  'aria-hidden',
  'role',
  'src'
]);

function validatePatchAttributeName(name: string): void {
  if (!safePatchAttributeNames.has(name)) {
    throw new Error(
      `Attribute "${name}" is not allowed for update_element_attributes. Use alt, title, aria-label, aria-hidden, role, or managed src.`
    );
  }
}

function validatePatchAttributeValue(name: string, value: string): void {
  if (name === 'aria-hidden' && value !== 'true' && value !== 'false') {
    throw new Error('aria-hidden must be "true" or "false".');
  }

  if (name === 'src') {
    const trimmed = value.trim();
    if (trimmed.startsWith('pepetex://asset/')) {
      const assetId = trimmed.slice('pepetex://asset/'.length).trim();
      if (!assetId) {
        throw new Error('src must reference a non-empty PepeteX asset id.');
      }
      return;
    }

    if (isAllowedDataImageUrl(trimmed)) {
      return;
    }

    throw new Error('src must be a PepeteX-managed asset reference or a safe data:image URL.');
  }

  if (value.toLowerCase().includes('javascript:') || value.toLowerCase().includes('vbscript:')) {
    throw new Error(`Attribute "${name}" contains a forbidden URL/script value.`);
  }
}

export function validateSlide(input: ValidateSlideInput): SlideValidationResult {
  const dom = new JSDOM(`<!doctype html><body>${input.html}</body>`);
  const document = dom.window.document;
  const state: MutableValidationState = {
    errors: [],
    warnings: [],
    elementIndex: [],
    seenElementIds:
      input.existingElementIds instanceof Set
        ? input.existingElementIds
        : new Set(input.existingElementIds ?? [])
  };

  const rootElements = Array.from(document.body.children);
  const significantTextNodes = Array.from(document.body.childNodes).filter(
    (node) => node.nodeType === dom.window.Node.TEXT_NODE && node.textContent?.trim()
  );

  if (rootElements.length !== 1 || significantTextNodes.length > 0) {
    state.errors.push(
      createError(
        'MISSING_ROOT',
        'slide.root',
        'Slide HTML must contain exactly one root element.',
        'Return a single section or div root for the slide.'
      )
    );
  }

  const root = rootElements[0];
  if (!root) {
    return finalizeValidationResult(state, input);
  }

  normalizeRootElement(root, input.slideId, state);
  sanitizeElementTree(root, root.tagName.toLowerCase(), input, state);
  validateElementContracts(root, input.slideId ?? root.getAttribute('data-pepetex-slide-id') ?? '', state);

  const cssResult = validateAndNormalizeCss(input.css, input.allowedAssetHosts, input.assetUrls);
  state.errors.push(...cssResult.errors);
  state.warnings.push(...cssResult.warnings);

  return finalizeValidationResult(
    state,
    input,
    dom.window.document.body.innerHTML,
    cssResult.normalizedCss
  );
}

export function resolveAssetUrl(
  source: string,
  options?: ResolveAssetUrlOptions
): AssetUrlResolutionResult {
  const trimmedSource = source.trim();

  if (isAllowedDataImageUrl(trimmedSource)) {
    return { ok: true, value: trimmedSource };
  }

  if (trimmedSource.startsWith('pepetex://asset/')) {
    const assetId = trimmedSource.slice('pepetex://asset/'.length).trim();
    const resolvedUrl = assetId ? options?.assetUrls?.[assetId] : undefined;

    if (!assetId || !resolvedUrl) {
      return {
        ok: false,
        error: createError(
          'ASSET_NOT_FOUND',
          source,
          `PepeteX asset "${assetId || '<missing>'}" was not found.`,
          'Provide a valid PepeteX asset id or attach the asset before rendering.'
        )
      };
    }

    if (isAllowedDataImageUrl(resolvedUrl)) {
      return { ok: true, value: resolvedUrl };
    }

    if (!isAllowedManagedAssetUrl(resolvedUrl, options?.allowedAssetHosts)) {
      return {
        ok: false,
        error: createError(
          'FORBIDDEN_URL',
          source,
          `Resolved asset URL "${resolvedUrl}" is not a PepeteX-managed asset URL.`,
          'Resolve PepeteX assets to signed or proxied PepeteX-managed HTTPS URLs.'
        )
      };
    }

    return { ok: true, value: resolvedUrl };
  }

  if (trimmedSource.startsWith('https://')) {
    if (isAllowedManagedAssetUrl(trimmedSource, options?.allowedAssetHosts)) {
      return { ok: true, value: trimmedSource };
    }

    return {
      ok: false,
      error: createError(
        'EXTERNAL_REQUEST_DETECTED',
        source,
        `External URL "${trimmedSource}" is not an approved PepeteX-managed asset URL.`,
        'Use pepetex://asset/{assetId} or an approved managed asset host.'
      )
    };
  }

  return {
    ok: false,
    error: createError(
      'FORBIDDEN_URL',
      source,
      `URL "${trimmedSource}" is not allowed in generated slide content.`,
      'Use pepetex://asset/{assetId}, an approved managed HTTPS asset URL, or a supported data:image URL.'
    )
  };
}

function finalizeValidationResult(
  state: MutableValidationState,
  _input: ValidateSlideInput,
  normalizedHtml?: string,
  normalizedCss?: string
): SlideValidationResult {
  return {
    ok: state.errors.length === 0,
    severity: deriveSeverity(state.errors, state.warnings),
    errors: dedupeErrors(state.errors),
    warnings: dedupeWarnings(state.warnings),
    ...(normalizedHtml !== undefined ? { normalizedHtml } : {}),
    ...(normalizedCss !== undefined ? { normalizedCss } : {}),
    elementIndex: state.elementIndex
  };
}

function normalizeRootElement(
  root: Element,
  slideId: string | undefined,
  state: MutableValidationState
): void {
  const rootTagName = root.tagName.toLowerCase();
  if (!(allowedRootTags as readonly string[]).includes(rootTagName)) {
    state.errors.push(
      createError(
        'MISSING_ROOT',
        rootTagName,
        `Slide root must be section or div, received <${rootTagName}>.`,
        'Wrap the slide content in a section or div root.'
      )
    );
  }

  if (!root.classList.contains('pepetex-slide')) {
    root.classList.add('pepetex-slide');
    state.warnings.push(
      createWarning(
        'SANITIZED_HTML',
        'slide.root.class',
        'Added missing pepetex-slide class to the slide root.'
      )
    );
  }

  const effectiveSlideId = slideId ?? root.getAttribute('data-pepetex-slide-id') ?? undefined;
  if (!effectiveSlideId) {
    state.errors.push(
      createError(
        'MISSING_ROOT',
        'slide.root.data-pepetex-slide-id',
        'Slide root must include data-pepetex-slide-id.',
        'Set data-pepetex-slide-id to the stable slide id.'
      )
    );
  } else if (root.getAttribute('data-pepetex-slide-id') !== effectiveSlideId) {
    root.setAttribute('data-pepetex-slide-id', effectiveSlideId);
    state.warnings.push(
      createWarning(
        'SANITIZED_HTML',
        'slide.root.data-pepetex-slide-id',
        'Normalized data-pepetex-slide-id on the slide root.'
      )
    );
  }

  const styleMap = parseInlineStyle(root.getAttribute('style') ?? '');
  const requiredStyles: Array<[string, string]> = [
    ['position', 'relative'],
    ['width', `${SLIDE_CANVAS.width}px`],
    ['height', `${SLIDE_CANVAS.height}px`],
    ['overflow', 'hidden']
  ];

  for (const [property, value] of requiredStyles) {
    if (styleMap.get(property) !== value) {
      styleMap.set(property, value);
      state.warnings.push(
        createWarning(
          'SANITIZED_HTML',
          `slide.root.style.${property}`,
          `Normalized root ${property} to ${value}.`
        )
      );
    }
  }

  root.setAttribute('style', serializeInlineStyle(styleMap));
}

function sanitizeElementTree(
  element: Element,
  path: string,
  input: ValidateSlideInput,
  state: MutableValidationState
): void {
  const tagName = element.tagName.toLowerCase();

  if (forbiddenHtmlTagSet.has(tagName)) {
    state.errors.push(
      createError(
        'FORBIDDEN_TAG',
        path,
        `Forbidden tag <${tagName}> detected in slide HTML.`,
        `Remove <${tagName}> and replace it with an allowed HTML structure.`
      )
    );
    element.remove();
    return;
  }

  sanitizeAttributes(element, path, input, state);

  if (tagName === 'a') {
    if (element.hasAttribute('href')) {
      element.removeAttribute('href');
      state.warnings.push(
        createWarning(
          'CONDITIONAL_ATTR_REMOVED',
          `${path}[href]`,
          'Removed href from <a>; anchors are visual only in generated slide HTML.'
        )
      );
    }
    state.warnings.push(
      createWarning(
        'CONDITIONAL_TAG_NORMALIZED',
        path,
        'Anchor tags are allowed only as non-navigating visual text.'
      )
    );
  }

  if (tagName === 'button') {
    for (const attributeName of ['form', 'formaction', 'formmethod', 'formenctype', 'type']) {
      if (element.hasAttribute(attributeName)) {
        element.removeAttribute(attributeName);
        state.warnings.push(
          createWarning(
            'CONDITIONAL_ATTR_REMOVED',
            `${path}[${attributeName}]`,
            `Removed ${attributeName} from <button>; buttons are visual only in generated slide HTML.`
          )
        );
      }
    }
  }

  for (const child of Array.from(element.children)) {
    const childTagName = child.tagName.toLowerCase();
    const siblingsWithSameTag = Array.from(child.parentElement?.children ?? []).filter(
      (candidate) => candidate.tagName.toLowerCase() === childTagName
    );
    const siblingIndex = siblingsWithSameTag.indexOf(child);
    sanitizeElementTree(child, `${path}>${childTagName}[${siblingIndex}]`, input, state);
  }
}

function sanitizeAttributes(
  element: Element,
  path: string,
  input: ValidateSlideInput,
  state: MutableValidationState
): void {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value;

    if (name.startsWith('on')) {
      state.errors.push(
        createError(
          'SCRIPT_DETECTED',
          `${path}[${name}]`,
          `Event handler attribute ${name} is forbidden.`,
          'Remove all inline event handlers from generated HTML.'
        )
      );
      element.removeAttribute(attribute.name);
      continue;
    }

    if (name === 'srcdoc') {
      state.errors.push(
        createError(
          'FORBIDDEN_ATTR',
          `${path}[srcdoc]`,
          'srcdoc is not allowed in generated slide HTML.',
          'Remove srcdoc and keep slide content inside the normal DOM tree.'
        )
      );
      element.removeAttribute(attribute.name);
      continue;
    }

    if (name === 'style') {
      const loweredStyle = value.toLowerCase();
      if (loweredStyle.includes('@import')) {
        state.errors.push(
          createError(
            'FORBIDDEN_CSS',
            `${path}[style]`,
            'Inline styles cannot contain @import.',
            'Remove @import from inline styles.'
          )
        );
      }

      if (containsForbiddenStyleValue(loweredStyle)) {
        state.errors.push(
          createError(
            'FORBIDDEN_CSS',
            `${path}[style]`,
            'Inline styles contain forbidden CSS.',
            'Remove forbidden CSS properties or values from inline styles.'
          )
        );
      }

      continue;
    }

    if (isUrlAttribute(name)) {
      const resolution = resolveAssetUrl(
        value,
        createResolveAssetUrlOptions(input.assetUrls, input.allowedAssetHosts)
      );

      if (!resolution.ok) {
        state.errors.push(withPath(resolution.error, `${path}[${name}]`));
        element.removeAttribute(attribute.name);
        continue;
      }

      element.setAttribute(attribute.name, resolution.value);
    }
  }
}

function validateElementContracts(
  root: Element,
  slideId: string,
  state: MutableValidationState
): void {
  const elementNodes = [root, ...Array.from(root.querySelectorAll('*'))];
  let targetableElementCount = 0;

  for (const element of elementNodes) {
    const tagName = element.tagName.toLowerCase();
    const elementId = element.getAttribute('data-pepetex-id');
    let elementType = element.getAttribute('data-pepetex-type');
    const path = describeElementPath(element);
    const snippet = snapshotElementSnippet(element);

    if (elementType) {
      const normalizedElementType = normalizePepeteXElementType(elementType);
      if (!normalizedElementType) {
        state.errors.push(
          createError(
            'SCHEMA_INVALID',
            path,
            `data-pepetex-type="${elementType}" is not allowed.`,
            `Use one of: ${allowedElementTypes.join(', ')}. Plain layout <div>s without data-pepetex-* are fine and do not need a type.`,
            snippet
          )
        );
        continue;
      }

      if (normalizedElementType !== elementType) {
        element.setAttribute('data-pepetex-type', normalizedElementType);
        state.warnings.push(
          createWarning(
            'SANITIZED_HTML',
            path,
            `data-pepetex-type="${elementType}" was normalized to "${normalizedElementType}".`
          )
        );
        elementType = normalizedElementType;
      }
    }

    if (elementType && !isAllowedElementType(elementType)) {
      state.errors.push(
        createError(
          'SCHEMA_INVALID',
          path,
          `data-pepetex-type="${elementType}" is not allowed.`,
          `Use one of: ${allowedElementTypes.join(', ')}. Plain layout <div>s without data-pepetex-* are fine and do not need a type.`,
          snippet
        )
      );
      continue;
    }

    if (elementId && !elementType) {
      state.errors.push(
        createError(
          'SCHEMA_INVALID',
          path,
          `Element "${elementId}" is missing data-pepetex-type.`,
          `Add data-pepetex-type with one of: ${allowedElementTypes.join(', ')}. If this element is just a layout container, remove data-pepetex-id instead — bare <div>s without data-pepetex-* are valid.`,
          snippet
        )
      );
      continue;
    }

    if (!elementId && elementType) {
      state.errors.push(
        createError(
          'MISSING_ELEMENT_ID',
          path,
          `Element with data-pepetex-type="${elementType}" is missing data-pepetex-id.`,
          'Add a stable data-pepetex-id to each editable/commentable element, or remove data-pepetex-type if this element is just structural.',
          snippet
        )
      );
      continue;
    }

    if (!elementId || !elementType) {
      continue;
    }

    if (state.seenElementIds.has(elementId)) {
      state.errors.push(
        createError(
          'DUPLICATE_ELEMENT_ID',
          path,
          `Duplicate data-pepetex-id "${elementId}" detected.`,
          'Use unique element ids within the deck revision.',
          snippet
        )
      );
      continue;
    }

    state.seenElementIds.add(elementId);
    state.elementIndex.push({
      id: elementId,
      type: elementType as PepeteXElementType,
      tagName,
      path,
      slideId
    });

    if (isMeaningfulTargetElement(element, elementType)) {
      targetableElementCount += 1;
    }
  }

  if (targetableElementCount === 0) {
    state.errors.push(
      createError(
        'MISSING_TARGETABLE_ELEMENT',
        'slide.targets',
        'Slide must include at least one stable, meaningful PepeteX target element.',
        'Add data-pepetex-id and data-pepetex-type to meaningful elements: headline, body, cta, card, chart, image, logo, group, diagram, metric, hero, badge, header, footer, list, quote, timeline, divider, shape, background, decorative, or table.'
      )
    );
  }
}

function isMeaningfulTargetElement(element: Element, elementType: string): boolean {
  if (!targetableElementTypeSet.has(elementType as PepeteXElementType)) {
    return false;
  }

  const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  if (elementType === 'headline' || elementType === 'body' || elementType === 'cta') {
    return text.length > 0;
  }

  if (elementType === 'image' || elementType === 'logo') {
    if (element.tagName.toLowerCase() === 'img') {
      return element.hasAttribute('src') || element.hasAttribute('alt');
    }

    return !!element.querySelector('img,[data-pepetex-type="image"],[data-pepetex-type="logo"]');
  }

  if (elementType === 'chart') {
    return text.length > 0 || !!element.querySelector('svg,table,[data-pepetex-type="chart"]');
  }

  // Shapes, backgrounds, decoratives, and tables are intentional visual elements
  // when the AI tags them — there is no reliable way to inspect their rendered
  // appearance from the static validator, so a tagged element with a stable id is
  // sufficient to count as a meaningful comment target.
  if (
    elementType === 'shape' ||
    elementType === 'background' ||
    elementType === 'decorative' ||
    elementType === 'table'
  ) {
    return true;
  }

  return text.length > 0 || !!element.querySelector('img,svg,table,[data-pepetex-id][data-pepetex-type]');
}

function validateAndNormalizeCss(
  css: string,
  allowedAssetHosts: string[] | undefined,
  assetUrls: Record<string, string> | undefined
): { normalizedCss: string; errors: ValidationError[]; warnings: ValidationWarning[] } {
  if (css.trim() === '') {
    return { normalizedCss: '', errors: [], warnings: [] };
  }

  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  let root: Root;

  try {
    root = postcss.parse(css);
  } catch (error) {
    return {
      normalizedCss: css,
      errors: [
        createError(
          'FORBIDDEN_CSS',
          'css',
          `CSS could not be parsed: ${error instanceof Error ? error.message : 'unknown error'}.`,
          'Return valid CSS scoped to the slide.'
        )
      ],
      warnings
    };
  }

  root.walkAtRules((rule) => {
    if (rule.name.toLowerCase() === 'import') {
      errors.push(
        createError(
          'FORBIDDEN_CSS',
          `css.@${rule.name}`,
          '@import is forbidden in slide CSS.',
          'Inline the required styles and remove @import.'
        )
      );
    } else {
      errors.push(
        createError(
          'FORBIDDEN_CSS',
          `css.@${rule.name}`,
          `At-rule @${rule.name} is not allowed in slide CSS.`,
          'Use plain scoped CSS rules without at-rules.'
        )
      );
    }
  });

  root.walkRules((rule) => validateCssRule(rule, allowedAssetHosts, assetUrls, errors, warnings));

  return {
    normalizedCss: root.toString(),
    errors,
    warnings
  };
}

function validateCssRule(
  rule: Rule,
  allowedAssetHosts: string[] | undefined,
  assetUrls: Record<string, string> | undefined,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const selector = rule.selector.trim();
  const scopedSelector = scopeCssSelectorList(selector);
  if (scopedSelector !== selector) {
    warnings.push(
      createWarning(
        'WARNING_CSS',
        `css.selector:${selector}`,
        'Slide CSS selector was automatically scoped to .pepetex-slide.'
      )
    );
    rule.selector = scopedSelector;
  }

  rule.walkDecls((decl) =>
    validateCssDeclaration(decl, allowedAssetHosts, assetUrls, errors, warnings)
  );
}

function validateCssDeclaration(
  declaration: Declaration,
  allowedAssetHosts: string[] | undefined,
  assetUrls: Record<string, string> | undefined,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const property = declaration.prop.toLowerCase();
  const value = declaration.value.trim();
  const normalizedValue = value.toLowerCase();
  const path = `css.${property}`;

  if (property.startsWith('--') || normalizedValue.includes('var(')) {
    errors.push(
      createError(
        'FORBIDDEN_CSS',
        path,
        'CSS variables are not allowed in final generated slide CSS.',
        'Resolve CSS variables before returning final slide CSS.'
      )
    );
    return;
  }

  if (ignoredCssPropertySet.has(property)) {
    warnings.push(
      createWarning(
        'WARNING_CSS',
        path,
        `${property}:${value} is ignored because dom-to-pptx exports only the current computed visual state.`
      )
    );
    declaration.remove();
    return;
  }

  if (pptxUnsupportedCssPropertySet.has(property)) {
    errors.push(
      createError(
        'FORBIDDEN_CSS',
        path,
        `${property}:${value} is forbidden — it renders in the HTML preview but is silently dropped by dom-to-pptx, causing PPTX export to diverge from the preview.`,
        'Replace with rgba() fills (e.g. rgba(R,G,B,0.30–0.55)) on solid layered shapes for the same translucent look in both preview and export.'
      )
    );
  }

  if (containsViewportUnit(normalizedValue)) {
    errors.push(
      createError(
        'FORBIDDEN_CSS',
        path,
        `CSS value "${value}" uses viewport units, which are forbidden for core slide layout.`,
        'Use fixed pixel-based slide geometry.'
      )
    );
  }

  if (property === 'position' && (normalizedValue === 'fixed' || normalizedValue === 'sticky')) {
    errors.push(
      createError(
        'FORBIDDEN_CSS',
        path,
        `position:${value} is not allowed in slide CSS.`,
        'Use relative or absolute positioning for slide layout.'
      )
    );
  }

  if (normalizedValue.includes('@import')) {
    errors.push(
      createError(
        'FORBIDDEN_CSS',
        path,
        '@import is forbidden in slide CSS.',
        'Inline styles directly and remove @import.'
      )
    );
  }

  if (property === 'overflow' && normalizedValue !== 'hidden') {
    warnings.push(
      createWarning(
        'WARNING_CSS',
        path,
        `overflow:${value} may allow content to escape the slide canvas — overflow:hidden is safest.`
      )
    );
  }

  if (property === 'transform' && !isDomToPptxSupportedTransform(normalizedValue)) {
    errors.push(
      createError(
        'FORBIDDEN_CSS',
        path,
        `transform:${value} is not allowed in slide CSS. Only rotate(...) maps reliably to PPTX; other transforms silently rasterize via html2canvas and lose precise positioning.`,
        'Replace transform: translate/scale/skew/matrix with explicit left/top/width/height/font-size declarations. Keep rotate(...) when needed.'
      )
    );
  }

  if (
    (property === 'left' || property === 'top' || property === 'right' || property === 'bottom')
    && /^-\s*\d/.test(normalizedValue)
  ) {
    errors.push(
      createError(
        'FORBIDDEN_CSS',
        path,
        `${property}:${value} is not allowed. Negative offsets place shapes off the slide canvas. The HTML preview hides the overflow with .pepetex-slide{overflow:hidden}, but PPTX shapes are not clipped by parent overflow, so decoratives render at full size in the wrong location.`,
        `Use a non-negative ${property} that keeps the shape fully inside the 1920×1080 canvas. For a "bleed" effect, position at the edge (e.g., ${property}: 0) and let the shape sit on the boundary.`
      )
    );
  }

  // Note: backdrop-filter and mix-blend-mode are already rejected above via
  // pptxUnsupportedCssPropertySet. clip-path / mask / filter are still rejected
  // here because dom-to-pptx either silently drops them or falls back to a
  // html2canvas PNG raster, which loses crispness in the exported PPTX.
  if (property === 'clip-path' || property === 'mask' || property === 'filter') {
    errors.push(
      createError(
        'FORBIDDEN_CSS',
        path,
        `${property}:${value} is forbidden — dom-to-pptx either drops it or rasterizes the region to PNG via html2canvas, producing low-fidelity output in the exported PPTX.`,
        'Achieve the visual with solid shapes, border-radius, box-shadow, or rgba() layered fills. For decorative cropping, position the asset at the canvas edge and let .pepetex-slide{overflow:hidden} clip it instead.'
      )
    );
  }

  if (normalizedValue.includes('radial-gradient(') || normalizedValue.includes('conic-gradient(')) {
    errors.push(
      createError(
        'FORBIDDEN_CSS',
        path,
        `CSS value "${value}" uses a gradient type (radial-gradient / conic-gradient) that dom-to-pptx cannot render natively; the PPTX export will diverge from the HTML preview.`,
        'Use linear-gradient(...) with multiple stops to approximate the same effect — linear gradients are fully supported by dom-to-pptx.'
      )
    );
  }

  if (property === 'text-shadow') {
    warnings.push(
      createWarning(
        'WARNING_CSS',
        path,
        `text-shadow:${value} has limited dom-to-pptx support and may not fully render in PPTX.`
      )
    );
  }

  for (const urlValue of extractCssUrls(value)) {
    const resolution = resolveAssetUrl(urlValue, createResolveAssetUrlOptions(assetUrls, allowedAssetHosts));

    if (!resolution.ok) {
      errors.push(withPath(resolution.error, `${path}.url(${urlValue})`));
      continue;
    }

    if (property === 'background-image') {
      warnings.push(
        createWarning(
          'WARNING_CSS',
          path,
          'background-image uses an asset URL and may reduce export fidelity if overused.'
        )
      );
    }
  }
}

function isDomToPptxSupportedTransform(normalizedValue: string): boolean {
  return normalizedValue === 'none' || /^rotate\(\s*-?\d*\.?\d+(deg|rad|turn)\s*\)$/.test(normalizedValue);
}

function scopeCssSelectorList(selector: string): string {
  return splitCssSelectorList(selector)
    .map((entry) => scopeCssSelector(entry))
    .join(', ');
}

function splitCssSelectorList(selector: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (char === '(' || char === '[') depth += 1;
    if ((char === ')' || char === ']') && depth > 0) depth -= 1;
    if (char === ',' && depth === 0) {
      entries.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }

  entries.push(selector.slice(start).trim());
  return entries.filter(isNonEmptyString);
}

function scopeCssSelector(selector: string): string {
  if (selector.includes('.pepetex-slide') || selector.includes('[data-pepetex-slide-id')) {
    return selector;
  }

  if (selector === ':root' || selector === 'html' || selector === 'body') {
    return '.pepetex-slide';
  }

  if (selector.startsWith('body ') || selector.startsWith('html ')) {
    return `.pepetex-slide ${selector.replace(/^(body|html)\s+/i, '')}`;
  }

  if (selector.startsWith('::') || selector.startsWith(':')) {
    return `.pepetex-slide${selector}`;
  }

  return `.pepetex-slide ${selector}`;
}

function parseInlineStyle(input: string): Map<string, string> {
  const styleMap = new Map<string, string>();

  for (const part of input.split(';')) {
    const separatorIndex = part.indexOf(':');
    if (separatorIndex < 0) {
      continue;
    }

    const property = part.slice(0, separatorIndex).trim().toLowerCase();
    const value = part.slice(separatorIndex + 1).trim();
    if (property && value) {
      styleMap.set(property, value);
    }
  }

  return styleMap;
}

function serializeInlineStyle(styleMap: Map<string, string>): string {
  return Array.from(styleMap.entries())
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ');
}

function containsForbiddenStyleValue(input: string): boolean {
  return (
    input.includes('expression(') ||
    input.includes('javascript:') ||
    input.includes('vbscript:') ||
    input.includes('url(http://') ||
    input.includes('url(file://') ||
    input.includes('url(blob:') ||
    input.includes('position: fixed') ||
    input.includes('position: sticky') ||
    input.includes('@import') ||
    containsViewportUnit(input)
  );
}

function containsViewportUnit(input: string): boolean {
  return /\b\d*\.?\d+(vw|vh|vmin|vmax)\b/.test(input);
}

function extractCssUrls(value: string): string[] {
  const matches = value.matchAll(/url\((['"]?)(.*?)\1\)/gi);
  return Array.from(matches, (match) => match[2]?.trim()).filter(isNonEmptyString);
}

function isAllowedDataImageUrl(source: string): boolean {
  return /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(source);
}

function isAllowedManagedAssetUrl(source: string, allowedAssetHosts: string[] | undefined): boolean {
  if (!source.startsWith('https://')) {
    return false;
  }

  try {
    const url = new URL(source);
    return !!allowedAssetHosts?.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

function isUrlAttribute(name: string): boolean {
  return name === 'src' || name === 'href' || name === 'xlink:href' || name === 'poster';
}

function describeElementPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current) {
    const tagName = current.tagName.toLowerCase();
    // Skip JSDOM document wrappers so paths begin at the slide root.
    if (tagName === 'html' || tagName === 'body') {
      current = current.parentElement;
      continue;
    }
    const siblingIndex = current.parentElement
      ? Array.from(current.parentElement.children)
          .filter((candidate) => candidate.tagName === current?.tagName)
          .indexOf(current)
      : 0;
    parts.unshift(`${tagName}[${siblingIndex}]`);
    current = current.parentElement;
  }

  return parts.join('>');
}

function deriveSeverity(
  errors: ValidationError[],
  warnings: ValidationWarning[] = []
): SlideValidationSeverity {
  if (errors.length > 0) {
    return errors.some((error) => blockedSeverityCodes.has(error.code))
      ? 'blocked'
      : 'repair_required';
  }

  if (warnings.length > 0) {
    return 'warning';
  }

  return 'ok';
}

function dedupeErrors(errors: ValidationError[]): ValidationError[] {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = `${error.code}|${error.path ?? ''}|${error.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeWarnings(warnings: ValidationWarning[]): ValidationWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}|${warning.path ?? ''}|${warning.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function withPath(error: ValidationError, path: string): ValidationError {
  return {
    ...error,
    path
  };
}

function createResolveAssetUrlOptions(
  assetUrls: Record<string, string> | undefined,
  allowedAssetHosts: string[] | undefined
): ResolveAssetUrlOptions | undefined {
  if (!assetUrls && !allowedAssetHosts) {
    return undefined;
  }

  const options: ResolveAssetUrlOptions = {};

  if (assetUrls) {
    options.assetUrls = assetUrls;
  }

  if (allowedAssetHosts) {
    options.allowedAssetHosts = allowedAssetHosts;
  }

  return options;
}

function createError(
  code: ValidationErrorCode,
  path: string | undefined,
  message: string,
  repairHint: string,
  elementSnippet?: string
): ValidationError {
  return {
    code,
    ...(path ? { path } : {}),
    message,
    repairHint,
    ...(elementSnippet ? { elementSnippet } : {})
  };
}

function snapshotElementSnippet(element: Element): string {
  const html = element.outerHTML ?? '';
  const collapsed = html.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 200) {
    return collapsed;
  }
  return `${collapsed.slice(0, 197)}...`;
}

function createWarning(
  code: ValidationWarningCode,
  path: string | undefined,
  message: string
): ValidationWarning {
  return {
    code,
    ...(path ? { path } : {}),
    message
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

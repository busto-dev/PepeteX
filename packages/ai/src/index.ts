export * from './mastra.js';
export * from './workflows/index.js';
export * from './agent/index.js';
export * from './compaction.js';

export const workflowNames = [
  'generateDeckWorkflow',
  'generateSingleSlideWorkflow',
  'regenerateSlideWorkflow',
  'applyCommentsWorkflow',
  'applyTweaksWorkflow',
  'generateImageWorkflow'
] as const;

export const askModeReasons = [
  'missing_deck_structure',
  'missing_slide_count',
  'missing_audience',
  'missing_language',
  'missing_design_direction',
  'missing_data_accuracy',
  'missing_file_usage',
  'missing_provider_model',
  'export_feasibility'
] as const;

// `slideAssetRoles`, `slideChartKinds`, and `slideDiagramKinds` are the *known/native*
// values the renderers and exporters know how to handle. The schema field types
// (SlideAssetRole, SlideChartKind, SlideDiagramKind) are open `string` so the AI can
// emit creative labels like "stacked-bar" or "histogram" without triggering structured
// output retries — downstream code normalizes via the `normalizeSlide*` helpers below.
export const slideAssetRoles = [
  'logo',
  'image',
  'background',
  'icon',
  'generated-image'
] as const;

export const slideChartKinds = [
  'bar',
  'line',
  'area',
  'pie',
  'donut',
  'scatter',
  'table-like'
] as const;

export const slideDiagramKinds = ['mermaid'] as const;

export const deckPatchOperationKinds = [
  'replace_slide',
  'insert_slide',
  'delete_slide',
  'move_slide',
  'update_text',
  'update_element_style',
  'update_element_attributes',
  'replace_element_html'
] as const;

export const insertSlidePositions = ['before', 'after', 'start', 'end', 'index'] as const;

export const aiResultModes = ['ask', 'deck', 'deck_patch', 'refusal'] as const;
export const pepeteXDeckSchemaVersion = 'pepetex.deck.v1' as const;
export const pepeteXPatchSchemaVersion = 'pepetex.patch.v1' as const;

export type WorkflowName = (typeof workflowNames)[number];
export type AskModeReason = (typeof askModeReasons)[number];
// Open string types: the AI may emit any non-empty string. Normalize via the
// `normalizeSlide*` helpers before handing to renderers/exporters.
export type SlideAssetRole = string;
export type SlideChartKind = string;
export type SlideDiagramKind = string;
// Closed unions for code paths that operate on the known/native set.
export type SupportedSlideAssetRole = (typeof slideAssetRoles)[number];
export type SupportedSlideChartKind = (typeof slideChartKinds)[number];
export type SupportedSlideDiagramKind = (typeof slideDiagramKinds)[number];
export type DeckPatchOperationKind = (typeof deckPatchOperationKinds)[number];
export type InsertSlidePosition = (typeof insertSlidePositions)[number];
export type AIResultMode = (typeof aiResultModes)[number];

const supportedSlideAssetRoleSet = new Set<string>(slideAssetRoles);
const supportedSlideChartKindSet = new Set<string>(slideChartKinds);
const supportedSlideDiagramKindSet = new Set<string>(slideDiagramKinds);

function canonicalizeKindString(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

export function isSupportedSlideAssetRole(value: string): value is SupportedSlideAssetRole {
  return supportedSlideAssetRoleSet.has(value);
}

export function isSupportedSlideChartKind(value: string): value is SupportedSlideChartKind {
  return supportedSlideChartKindSet.has(value);
}

export function isSupportedSlideDiagramKind(value: string): value is SupportedSlideDiagramKind {
  return supportedSlideDiagramKindSet.has(value);
}

export function normalizeSlideAssetRole(rawRole: string): SupportedSlideAssetRole {
  const role = canonicalizeKindString(rawRole);
  if (isSupportedSlideAssetRole(role)) {
    return role;
  }
  if (role.includes('logo') || role.includes('mark') || role.includes('wordmark')) return 'logo';
  if (role.includes('background') || role.includes('backdrop') || role.includes('bg')) return 'background';
  if (role.includes('icon') || role.includes('glyph') || role.includes('symbol')) return 'icon';
  if (role.includes('generated') || role.includes('ai') || role.includes('synth')) return 'generated-image';
  return 'image';
}

export function normalizeSlideChartKind(rawKind: string): SupportedSlideChartKind {
  const kind = canonicalizeKindString(rawKind);
  if (isSupportedSlideChartKind(kind)) {
    return kind;
  }
  if (
    kind.includes('histogram') ||
    kind.includes('column') ||
    kind.includes('waterfall') ||
    kind.includes('funnel') ||
    kind.includes('pareto') ||
    kind.includes('bar')
  ) {
    return 'bar';
  }
  if (kind.includes('area') || kind.includes('stream') || kind.includes('stacked-area')) {
    return 'area';
  }
  if (
    kind.includes('line') ||
    kind.includes('spline') ||
    kind.includes('combo') ||
    kind.includes('trend') ||
    kind.includes('candle') ||
    kind.includes('timeseries')
  ) {
    return 'line';
  }
  if (kind.includes('donut') || kind.includes('doughnut') || kind.includes('ring')) {
    return 'donut';
  }
  if (kind.includes('pie') || kind.includes('sunburst') || kind.includes('treemap')) {
    return 'pie';
  }
  if (
    kind.includes('scatter') ||
    kind.includes('bubble') ||
    kind.includes('radar') ||
    kind.includes('polar')
  ) {
    return 'scatter';
  }
  if (
    kind.includes('table') ||
    kind.includes('matrix') ||
    kind.includes('heatmap') ||
    kind.includes('grid')
  ) {
    return 'table-like';
  }
  return 'bar';
}

export function normalizeSlideDiagramKind(rawKind: string): SupportedSlideDiagramKind {
  // Mermaid is the only renderer; mermaid auto-detects the diagram type from the
  // source text (graph, flowchart, sequenceDiagram, gantt, etc.), so any diagram
  // kind label is best-effort treated as mermaid. The renderer will throw if the
  // source is not parseable, which the caller should catch.
  void rawKind;
  return 'mermaid';
}

export interface WorkflowDescriptor {
  name: WorkflowName;
  humanInTheLoop: boolean;
}

export interface AskModeOption {
  id: string;
  label: string;
  description?: string;
  value: unknown;
}

export interface AskModeResult {
  mode: 'ask';
  reason: AskModeReason;
  question: string;
  options: AskModeOption[];
  allowManualAnswer: boolean;
  required: boolean;
  assumptionIfSkipped?: string;
}

export interface SlideAssetRef {
  assetId: string;
  role: SlideAssetRole;
  required: boolean;
}

export interface SlideChartSeries {
  name: string;
  values: number[];
}

export interface SlideChartData {
  id: string;
  kind: SlideChartKind;
  title?: string;
  categories: string[];
  series: SlideChartSeries[];
  unit?: string;
  sourceRef?: string;
}

export interface SlideDiagramData {
  id: string;
  kind: SlideDiagramKind;
  source: string;
  title?: string;
}

export interface GeneratedSlide {
  id: string;
  title: string;
  html: string;
  css: string;
  assets: SlideAssetRef[];
  charts: SlideChartData[];
  diagrams: SlideDiagramData[];
  validationNotes?: string[];
}

export interface GeneratedDeckFont {
  id: string;
  fontFamily: string;
  fontAliases?: string[];
  mimeType: string;
  dataUrl: string;
  fontWeight?: number | string | null;
  fontStyle?: string | null;
}

export interface GeneratedDeck {
  title: string;
  language: string;
  aspectRatio: '16:9';
  canvas: {
    width: 1920;
    height: 1080;
  };
  slides: GeneratedSlide[];
  fonts?: GeneratedDeckFont[];
}

export interface ReplaceSlidePatchOperation {
  op: 'replace_slide';
  slideId: string;
  slide: GeneratedSlide;
  commentIds?: string[];
}

export interface InsertSlidePatchOperation {
  op: 'insert_slide';
  position: InsertSlidePosition;
  referenceSlideId?: string;
  index?: number;
  slide: GeneratedSlide;
  commentIds?: string[];
}

export interface DeleteSlidePatchOperation {
  op: 'delete_slide';
  slideId: string;
  commentIds?: string[];
}

export interface MoveSlidePatchOperation {
  op: 'move_slide';
  slideId: string;
  toIndex: number;
  commentIds?: string[];
}

export interface UpdateTextPatchOperation {
  op: 'update_text';
  slideId: string;
  elementId: string;
  text: string;
  commentIds?: string[];
}

export interface UpdateElementStylePatchOperation {
  op: 'update_element_style';
  slideId: string;
  elementId: string;
  styles: Record<string, string>;
  commentIds?: string[];
}

export interface UpdateElementAttributesPatchOperation {
  op: 'update_element_attributes';
  slideId: string;
  elementId: string;
  attributes: Record<string, string | null>;
  commentIds?: string[];
}

export interface ReplaceElementHtmlPatchOperation {
  op: 'replace_element_html';
  slideId: string;
  elementId: string;
  html: string;
  commentIds?: string[];
}

export type DeckPatchOperation =
  | ReplaceSlidePatchOperation
  | InsertSlidePatchOperation
  | DeleteSlidePatchOperation
  | MoveSlidePatchOperation
  | UpdateTextPatchOperation
  | UpdateElementStylePatchOperation
  | UpdateElementAttributesPatchOperation
  | ReplaceElementHtmlPatchOperation;

export interface DeckPatch {
  operations: DeckPatchOperation[];
}

export interface DeckGenerationResult {
  mode: 'deck';
  schemaVersion: typeof pepeteXDeckSchemaVersion;
  deck: GeneratedDeck;
  assumptions: string[];
  warnings: string[];
  designSystemRulesUsed: string[];
}

export interface DeckPatchResult {
  mode: 'deck_patch';
  schemaVersion: typeof pepeteXPatchSchemaVersion;
  patch: DeckPatch;
  assumptions: string[];
  warnings: string[];
  userVisibleSummary: string;
}

export interface RefusalResult {
  mode: 'refusal';
  reason: string;
  userVisibleMessage: string;
}

export type PepeteXAIResult =
  | AskModeResult
  | DeckGenerationResult
  | DeckPatchResult
  | RefusalResult;

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

export interface ValidationFailure {
  ok: false;
  errors: string[];
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export const workflowDescriptors: readonly WorkflowDescriptor[] = [
  { name: 'generateDeckWorkflow', humanInTheLoop: true },
  { name: 'generateSingleSlideWorkflow', humanInTheLoop: true },
  { name: 'regenerateSlideWorkflow', humanInTheLoop: true },
  { name: 'applyCommentsWorkflow', humanInTheLoop: true },
  { name: 'applyTweaksWorkflow', humanInTheLoop: true },
  { name: 'generateImageWorkflow', humanInTheLoop: false }
] as const;

export function validatePepeteXAIResult(input: unknown): ValidationResult<PepeteXAIResult> {
  const errors: string[] = [];
  const parsed = parsePepeteXAIResultInternal(input, 'result', errors);

  if (errors.length > 0 || !parsed) {
    return {
      ok: false,
      errors
    };
  }

  return {
    ok: true,
    value: parsed
  };
}

export function parsePepeteXAIResult(input: unknown): PepeteXAIResult {
  const result = validatePepeteXAIResult(input);

  if (!result.ok) {
    throw new Error(`PepeteX AI result validation failed: ${result.errors.join('; ')}`);
  }

  return result.value;
}

export function validateGeneratedDeck(input: unknown): ValidationResult<GeneratedDeck> {
  const errors: string[] = [];
  const parsed = parseGeneratedDeckInternal(input, 'deck', errors);

  if (errors.length > 0 || !parsed) {
    return {
      ok: false,
      errors
    };
  }

  return {
    ok: true,
    value: parsed
  };
}

function parsePepeteXAIResultInternal(
  input: unknown,
  path: string,
  errors: string[]
): PepeteXAIResult | null {
  const record = asRecord(input, path, errors);
  if (!record) {
    return null;
  }

  const mode = readEnum(record.mode, `${path}.mode`, aiResultModes, errors);
  if (!mode) {
    return null;
  }

  switch (mode) {
    case 'ask':
      return parseAskModeResult(record, path, errors);
    case 'deck':
      return parseDeckGenerationResult(record, path, errors);
    case 'deck_patch':
      return parseDeckPatchResult(record, path, errors);
    case 'refusal':
      return parseRefusalResult(record, path, errors);
  }
}

function parseAskModeResult(
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): AskModeResult | null {
  const reason = readEnum(record.reason, `${path}.reason`, askModeReasons, errors);
  const question = readString(record.question, `${path}.question`, errors);
  const options = readArray(record.options, `${path}.options`, errors)?.map((option, index) =>
    parseAskModeOption(option, `${path}.options[${index}]`, errors)
  );
  const allowManualAnswer = readBoolean(
    record.allowManualAnswer,
    `${path}.allowManualAnswer`,
    errors
  );
  const required = readBoolean(record.required, `${path}.required`, errors);
  const assumptionIfSkipped = readOptionalString(
    record.assumptionIfSkipped,
    `${path}.assumptionIfSkipped`,
    errors
  );

  if (!reason || !question || !options || allowManualAnswer === null || required === null) {
    return null;
  }

  if (options.some((option): option is null => option === null)) {
    return null;
  }

  const parsedOptions = options.filter(isPresent);

  return {
    mode: 'ask',
    reason,
    question,
    options: parsedOptions,
    allowManualAnswer,
    required,
    ...(assumptionIfSkipped ? { assumptionIfSkipped } : {})
  };
}

function parseAskModeOption(
  input: unknown,
  path: string,
  errors: string[]
): AskModeOption | null {
  const record = asRecord(input, path, errors);
  if (!record) {
    return null;
  }

  const id = readString(record.id, `${path}.id`, errors);
  const label = readString(record.label, `${path}.label`, errors);
  const description = readOptionalString(record.description, `${path}.description`, errors);

  if (!id || !label || !('value' in record)) {
    if (!('value' in record)) {
      errors.push(`${path}.value must be present.`);
    }

    return null;
  }

  return {
    id,
    label,
    ...(description ? { description } : {}),
    value: record.value
  };
}

function parseDeckGenerationResult(
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): DeckGenerationResult | null {
  const schemaVersion = readLiteral(
    record.schemaVersion,
    `${path}.schemaVersion`,
    pepeteXDeckSchemaVersion,
    errors
  );
  const deck = parseGeneratedDeckInternal(record.deck, `${path}.deck`, errors);
  const assumptions = readStringArrayOrDefault(record.assumptions, `${path}.assumptions`, errors);
  const warnings = readStringArrayOrDefault(record.warnings, `${path}.warnings`, errors);
  const designSystemRulesUsed = readStringArrayOrDefault(
    record.designSystemRulesUsed,
    `${path}.designSystemRulesUsed`,
    errors
  );

  if (!schemaVersion || !deck || !assumptions || !warnings || !designSystemRulesUsed) {
    return null;
  }

  return {
    mode: 'deck',
    schemaVersion,
    deck,
    assumptions,
    warnings,
    designSystemRulesUsed
  };
}

function parseGeneratedDeckInternal(
  input: unknown,
  path: string,
  errors: string[]
): GeneratedDeck | null {
  const record = asRecord(input, path, errors);
  if (!record) {
    return null;
  }

  const title = readString(record.title, `${path}.title`, errors);
  const language = readString(record.language, `${path}.language`, errors);
  const aspectRatio = readLiteral(record.aspectRatio, `${path}.aspectRatio`, '16:9', errors);
  const canvas = parseCanvas(record.canvas, `${path}.canvas`, errors);
  const slides = readArray(record.slides, `${path}.slides`, errors)?.map((slide, index) =>
    parseGeneratedSlide(slide, `${path}.slides[${index}]`, errors)
  );
  const fonts = record.fonts === undefined
    ? undefined
    : readArray(record.fonts, `${path}.fonts`, errors)?.map((font, index) =>
      parseGeneratedDeckFont(font, `${path}.fonts[${index}]`, errors)
    );

  if (!title || !language || !aspectRatio || !canvas || !slides || fonts?.some((font) => font === null)) {
    return null;
  }

  if (slides.some((slide): slide is null => slide === null)) {
    return null;
  }

  const parsedSlides = slides.filter(isPresent);

  return {
    title,
    language,
    aspectRatio,
    canvas,
    slides: parsedSlides,
    ...(fonts ? { fonts: fonts.filter(isPresent) } : {})
  };
}

function parseGeneratedDeckFont(
  input: unknown,
  path: string,
  errors: string[]
): GeneratedDeckFont | null {
  const record = asRecord(input, path, errors);
  if (!record) {
    return null;
  }

  const id = readString(record.id, `${path}.id`, errors);
  const fontFamily = readString(record.fontFamily, `${path}.fontFamily`, errors);
  const mimeType = readString(record.mimeType, `${path}.mimeType`, errors);
  const dataUrl = readString(record.dataUrl, `${path}.dataUrl`, errors);

  if (!id || !fontFamily || !mimeType || !dataUrl) {
    return null;
  }

  return {
    id,
    fontFamily,
    ...(Array.isArray(record.fontAliases)
      ? { fontAliases: record.fontAliases.filter((alias): alias is string => typeof alias === 'string' && alias.trim().length > 0) }
      : {}),
    mimeType,
    dataUrl,
    ...(typeof record.fontWeight === 'number' || typeof record.fontWeight === 'string' || record.fontWeight === null
      ? { fontWeight: record.fontWeight }
      : {}),
    ...(typeof record.fontStyle === 'string' || record.fontStyle === null
      ? { fontStyle: record.fontStyle }
      : {})
  };
}

function parseCanvas(
  input: unknown,
  path: string,
  errors: string[]
): GeneratedDeck['canvas'] | null {
  const record = asRecord(input, path, errors);
  if (!record) {
    return null;
  }

  const width = readLiteralNumber(record.width, `${path}.width`, 1920, errors);
  const height = readLiteralNumber(record.height, `${path}.height`, 1080, errors);

  if (width === null || height === null) {
    return null;
  }

  return {
    width: 1920,
    height: 1080
  };
}

function parseGeneratedSlide(
  input: unknown,
  path: string,
  errors: string[]
): GeneratedSlide | null {
  const record = asRecord(input, path, errors);
  if (!record) {
    return null;
  }

  const id = readString(record.id, `${path}.id`, errors);
  const title = readString(record.title, `${path}.title`, errors);
  const html = readString(record.html, `${path}.html`, errors);
  const css = readStringAllowEmpty(record.css, `${path}.css`, errors);
  const assets = readArrayOrDefault(record.assets, `${path}.assets`, errors)?.map((asset, index) =>
    parseSlideAssetRef(asset, `${path}.assets[${index}]`, errors)
  );
  const charts = readArrayOrDefault(record.charts, `${path}.charts`, errors)?.map((chart, index) =>
    parseSlideChartData(chart, `${path}.charts[${index}]`, errors)
  );
  const diagrams = readArrayOrDefault(record.diagrams, `${path}.diagrams`, errors)?.map((diagram, index) =>
    parseSlideDiagramData(diagram, `${path}.diagrams[${index}]`, errors)
  );
  const validationNotes = readOptionalStringArray(
    record.validationNotes,
    `${path}.validationNotes`,
    errors
  );

  if (!id || !title || !html || css === null || !assets || !charts || !diagrams) {
    return null;
  }

  if (assets.some((asset): asset is null => asset === null)) {
    return null;
  }

  if (charts.some((chart): chart is null => chart === null)) {
    return null;
  }

  if (diagrams.some((diagram): diagram is null => diagram === null)) {
    return null;
  }

  const parsedAssets = assets.filter(isPresent);
  const parsedCharts = charts.filter(isPresent);
  const parsedDiagrams = diagrams.filter(isPresent);

  return {
    id,
    title,
    html,
    css,
    assets: parsedAssets,
    charts: parsedCharts,
    diagrams: parsedDiagrams,
    ...(validationNotes ? { validationNotes } : {})
  };
}

function parseSlideAssetRef(
  input: unknown,
  path: string,
  errors: string[]
): SlideAssetRef | null {
  const record = asRecord(input, path, errors);
  if (!record) {
    return null;
  }

  const assetId = readString(record.assetId, `${path}.assetId`, errors);
  const role = readString(record.role, `${path}.role`, errors);
  const required = readBoolean(record.required, `${path}.required`, errors);

  if (!assetId || !role || required === null) {
    return null;
  }

  return {
    assetId,
    role,
    required
  };
}

function parseSlideChartData(
  input: unknown,
  path: string,
  errors: string[]
): SlideChartData | null {
  const record = asRecord(input, path, errors);
  if (!record) {
    return null;
  }

  const id = readString(record.id, `${path}.id`, errors);
  const kind = readString(record.kind, `${path}.kind`, errors);
  const title = readOptionalString(record.title, `${path}.title`, errors);
  const categories = readStringArray(record.categories, `${path}.categories`, errors);
  const series = readArray(record.series, `${path}.series`, errors)?.map((entry, index) =>
    parseSlideChartSeries(entry, `${path}.series[${index}]`, errors)
  );
  const unit = readOptionalString(record.unit, `${path}.unit`, errors);
  const sourceRef = readOptionalString(record.sourceRef, `${path}.sourceRef`, errors);

  if (!id || !kind || !categories || !series) {
    return null;
  }

  if (series.some((entry): entry is null => entry === null)) {
    return null;
  }

  const parsedSeries = series.filter(isPresent);
  validateSlideChartShape({ id, kind, categories, series: parsedSeries }, path, errors);

  return {
    id,
    kind,
    ...(title ? { title } : {}),
    categories,
    series: parsedSeries,
    ...(unit ? { unit } : {}),
    ...(sourceRef ? { sourceRef } : {})
  };
}

function validateSlideChartShape(
  chart: Pick<SlideChartData, 'id' | 'kind' | 'categories' | 'series'>,
  path: string,
  errors: string[]
): void {
  if (chart.categories.length === 0) {
    errors.push(`${path}.categories must contain at least one category.`);
  }

  if (chart.series.length === 0) {
    errors.push(`${path}.series must contain at least one series.`);
    return;
  }

  const normalizedKind = normalizeSlideChartKind(chart.kind);
  if ((normalizedKind === 'pie' || normalizedKind === 'donut') && chart.series.length !== 1) {
    errors.push(`${path}.series must contain exactly one series for ${normalizedKind} charts.`);
  }

  for (const [seriesIndex, seriesEntry] of chart.series.entries()) {
    if (seriesEntry.values.length === 0) {
      errors.push(`${path}.series[${seriesIndex}].values must contain at least one value.`);
    }

    if (seriesEntry.values.length !== chart.categories.length) {
      errors.push(
        `${path}.series[${seriesIndex}].values must contain exactly ${chart.categories.length} value(s) to match categories.`
      );
    }
  }
}

function parseSlideChartSeries(
  input: unknown,
  path: string,
  errors: string[]
): SlideChartSeries | null {
  const record = asRecord(input, path, errors);
  if (!record) {
    return null;
  }

  const name = readString(record.name, `${path}.name`, errors);
  const values = readNumberArray(record.values, `${path}.values`, errors);

  if (!name || !values) {
    return null;
  }

  return {
    name,
    values
  };
}

function parseSlideDiagramData(
  input: unknown,
  path: string,
  errors: string[]
): SlideDiagramData | null {
  const record = asRecord(input, path, errors);
  if (!record) {
    return null;
  }

  const id = readString(record.id, `${path}.id`, errors);
  const kind = readString(record.kind, `${path}.kind`, errors);
  const source = readString(record.source, `${path}.source`, errors);
  const title = readOptionalString(record.title, `${path}.title`, errors);

  if (!id || !kind || !source) {
    return null;
  }

  return {
    id,
    kind,
    source,
    ...(title ? { title } : {})
  };
}

function parseDeckPatchResult(
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): DeckPatchResult | null {
  const schemaVersion = readLiteral(
    record.schemaVersion,
    `${path}.schemaVersion`,
    pepeteXPatchSchemaVersion,
    errors
  );
  const patch = parseDeckPatch(record.patch, `${path}.patch`, errors);
  const assumptions = readStringArrayOrDefault(record.assumptions, `${path}.assumptions`, errors);
  const warnings = readStringArrayOrDefault(record.warnings, `${path}.warnings`, errors);
  const userVisibleSummary = readString(
    record.userVisibleSummary,
    `${path}.userVisibleSummary`,
    errors
  );

  if (!schemaVersion || !patch || !assumptions || !warnings || !userVisibleSummary) {
    return null;
  }

  return {
    mode: 'deck_patch',
    schemaVersion,
    patch,
    assumptions,
    warnings,
    userVisibleSummary
  };
}

function parseDeckPatch(input: unknown, path: string, errors: string[]): DeckPatch | null {
  const record = asRecord(input, path, errors);
  if (!record) {
    return null;
  }

  const operations = readArray(record.operations, `${path}.operations`, errors)?.map(
    (operation, index) => parseDeckPatchOperation(operation, `${path}.operations[${index}]`, errors)
  );

  if (!operations) {
    return null;
  }

  if (operations.some((operation): operation is null => operation === null)) {
    return null;
  }

  const parsedOperations = operations.filter(isPresent);

  return {
    operations: parsedOperations
  };
}

function parseDeckPatchOperation(
  input: unknown,
  path: string,
  errors: string[]
): DeckPatchOperation | null {
  const record = asRecord(input, path, errors);
  if (!record) {
    return null;
  }

  const op = readDeckPatchOperationKind(record, `${path}.op`, errors);
  if (!op) {
    return null;
  }

  switch (op) {
    case 'replace_slide': {
      const slideId = readString(record.slideId, `${path}.slideId`, errors);
      const slide = parseGeneratedSlide(record.slide, `${path}.slide`, errors);
      const commentIds = readOptionalCommentIds(record.commentIds, `${path}.commentIds`, errors);

      if (!slideId || !slide) {
        return null;
      }

      return {
        op,
        slideId,
        slide,
        ...(commentIds ? { commentIds } : {})
      };
    }
    case 'insert_slide': {
      const position = readEnum(record.position, `${path}.position`, insertSlidePositions, errors);
      const referenceSlideId = readOptionalString(
        record.referenceSlideId,
        `${path}.referenceSlideId`,
        errors
      );
      const index = readOptionalNonNegativeInteger(record.index, `${path}.index`, errors);
      const slide = parseGeneratedSlide(record.slide, `${path}.slide`, errors);
      const commentIds = readOptionalCommentIds(record.commentIds, `${path}.commentIds`, errors);

      if (!position || !slide) {
        return null;
      }

      if ((position === 'before' || position === 'after') && !referenceSlideId) {
        errors.push(`${path}.referenceSlideId is required when position is "${position}".`);
        return null;
      }

      if (position === 'index' && index === undefined) {
        errors.push(`${path}.index is required when position is "index".`);
        return null;
      }

      return {
        op,
        position,
        ...(referenceSlideId ? { referenceSlideId } : {}),
        ...(index !== undefined ? { index } : {}),
        slide,
        ...(commentIds ? { commentIds } : {})
      };
    }
    case 'delete_slide': {
      const slideId = readString(record.slideId, `${path}.slideId`, errors);
      const commentIds = readOptionalCommentIds(record.commentIds, `${path}.commentIds`, errors);

      if (!slideId) {
        return null;
      }

      return {
        op,
        slideId,
        ...(commentIds ? { commentIds } : {})
      };
    }
    case 'move_slide': {
      const slideId = readString(record.slideId, `${path}.slideId`, errors);
      const toIndex = readNonNegativeInteger(record.toIndex, `${path}.toIndex`, errors);
      const commentIds = readOptionalCommentIds(record.commentIds, `${path}.commentIds`, errors);

      if (!slideId || toIndex === null) {
        return null;
      }

      return {
        op,
        slideId,
        toIndex,
        ...(commentIds ? { commentIds } : {})
      };
    }
    case 'update_text': {
      const slideId = readString(record.slideId, `${path}.slideId`, errors);
      const elementId = readString(record.elementId, `${path}.elementId`, errors);
      const text = readString(
        record.text ?? record.newText ?? record.content ?? record.value,
        `${path}.text`,
        errors
      );
      const commentIds = readOptionalCommentIds(record.commentIds, `${path}.commentIds`, errors);

      if (!slideId || !elementId || !text) {
        return null;
      }

      return {
        op,
        slideId,
        elementId,
        text,
        ...(commentIds ? { commentIds } : {})
      };
    }
    case 'update_element_style': {
      const slideId = readString(record.slideId, `${path}.slideId`, errors);
      const elementId = readString(record.elementId, `${path}.elementId`, errors);
      const styles = readStringRecord(record.styles ?? record.style, `${path}.styles`, errors);
      const commentIds = readOptionalCommentIds(record.commentIds, `${path}.commentIds`, errors);

      if (!slideId || !elementId || !styles) {
        return null;
      }

      return {
        op,
        slideId,
        elementId,
        styles,
        ...(commentIds ? { commentIds } : {})
      };
    }
    case 'update_element_attributes': {
      const slideId = readString(record.slideId, `${path}.slideId`, errors);
      const elementId = readString(record.elementId, `${path}.elementId`, errors);
      const attributes = readNullableStringRecord(
        record.attributes ?? record.attrs,
        `${path}.attributes`,
        errors
      );
      const commentIds = readOptionalCommentIds(record.commentIds, `${path}.commentIds`, errors);

      if (!slideId || !elementId || !attributes) {
        return null;
      }

      return {
        op,
        slideId,
        elementId,
        attributes,
        ...(commentIds ? { commentIds } : {})
      };
    }
    case 'replace_element_html': {
      const slideId = readString(record.slideId, `${path}.slideId`, errors);
      const elementId = readString(record.elementId, `${path}.elementId`, errors);
      const html = readString(
        record.html ?? record.replacementHtml ?? record.elementHtml ?? record.content,
        `${path}.html`,
        errors
      );
      const commentIds = readOptionalCommentIds(record.commentIds, `${path}.commentIds`, errors);

      if (!slideId || !elementId || !html) {
        return null;
      }

      return {
        op,
        slideId,
        elementId,
        html,
        ...(commentIds ? { commentIds } : {})
      };
    }
  }
}

function readDeckPatchOperationKind(
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): DeckPatchOperationKind | null {
  if (typeof record.op !== 'string') {
    errors.push(`${path} must be one of: ${deckPatchOperationKinds.join(', ')}.`);
    return null;
  }

  if (deckPatchOperationKinds.includes(record.op as DeckPatchOperationKind)) {
    return record.op as DeckPatchOperationKind;
  }

  const normalized = record.op.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['edit_element', 'modify_element', 'update_element'].includes(normalized)) {
    if (isRecord(record.styles) || isRecord(record.style)) return 'update_element_style';
    if (isRecord(record.attributes) || isRecord(record.attrs)) return 'update_element_attributes';
    if (
      typeof (record.html ?? record.replacementHtml ?? record.elementHtml) === 'string'
    ) {
      return 'replace_element_html';
    }
    return 'update_text';
  }

  const aliases: Record<string, DeckPatchOperationKind> = {
    add_slide: 'insert_slide',
    create_slide: 'insert_slide',
    insert: 'insert_slide',
    remove_slide: 'delete_slide',
    delete: 'delete_slide',
    reorder_slide: 'move_slide',
    move: 'move_slide',
    edit_text: 'update_text',
    change_text: 'update_text',
    replace_text: 'update_text',
    update_copy: 'update_text',
    update_element_text: 'update_text',
    modify_text: 'update_text',
    set_style: 'update_element_style',
    style_element: 'update_element_style',
    update_style: 'update_element_style',
    update_element_style: 'update_element_style',
    change_element_style: 'update_element_style',
    change_color: 'update_element_style',
    set_attribute: 'update_element_attributes',
    set_attributes: 'update_element_attributes',
    update_attribute: 'update_element_attributes',
    update_attributes: 'update_element_attributes',
    update_attrs: 'update_element_attributes',
    set_attrs: 'update_element_attributes',
    replace_element: 'replace_element_html',
    replace_element_content: 'replace_element_html',
    edit_element_html: 'replace_element_html',
    update_element_html: 'replace_element_html',
    change_slide: 'replace_slide',
    redesign_slide: 'replace_slide',
    edit_slide: 'replace_slide',
    modify_slide: 'replace_slide',
    restyle_slide: 'replace_slide',
    update_slide: 'replace_slide',
    rewrite_slide: 'replace_slide'
  };

  const alias = aliases[normalized];
  if (alias) return alias;

  if (record.slide && record.slideId) return 'replace_slide';
  if (record.slide && record.position) return 'insert_slide';
  if (record.elementId && (isRecord(record.styles) || isRecord(record.style))) {
    return 'update_element_style';
  }
  if (record.elementId && (isRecord(record.attributes) || isRecord(record.attrs))) {
    return 'update_element_attributes';
  }
  if (
    record.elementId &&
    typeof (record.html ?? record.replacementHtml ?? record.elementHtml) === 'string'
  ) {
    return 'replace_element_html';
  }
  if (record.elementId && (record.text ?? record.newText ?? record.content ?? record.value)) {
    return 'update_text';
  }

  errors.push(`${path} must be one of: ${deckPatchOperationKinds.join(', ')}.`);
  return null;
}

function parseRefusalResult(
  record: Record<string, unknown>,
  path: string,
  errors: string[]
): RefusalResult | null {
  const reason = readString(record.reason, `${path}.reason`, errors);
  const userVisibleMessage = readString(
    record.userVisibleMessage,
    `${path}.userVisibleMessage`,
    errors
  );

  if (!reason || !userVisibleMessage) {
    return null;
  }

  return {
    mode: 'refusal',
    reason,
    userVisibleMessage
  };
}

function asRecord(
  input: unknown,
  path: string,
  errors: string[]
): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push(`${path} must be an object.`);
    return null;
  }

  return input as Record<string, unknown>;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === 'object' && !Array.isArray(input);
}

function readString(input: unknown, path: string, errors: string[]): string | null {
  if (typeof input !== 'string' || input.trim() === '') {
    errors.push(`${path} must be a non-empty string.`);
    return null;
  }

  return input;
}

function readStringAllowEmpty(input: unknown, path: string, errors: string[]): string | null {
  if (typeof input !== 'string') {
    errors.push(`${path} must be a string.`);
    return null;
  }

  return input;
}

function readOptionalString(
  input: unknown,
  path: string,
  errors: string[]
): string | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }

  return readString(input, path, errors) ?? undefined;
}

function readBoolean(input: unknown, path: string, errors: string[]): boolean | null {
  if (typeof input !== 'boolean') {
    errors.push(`${path} must be a boolean.`);
    return null;
  }

  return input;
}

function readArray(input: unknown, path: string, errors: string[]): unknown[] | null {
  if (!Array.isArray(input)) {
    errors.push(`${path} must be an array.`);
    return null;
  }

  return input;
}

function readArrayOrDefault(
  input: unknown,
  path: string,
  errors: string[]
): unknown[] | null {
  if (input === undefined || input === null) {
    return [];
  }

  return readArray(input, path, errors);
}

function readStringArray(input: unknown, path: string, errors: string[]): string[] | null {
  const values = readArray(input, path, errors);
  if (!values) {
    return null;
  }

  const parsed: string[] = [];
  for (const [index, value] of values.entries()) {
    const parsedValue = readString(value, `${path}[${index}]`, errors);
    if (parsedValue === null) {
      return null;
    }

    parsed.push(parsedValue);
  }

  return parsed;
}

function readStringArrayOrDefault(
  input: unknown,
  path: string,
  errors: string[]
): string[] | null {
  if (input === undefined || input === null) {
    return [];
  }

  return readStringArray(input, path, errors);
}

function readOptionalStringArray(
  input: unknown,
  path: string,
  errors: string[]
): string[] | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }

  return readStringArray(input, path, errors) ?? undefined;
}

function readOptionalCommentIds(
  input: unknown,
  path: string,
  errors: string[]
): string[] | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }

  const values = readStringArray(input, path, errors);
  if (!values) {
    return undefined;
  }

  const uniqueValues = Array.from(new Set(values.filter((value) => value.trim().length > 0)));
  return uniqueValues.length > 0 ? uniqueValues : undefined;
}

function readStringRecord(
  input: unknown,
  path: string,
  errors: string[]
): Record<string, string> | null {
  const record = asRecord(input, path, errors);
  if (!record) {
    return null;
  }

  const parsed: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${path}.${key} must be a non-empty string.`);
      return null;
    }
    parsed[key] = value;
  }

  if (Object.keys(parsed).length === 0) {
    errors.push(`${path} must contain at least one entry.`);
    return null;
  }

  return parsed;
}

function readNullableStringRecord(
  input: unknown,
  path: string,
  errors: string[]
): Record<string, string | null> | null {
  const record = asRecord(input, path, errors);
  if (!record) {
    return null;
  }

  const parsed: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== null && typeof value !== 'string') {
      errors.push(`${path}.${key} must be a string or null.`);
      return null;
    }
    parsed[key] = value;
  }

  if (Object.keys(parsed).length === 0) {
    errors.push(`${path} must contain at least one entry.`);
    return null;
  }

  return parsed;
}

function readNumberArray(input: unknown, path: string, errors: string[]): number[] | null {
  const values = readArray(input, path, errors);
  if (!values) {
    return null;
  }

  const parsed: number[] = [];
  for (const [index, value] of values.entries()) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${path}[${index}] must be a finite number.`);
      return null;
    }

    parsed.push(value);
  }

  return parsed;
}

function readEnum<const T extends readonly string[]>(
  input: unknown,
  path: string,
  allowedValues: T,
  errors: string[]
): T[number] | null {
  if (typeof input !== 'string' || !allowedValues.includes(input)) {
    errors.push(`${path} must be one of: ${allowedValues.join(', ')}.`);
    return null;
  }

  return input as T[number];
}

function readLiteral<const T extends string>(
  input: unknown,
  path: string,
  expected: T,
  errors: string[]
): T | null {
  if (input !== expected) {
    errors.push(`${path} must equal "${expected}".`);
    return null;
  }

  return expected;
}

function readLiteralNumber(
  input: unknown,
  path: string,
  expected: number,
  errors: string[]
): number | null {
  if (input !== expected) {
    errors.push(`${path} must equal ${expected}.`);
    return null;
  }

  return expected;
}

function readNonNegativeInteger(
  input: unknown,
  path: string,
  errors: string[]
): number | null {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 0) {
    errors.push(`${path} must be a non-negative integer.`);
    return null;
  }

  return input;
}

function readOptionalNonNegativeInteger(
  input: unknown,
  path: string,
  errors: string[]
): number | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }

  return readNonNegativeInteger(input, path, errors) ?? undefined;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

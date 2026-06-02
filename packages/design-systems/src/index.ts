export const designSystemScopes = ['personal', 'workspace', 'global'] as const;
export type DesignSystemScopeInput = (typeof designSystemScopes)[number];

export const designSystemComponentKinds = [
  'background',
  'badge',
  'card',
  'chart',
  'cta',
  'divider',
  'footer',
  'header',
  'hero',
  'list',
  'metric',
  'quote',
  'table',
  'timeline'
] as const;
export type DesignSystemComponentKind = (typeof designSystemComponentKinds)[number];

export interface DesignSystemColorToken {
  id: string;
  label: string;
  value: string;
  usage: string | null;
}

export interface DesignSystemTypographyToken {
  id: string;
  label: string;
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number;
  lineHeight: number;
  fontAssetId?: string | null;
}

export interface DesignSystemSpacingToken {
  id: string;
  label: string;
  valuePx: number;
}

export interface DesignSystemTokenSet {
  colors: DesignSystemColorToken[];
  typography: DesignSystemTypographyToken[];
  spacing: DesignSystemSpacingToken[];
}

export interface DesignSystemComponent {
  id: string;
  name: string;
  kind: DesignSystemComponentKind;
  description: string | null;
  html: string;
  css: string;
}

export interface DesignSystemExampleSlide {
  id: string;
  name: string;
  purpose: string;
  html: string;
  css: string;
}

export interface DesignSystemSlideArchetype {
  id: string;
  name: string;
  purpose: string;
  recommendedComponentIds: string[];
  layoutGuidance: string;
  baseCss: string;
  exampleSlideId: string | null;
}

export const designSystemRuleScopes = ['color', 'typography', 'spacing', 'layout', 'component', 'asset'] as const;
export type DesignSystemRuleScope = (typeof designSystemRuleScopes)[number];

export const designSystemRuleTypes = ['must', 'must-not', 'should'] as const;
export type DesignSystemRuleType = (typeof designSystemRuleTypes)[number];

export interface DesignSystemRule {
  id: string;
  scope: DesignSystemRuleScope;
  type: DesignSystemRuleType;
  description: string;
  targetValue: string | null;
}

export interface DesignSystemDocument {
  tokens: DesignSystemTokenSet;
  components: DesignSystemComponent[];
  exampleSlides: DesignSystemExampleSlide[];
  archetypes: DesignSystemSlideArchetype[];
  rules: DesignSystemRule[];
}

export interface DesignSystemDocumentCounts {
  colorCount: number;
  typographyCount: number;
  spacingCount: number;
  componentCount: number;
  exampleSlideCount: number;
  archetypeCount: number;
  ruleCount: number;
}

export class DesignSystemValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignSystemValidationError';
  }
}

export { validateDesignSystemCompliance, type DesignSystemComplianceIssue } from './compliance';

export * from './document.js';

export function isDesignSystemScopeInput(value: string): value is DesignSystemScopeInput {
  return designSystemScopes.includes(value as DesignSystemScopeInput);
}

export interface DesignSystemNormalizeOptions {
  enforceQuality?: boolean;
}

export function normalizeDesignSystemDocument(
  input: unknown,
  options: DesignSystemNormalizeOptions = {}
): DesignSystemDocument {
  const candidate = asRecord(input, 'Design system content is required.');

  return {
    tokens: normalizeDesignSystemTokens(candidate.tokens),
    components: normalizeDesignSystemComponents(candidate.components, options),
    exampleSlides: normalizeDesignSystemExampleSlides(candidate.exampleSlides, options),
    archetypes: normalizeDesignSystemArchetypes(candidate.archetypes),
    rules: normalizeDesignSystemRules(candidate.rules)
  };
}

export function normalizeDesignSystemTokens(input: unknown): DesignSystemTokenSet {
  const candidate = asRecord(input, 'Design system tokens are required.');

  return {
    colors: normalizeColorTokens(candidate.colors),
    typography: normalizeTypographyTokens(candidate.typography),
    spacing: normalizeSpacingTokens(candidate.spacing)
  };
}

export function normalizeDesignSystemComponents(
  input: unknown,
  options: DesignSystemNormalizeOptions = {}
): DesignSystemComponent[] {
  if (!Array.isArray(input)) {
    throw new DesignSystemValidationError('Design system components must be provided as an array.');
  }

  const enforceQuality = options.enforceQuality ?? true;

  const components = input.map((entry, index) => {
    const component = asRecord(entry, `Design system component #${index + 1} is invalid.`);
    const kind = normalizeComponentKind(component.kind, index + 1);

    const normalized = {
      id: normalizeIdentifier(component.id, `Design system component #${index + 1} id`, 80),
      name: normalizeRequiredText(component.name, `Design system component #${index + 1} name`, 120),
      kind,
      description: normalizeNullableText(
        component.description,
        `Design system component #${index + 1} description`,
        400
      ),
      html: normalizeRequiredText(component.html, `Design system component #${index + 1} html`, 20000),
      css: normalizeRequiredText(component.css, `Design system component #${index + 1} css`, 20000)
    } satisfies DesignSystemComponent;

    if (enforceQuality) {
      assertComponentQuality(normalized, index + 1);
    }
    return normalized;
  });

  assertUniqueIds(components.map((component) => component.id), 'Design system component ids');

  return components.sort((left, right) => left.name.localeCompare(right.name));
}

export function normalizeDesignSystemExampleSlides(
  input: unknown,
  options: DesignSystemNormalizeOptions = {}
): DesignSystemExampleSlide[] {
  if (!Array.isArray(input)) {
    throw new DesignSystemValidationError(
      'Design system example slides must be provided as an array.'
    );
  }

  const enforceQuality = options.enforceQuality ?? true;

  const slides = input.map((entry, index) => {
    const slide = asRecord(entry, `Design system example slide #${index + 1} is invalid.`);

    const normalized = {
      id: normalizeIdentifier(slide.id, `Design system example slide #${index + 1} id`, 80),
      name: normalizeRequiredText(slide.name, `Design system example slide #${index + 1} name`, 120),
      purpose: normalizeRequiredText(
        slide.purpose,
        `Design system example slide #${index + 1} purpose`,
        500
      ),
      html: normalizeRequiredText(
        slide.html,
        `Design system example slide #${index + 1} html`,
        20000
      ),
      css: normalizeRequiredText(slide.css, `Design system example slide #${index + 1} css`, 20000)
    } satisfies DesignSystemExampleSlide;

    if (enforceQuality) {
      assertExampleSlideQuality(normalized, index + 1);
    }
    return normalized;
  });

  assertUniqueIds(slides.map((slide) => slide.id), 'Design system example slide ids');

  return slides.sort((left, right) => left.name.localeCompare(right.name));
}

export function normalizeDesignSystemArchetypes(input: unknown): DesignSystemSlideArchetype[] {
  if (input === undefined || input === null) {
    return [];
  }

  if (!Array.isArray(input)) {
    throw new DesignSystemValidationError('Design system archetypes must be provided as an array.');
  }

  const archetypes = input.map((entry, index) => {
    const archetype = asRecord(entry, `Design system archetype #${index + 1} is invalid.`);
    const componentIds = Array.isArray(archetype.recommendedComponentIds)
      ? archetype.recommendedComponentIds
      : [];

    return {
      id: normalizeIdentifier(archetype.id, `Design system archetype #${index + 1} id`, 80),
      name: normalizeRequiredText(archetype.name, `Design system archetype #${index + 1} name`, 120),
      purpose: normalizeRequiredText(
        archetype.purpose,
        `Design system archetype #${index + 1} purpose`,
        500
      ),
      recommendedComponentIds: componentIds
        .map((cid, cidIndex) =>
          normalizeIdentifier(
            cid,
            `Design system archetype #${index + 1} recommendedComponentIds #${cidIndex + 1}`,
            80
          )
        )
        .filter((value, idx, arr) => arr.indexOf(value) === idx),
      layoutGuidance: normalizeRequiredText(
        archetype.layoutGuidance,
        `Design system archetype #${index + 1} layoutGuidance`,
        2000
      ),
      baseCss: normalizeRequiredText(
        archetype.baseCss,
        `Design system archetype #${index + 1} baseCss`,
        10000
      ),
      exampleSlideId: normalizeNullableText(
        archetype.exampleSlideId,
        `Design system archetype #${index + 1} exampleSlideId`,
        80
      )
    } satisfies DesignSystemSlideArchetype;
  });

  assertUniqueIds(archetypes.map((a) => a.id), 'Design system archetype ids');

  return archetypes.sort((left, right) => left.name.localeCompare(right.name));
}

export function normalizeDesignSystemRules(input: unknown): DesignSystemRule[] {
  if (input === undefined || input === null) {
    return [];
  }

  if (!Array.isArray(input)) {
    throw new DesignSystemValidationError('Design system rules must be provided as an array.');
  }

  const rules = input.map((entry, index) => {
    const rule = asRecord(entry, `Design system rule #${index + 1} is invalid.`);

    return {
      id: normalizeIdentifier(rule.id, `Design system rule #${index + 1} id`, 80),
      scope: normalizeRuleScope(rule.scope, index + 1),
      type: normalizeRuleType(rule.type, index + 1),
      description: normalizeRequiredText(
        rule.description,
        `Design system rule #${index + 1} description`,
        500
      ),
      targetValue: normalizeNullableText(
        rule.targetValue,
        `Design system rule #${index + 1} targetValue`,
        200
      )
    } satisfies DesignSystemRule;
  });

  assertUniqueIds(rules.map((r) => r.id), 'Design system rule ids');

  return rules.sort((left, right) => left.id.localeCompare(right.id));
}

export function summarizeDesignSystemDocument(
  document: DesignSystemDocument
): DesignSystemDocumentCounts {
  return {
    colorCount: document.tokens.colors.length,
    typographyCount: document.tokens.typography.length,
    spacingCount: document.tokens.spacing.length,
    componentCount: document.components.length,
    exampleSlideCount: document.exampleSlides.length,
    archetypeCount: document.archetypes.length,
    ruleCount: document.rules.length
  };
}

function normalizeColorTokens(input: unknown): DesignSystemColorToken[] {
  if (!Array.isArray(input)) {
    throw new DesignSystemValidationError('Design system color tokens must be provided as an array.');
  }

  const tokens = input.map((entry, index) => {
    const token = asRecord(entry, `Design system color token #${index + 1} is invalid.`);

    return {
      id: normalizeIdentifier(token.id, `Design system color token #${index + 1} id`, 80),
      label: normalizeRequiredText(token.label, `Design system color token #${index + 1} label`, 120),
      value: normalizeColorValue(token.value, index + 1),
      usage: normalizeNullableText(token.usage, `Design system color token #${index + 1} usage`, 200)
    } satisfies DesignSystemColorToken;
  });

  assertUniqueIds(tokens.map((token) => token.id), 'Design system color token ids');

  return tokens.sort((left, right) => left.label.localeCompare(right.label));
}

function normalizeTypographyTokens(input: unknown): DesignSystemTypographyToken[] {
  if (!Array.isArray(input)) {
    throw new DesignSystemValidationError(
      'Design system typography tokens must be provided as an array.'
    );
  }

  const tokens = input.map((entry, index) => {
    const token = asRecord(entry, `Design system typography token #${index + 1} is invalid.`);

    return {
      id: normalizeIdentifier(token.id, `Design system typography token #${index + 1} id`, 80),
      label: normalizeRequiredText(
        token.label,
        `Design system typography token #${index + 1} label`,
        120
      ),
      fontFamily: normalizeRequiredText(
        token.fontFamily,
        `Design system typography token #${index + 1} fontFamily`,
        200
      ),
      fontSizePx: normalizePositiveNumber(
        token.fontSizePx,
        `Design system typography token #${index + 1} fontSizePx`,
        1,
        512
      ),
      fontWeight: normalizePositiveNumber(
        token.fontWeight,
        `Design system typography token #${index + 1} fontWeight`,
        100,
        1000
      ),
      lineHeight: normalizePositiveNumber(
        token.lineHeight,
        `Design system typography token #${index + 1} lineHeight`,
        0.5,
        10
      )
    } satisfies DesignSystemTypographyToken;
  });

  assertUniqueIds(tokens.map((token) => token.id), 'Design system typography token ids');

  return tokens.sort((left, right) => left.label.localeCompare(right.label));
}

function normalizeSpacingTokens(input: unknown): DesignSystemSpacingToken[] {
  if (!Array.isArray(input)) {
    throw new DesignSystemValidationError(
      'Design system spacing tokens must be provided as an array.'
    );
  }

  const tokens = input.map((entry, index) => {
    const token = asRecord(entry, `Design system spacing token #${index + 1} is invalid.`);

    return {
      id: normalizeIdentifier(token.id, `Design system spacing token #${index + 1} id`, 80),
      label: normalizeRequiredText(token.label, `Design system spacing token #${index + 1} label`, 120),
      valuePx: normalizePositiveNumber(
        token.valuePx,
        `Design system spacing token #${index + 1} valuePx`,
        0,
        4096
      )
    } satisfies DesignSystemSpacingToken;
  });

  assertUniqueIds(tokens.map((token) => token.id), 'Design system spacing token ids');

  return tokens.sort((left, right) => left.valuePx - right.valuePx);
}

export function normalizeRequiredText(value: unknown, fieldLabel: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new DesignSystemValidationError(`${fieldLabel} is required.`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new DesignSystemValidationError(`${fieldLabel} is required.`);
  }

  if (normalized.length > maxLength) {
    throw new DesignSystemValidationError(`${fieldLabel} must be ${maxLength} characters or fewer.`);
  }

  return normalized;
}

export function assertComponentQuality(component: DesignSystemComponent, index: number): void {
  if (!/data-pepetex-id\s*=/.test(component.html) || !/data-pepetex-type\s*=/.test(component.html)) {
    throw new DesignSystemValidationError(
      `Design system component #${index} must include data-pepetex-id and data-pepetex-type attributes.`
    );
  }

  if (!(designSystemComponentKinds as readonly string[]).includes(component.kind)) {
    throw new DesignSystemValidationError(
      `Design system component #${index} has unrecognized kind="${component.kind}". Use one of: ${designSystemComponentKinds.join(', ')}.`
    );
  }

  if (!hasSubstantialPresentationCss(component.css)) {
    throw new DesignSystemValidationError(
      `Design system component #${index} css must include substantial presentation styling.`
    );
  }
}

export function assertExampleSlideQuality(slide: DesignSystemExampleSlide, index: number): void {
  if (!/class\s*=\s*["'][^"']*\bpepetex-slide\b/i.test(slide.html)) {
    throw new DesignSystemValidationError(
      `Design system example slide #${index} html must include a pepetex-slide root.`
    );
  }

  if (!/data-pepetex-slide-id\s*=/.test(slide.html)) {
    throw new DesignSystemValidationError(
      `Design system example slide #${index} html must include data-pepetex-slide-id.`
    );
  }

  const combined = `${slide.html}\n${slide.css}`;
  if (!/(width\s*:\s*1920px|data-pepetex-width\s*=\s*["']1920["'])/i.test(combined) ||
      !/(height\s*:\s*1080px|data-pepetex-height\s*=\s*["']1080["'])/i.test(combined)) {
    throw new DesignSystemValidationError(
      `Design system example slide #${index} must define a 1920x1080 presentation canvas.`
    );
  }

  if (!hasSubstantialPresentationCss(slide.css)) {
    throw new DesignSystemValidationError(
      `Design system example slide #${index} css must include substantial presentation styling.`
    );
  }
}

export function hasSubstantialPresentationCss(css: string): boolean {
  if (css.trim().length < 80) return false;

  const hasLayout = /display\s*:\s*(grid|flex)|position\s*:\s*(relative|absolute)|grid-template-columns|inset\s*:/i.test(css);
  const hasTypography = /font-size\s*:\s*\d+(?:\.\d+)?px|font-weight\s*:|line-height\s*:/i.test(css);
  const hasVisualSurface = /background(?:-image|-color)?\s*:|linear-gradient\(|radial-gradient\(|border-radius\s*:|box-shadow\s*:|border\s*:|fill\s*:|stroke\s*:/i.test(css);

  return hasLayout && hasTypography && hasVisualSurface;
}

export function normalizeNullableText(
  value: unknown,
  fieldLabel: string,
  maxLength: number
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new DesignSystemValidationError(`${fieldLabel} must be a string.`);
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLength) {
    throw new DesignSystemValidationError(`${fieldLabel} must be ${maxLength} characters or fewer.`);
  }

  return normalized;
}

export function normalizeIdentifier(value: unknown, fieldLabel: string, maxLength: number): string {
  const normalized = normalizeRequiredText(value, fieldLabel, maxLength);

  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(normalized)) {
    throw new DesignSystemValidationError(
      `${fieldLabel} must use letters, numbers, dots, underscores, or hyphens.`
    );
  }

  return normalized;
}

export function normalizeColorValue(value: unknown, index: number): string {
  const normalized = normalizeRequiredText(value, `Design system color token #${index} value`, 32);

  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(normalized)) {
    throw new DesignSystemValidationError(
      `Design system color token #${index} value must be a hex color.`
    );
  }

  return normalized.toUpperCase();
}

export function normalizeComponentKind(value: unknown, index: number): DesignSystemComponentKind {
  if (typeof value !== 'string' || !designSystemComponentKinds.includes(value as DesignSystemComponentKind)) {
    throw new DesignSystemValidationError(
      `Design system component #${index} kind must be one of: ${designSystemComponentKinds.join(', ')}.`
    );
  }

  return value as DesignSystemComponentKind;
}

function normalizeRuleScope(value: unknown, index: number): DesignSystemRuleScope {
  if (
    typeof value !== 'string' ||
    !designSystemRuleScopes.includes(value as DesignSystemRuleScope)
  ) {
    throw new DesignSystemValidationError(
      `Design system rule #${index} scope must be one of: ${designSystemRuleScopes.join(', ')}.`
    );
  }

  return value as DesignSystemRuleScope;
}

function normalizeRuleType(value: unknown, index: number): DesignSystemRuleType {
  if (
    typeof value !== 'string' ||
    !designSystemRuleTypes.includes(value as DesignSystemRuleType)
  ) {
    throw new DesignSystemValidationError(
      `Design system rule #${index} type must be one of: ${designSystemRuleTypes.join(', ')}.`
    );
  }

  return value as DesignSystemRuleType;
}

export function normalizePositiveNumber(
  value: unknown,
  fieldLabel: string,
  min: number,
  max: number
): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new DesignSystemValidationError(`${fieldLabel} must be a number.`);
  }

  if (value < min || value > max) {
    throw new DesignSystemValidationError(`${fieldLabel} must be between ${min} and ${max}.`);
  }

  return value;
}

export function assertUniqueIds(ids: string[], fieldLabel: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new DesignSystemValidationError(`${fieldLabel} must be unique.`);
  }
}

export function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DesignSystemValidationError(message);
  }

  return value as Record<string, unknown>;
}

export function repairDesignSystemDocument(
  input: unknown
): { document: DesignSystemDocument; warnings: string[] } | null {
  const warnings: string[] = [];

  try {
    return { document: normalizeDesignSystemDocument(input), warnings };
  } catch {
    // proceed to repair
  }

  let candidate: Record<string, unknown>;
  try {
    candidate = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Repair components
  if (Array.isArray(candidate.components)) {
    for (const entry of candidate.components) {
      if (!entry || typeof entry !== 'object') continue;
      const component = entry as Record<string, unknown>;
      const id = String(component.id ?? '');
      const kind = String(component.kind ?? 'component');

      if (typeof component.html === 'string') {
        const repaired = repairComponentHtml(component.html, id, kind);
        if (repaired !== component.html) {
          component.html = repaired;
          warnings.push(`Auto-added data-pepetex-id/data-pepetex-type to component ${id || 'unknown'}.`);
        }
      }

      if (typeof component.css === 'string' && !hasSubstantialPresentationCss(component.css)) {
        component.css = repairComponentCss(component.css, id);
        warnings.push(`Auto-added presentation CSS to component ${id || 'unknown'}.`);
      }
    }
  }

  // Repair example slides
  if (Array.isArray(candidate.exampleSlides)) {
    for (const entry of candidate.exampleSlides) {
      if (!entry || typeof entry !== 'object') continue;
      const slide = entry as Record<string, unknown>;
      const id = String(slide.id ?? '');

      if (typeof slide.html === 'string') {
        const repaired = repairExampleSlideHtml(slide.html, id);
        if (repaired !== slide.html) {
          slide.html = repaired;
          warnings.push(`Auto-added pepetex-slide attributes to example slide ${id || 'unknown'}.`);
        }
      }

      if (typeof slide.css === 'string' && !hasSubstantialPresentationCss(slide.css)) {
        slide.css = repairExampleSlideCss(slide.css);
        warnings.push(`Auto-added presentation CSS to example slide ${id || 'unknown'}.`);
      }
    }
  }

  try {
    return { document: normalizeDesignSystemDocument(candidate), warnings };
  } catch {
    return null;
  }
}

export function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function repairComponentHtml(html: string, id: string, kind: string): string {
  if (/data-pepetex-id\s*=/.test(html) && /data-pepetex-type\s*=/.test(html)) {
    return html;
  }

  const attrs: string[] = [];
  if (!/data-pepetex-id\s*=/.test(html)) {
    attrs.push(`data-pepetex-id="${escapeHtmlAttribute(id)}"`);
  }
  if (!/data-pepetex-type\s*=/.test(html)) {
    attrs.push(`data-pepetex-type="${escapeHtmlAttribute(kind)}"`);
  }

  const injected = html.replace(/^(\s*<[\w-]+)([^>]*?)(\/?>)/, (match, openTag, existingAttrs, close) => {
    return `${openTag}${existingAttrs} ${attrs.join(' ')}${close}`;
  });

  if (injected === html) {
    return `<div ${attrs.join(' ')}>${html}</div>`;
  }
  return injected;
}

export function repairExampleSlideHtml(html: string, id: string): string {
  let result = html;

  if (!/class\s*=\s*["'][^"']*\bpepetex-slide\b/i.test(result)) {
    const withClass = result.replace(/^(\s*<[\w-]+)([^>]*?)(\/?>)/, (match, openTag, existingAttrs, close) => {
      const hasClass = /class\s*=/.test(existingAttrs);
      if (hasClass) {
        return `${openTag}${existingAttrs.replace(/(class\s*=\s*["'])([^"']*)(["'])/, '$1$2 pepetex-slide$3')}${close}`;
      }
      return `${openTag}${existingAttrs} class="pepetex-slide"${close}`;
    });
    if (withClass === result) {
      result = `<section class="pepetex-slide">${result}</section>`;
    } else {
      result = withClass;
    }
  }

  if (!/data-pepetex-slide-id\s*=/.test(result)) {
    const withId = result.replace(/^(\s*<[\w-]+)([^>]*?)(\/?>)/, (match, openTag, existingAttrs, close) => {
      return `${openTag}${existingAttrs} data-pepetex-slide-id="${escapeHtmlAttribute(id)}"${close}`;
    });
    if (withId !== result) {
      result = withId;
    }
  }

  const combined = result;
  const hasWidth = /(?:width\s*:\s*1920px|data-pepetex-width\s*=\s*["']1920["'])/i.test(combined);
  const hasHeight = /(?:height\s*:\s*1080px|data-pepetex-height\s*=\s*["']1080["'])/i.test(combined);

  if (!hasWidth || !hasHeight) {
    const styleParts: string[] = [];
    if (!hasWidth) styleParts.push('width:1920px');
    if (!hasHeight) styleParts.push('height:1080px');
    if (!/position\s*:\s*relative/i.test(combined)) styleParts.push('position:relative');
    if (!/overflow\s*:\s*hidden/i.test(combined)) styleParts.push('overflow:hidden');

    const withStyle = result.replace(/^(\s*<[\w-]+)([^>]*?)(\/?>)/, (match, openTag, existingAttrs, close) => {
      const hasStyle = /style\s*=/.test(existingAttrs);
      if (hasStyle) {
        return `${openTag}${existingAttrs.replace(/(style\s*=\s*["'])([^"']*)(["'])/, '$1$2;' + styleParts.join(';') + '$3')}${close}`;
      }
      return `${openTag}${existingAttrs} style="${styleParts.join(';')}"${close}`;
    });
    if (withStyle !== result) {
      result = withStyle;
    }
  }

  return result;
}

export function repairComponentCss(css: string, id: string): string {
  const safety = `[data-pepetex-id="${escapeHtmlAttribute(id)}"] {
  display: flex;
  flex-direction: column;
  font-size: 16px;
  font-weight: 400;
  line-height: 1.4;
  background-color: #ffffff;
  border-radius: 4px;
  padding: 16px;
}`;
  return `${css.trim()}\n\n/* Auto-added presentation styling */\n${safety}`;
}

export function repairExampleSlideCss(css: string): string {
  const safety = `.pepetex-slide {
  position: relative;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-size: 16px;
  font-weight: 400;
  line-height: 1.4;
  background-color: #ffffff;
}`;
  return `${css.trim()}\n\n/* Auto-added presentation styling */\n${safety}`;
}

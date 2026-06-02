import type {
  DesignSystemColorToken,
  DesignSystemDocument,
  DesignSystemRule,
  DesignSystemTypographyToken
} from './index.js';

export interface DesignSystemComplianceIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  path: string;
}

interface ParsedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Validates that a generated slide's HTML/CSS complies with the design system
 * tokens, components, and rules. Returns a list of compliance issues.
 */
export function validateDesignSystemCompliance(
  slide: { id: string; html: string; css: string },
  designSystem: DesignSystemDocument
): DesignSystemComplianceIssue[] {
  const issues: DesignSystemComplianceIssue[] = [];
  const componentIds = new Set(designSystem.components.map((c) => c.id));
  const componentKinds = new Set(designSystem.components.map((c) => c.kind));

  // 1. Color token usage
  const colorIssues = checkColorCompliance(slide, designSystem.tokens.colors);
  issues.push(...colorIssues);

  // 2. Typography token usage
  const typographyIssues = checkTypographyCompliance(slide, designSystem.tokens.typography);
  issues.push(...typographyIssues);

  // 3. Component usage ratio
  const componentIssues = checkComponentUsageRatio(slide, componentIds, componentKinds);
  issues.push(...componentIssues);

  // 4. Brand rules compliance
  const ruleIssues = checkBrandRules(slide, designSystem.rules);
  issues.push(...ruleIssues);

  return issues;
}

function checkColorCompliance(
  slide: { id: string; css: string },
  colorTokens: DesignSystemColorToken[]
): DesignSystemComplianceIssue[] {
  const issues: DesignSystemComplianceIssue[] = [];
  if (colorTokens.length === 0) return issues;

  const allowedColors = colorTokens.map((t) => parseHexColor(t.value));
  const cssColors = extractColorsFromCss(slide.css);

  for (const [color, contexts] of cssColors.entries()) {
    const parsed = parseHexColor(color);
    if (!parsed) continue;

    const isAllowed = allowedColors.some(
      (allowed) => allowed && colorDistance(allowed, parsed) <= 32
    );

    if (!isAllowed) {
      issues.push({
        code: 'DS_COLOR_NOT_IN_PALETTE',
        severity: 'warning',
        message: `Color ${color} is not in the design system palette. Use one of: ${colorTokens.map((t) => t.value).join(', ')}.`,
        path: `${slide.id}.css (${contexts.slice(0, 3).join(', ')})`
      });
    }
  }

  return issues;
}

function checkTypographyCompliance(
  slide: { id: string; css: string },
  typographyTokens: DesignSystemTypographyToken[]
): DesignSystemComplianceIssue[] {
  const issues: DesignSystemComplianceIssue[] = [];
  if (typographyTokens.length === 0) return issues;

  const allowedFamilies = new Set(
    typographyTokens.map((t) => {
      const first = t.fontFamily.split(',')[0];
      return first ? first.trim().toLowerCase() : '';
    }).filter(Boolean)
  );

  const fontFamilyMatches = slide.css.matchAll(/font-family\s*:\s*([^;]+)/gi);
  for (const match of fontFamilyMatches) {
    const rawFamily = match[1];
    if (!rawFamily) continue;
    const firstPart = rawFamily.split(',')[0];
    const family = firstPart ? firstPart.trim().toLowerCase() : '';
    if (!allowedFamilies.has(family)) {
      issues.push({
        code: 'DS_TYPOGRAPHY_NOT_IN_SYSTEM',
        severity: 'warning',
        message: `Font family "${family}" is not in the design system typography tokens. Use one of: ${[...allowedFamilies].join(', ')}.`,
        path: `${slide.id}.css`
      });
    }
  }

  return issues;
}

function checkComponentUsageRatio(
  slide: { id: string; html: string },
  componentIds: Set<string>,
  componentKinds: Set<string>
): DesignSystemComplianceIssue[] {
  const issues: DesignSystemComplianceIssue[] = [];
  if (componentIds.size === 0) return issues;

  const taggedElements = slide.html.matchAll(/data-pepetex-id=["']([^"']+)["']/gi);
  let totalTagged = 0;
  let matchedComponents = 0;

  for (const match of taggedElements) {
    const id = match[1];
    if (!id) continue;
    totalTagged += 1;
    if (componentIds.has(id)) {
      matchedComponents += 1;
    }
  }

  // Also check data-pepetex-type against component kinds as a secondary signal
  const typeElements = slide.html.matchAll(/data-pepetex-type=["']([^"']+)["']/gi);
  let totalTyped = 0;
  let matchedKinds = 0;

  for (const match of typeElements) {
    const type = match[1];
    if (!type) continue;
    totalTyped += 1;
    if (componentKinds.has(type)) {
      matchedKinds += 1;
    }
  }

  const totalSignals = totalTagged + totalTyped;
  const matchedSignals = matchedComponents + matchedKinds;

  if (totalSignals > 0 && matchedSignals / totalSignals < 0.6) {
    issues.push({
      code: 'DS_LOW_COMPONENT_USAGE',
      severity: 'warning',
      message: `Only ${Math.round((matchedSignals / totalSignals) * 100)}% of tagged elements map to design system components. Target: at least 60%.`,
      path: `${slide.id}.html`
    });
  }

  return issues;
}

function checkBrandRules(
  slide: { id: string; html: string; css: string },
  rules: DesignSystemRule[]
): DesignSystemComplianceIssue[] {
  const issues: DesignSystemComplianceIssue[] = [];
  const combined = `${slide.html}\n${slide.css}`.toLowerCase();

  for (const rule of rules) {
    const violated = isRuleViolated(rule, combined);
    if (!violated) continue;

    const severity = rule.type === 'should' ? 'warning' : 'error';
    const prefix = rule.type === 'must' ? 'MUST' : rule.type === 'must-not' ? 'MUST NOT' : 'SHOULD';

    issues.push({
      code: `DS_RULE_${rule.id}`,
      severity,
      message: `[${prefix}] ${rule.description}`,
      path: `${slide.id}`
    });
  }

  return issues;
}

function isRuleViolated(rule: DesignSystemRule, combinedLower: string): boolean {
  switch (rule.scope) {
    case 'color':
      return checkColorRule(rule, combinedLower);
    case 'typography':
      return checkTypographyRule(rule, combinedLower);
    case 'layout':
      return checkLayoutRule(rule, combinedLower);
    case 'component':
      return checkComponentRule(rule, combinedLower);
    case 'asset':
      return checkAssetRule(rule, combinedLower);
    case 'spacing':
      return checkSpacingRule(rule, combinedLower);
    default:
      return false;
  }
}

function checkColorRule(rule: DesignSystemRule, combinedLower: string): boolean {
  if (!rule.targetValue) return false;
  const target = rule.targetValue.toLowerCase();

  if (rule.type === 'must-not') {
    return combinedLower.includes(target);
  }

  if (rule.type === 'must') {
    return !combinedLower.includes(target);
  }

  return false;
}

function checkTypographyRule(rule: DesignSystemRule, combinedLower: string): boolean {
  if (!rule.targetValue) return false;
  const target = rule.targetValue.toLowerCase();

  if (rule.type === 'must-not') {
    return combinedLower.includes(target);
  }

  if (rule.type === 'must') {
    return !combinedLower.includes(target);
  }

  return false;
}

function checkLayoutRule(_rule: DesignSystemRule, _combinedLower: string): boolean {
  // Layout rules are generally too complex to validate with simple string matching.
  // Return false (not violated) for now; future implementations can parse CSS for specific properties.
  return false;
}

function checkComponentRule(rule: DesignSystemRule, combinedLower: string): boolean {
  if (!rule.targetValue) return false;
  const target = rule.targetValue.toLowerCase();

  if (rule.type === 'must-not') {
    return combinedLower.includes(target);
  }

  if (rule.type === 'must') {
    return !combinedLower.includes(target);
  }

  return false;
}

function checkAssetRule(rule: DesignSystemRule, combinedLower: string): boolean {
  if (rule.type === 'must-not') {
    // Generic must-not asset rule — check if targetValue appears
    if (!rule.targetValue) return false;
    return combinedLower.includes(rule.targetValue.toLowerCase());
  }

  if (rule.type === 'must') {
    // Must-have asset — check for pepetex://asset/ reference
    return !combinedLower.includes('pepetex://asset/');
  }

  return false;
}

function checkSpacingRule(_rule: DesignSystemRule, _combinedLower: string): boolean {
  // Spacing rules require CSS parsing; too complex for string matching.
  // Return false (not violated) for now.
  return false;
}

function extractColorsFromCss(css: string): Map<string, string[]> {
  const colors = new Map<string, string[]>();
  const patterns = [
    /#[0-9a-f]{3,8}/gi,
    /rgb\([^)]+\)/gi,
    /rgba\([^)]+\)/gi,
    /hsl\([^)]+\)/gi,
    /hsla\([^)]+\)/gi
  ];

  for (const pattern of patterns) {
    const matches = css.matchAll(pattern);
    for (const match of matches) {
      const rawColor = match[0];
      const index = match.index;
      if (!rawColor || index === undefined) continue;
      const color = rawColor.toUpperCase();
      const context = css.slice(Math.max(0, index - 40), index + 40);
      const existing = colors.get(color) ?? [];
      existing.push(context.replace(/\s+/g, ' ').trim());
      colors.set(color, existing);
    }
  }

  return colors;
}

function parseHexColor(value: string): ParsedColor | null {
  const hex = value.replace('#', '');
  if (hex.length === 3) {
    const r = parseInt(`${hex.charAt(0)}${hex.charAt(0)}`, 16);
    const g = parseInt(`${hex.charAt(1)}${hex.charAt(1)}`, 16);
    const b = parseInt(`${hex.charAt(2)}${hex.charAt(2)}`, 16);
    return { r, g, b, a: 1 };
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return { r, g, b, a: 1 };
  }
  if (hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = parseInt(hex.slice(6, 8), 16) / 255;
    return { r, g, b, a };
  }
  return null;
}

function colorDistance(left: ParsedColor, right: ParsedColor): number {
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

import { describe, expect, it } from 'vitest';
import { validateDesignSystemCompliance } from './compliance';
import type { DesignSystemDocument } from './index';

const baseDesignSystem: DesignSystemDocument = {
  tokens: {
    colors: [
      { id: 'color-primary', label: 'Primary', value: '#2563EB', usage: 'Main accent' },
      { id: 'color-surface', label: 'Surface', value: '#F8FAFC', usage: 'Backgrounds' },
      { id: 'color-ink', label: 'Ink', value: '#0F172A', usage: 'Text' }
    ],
    typography: [
      { id: 'font-heading', label: 'Heading', fontFamily: 'Inter, sans-serif', fontSizePx: 64, fontWeight: 800, lineHeight: 1.05 }
    ],
    spacing: [{ id: 'space-md', label: 'Medium', valuePx: 32 }]
  },
  components: [
    { id: 'card-default', name: 'Default Card', kind: 'card', description: null, html: '<div></div>', css: '.card {}' },
    { id: 'metric-tile', name: 'Metric Tile', kind: 'metric', description: null, html: '<div></div>', css: '.metric {}' }
  ],
  exampleSlides: [],
  archetypes: [],
  rules: [
    { id: 'rule-no-red', scope: 'color', type: 'must-not', description: 'Never use pure red', targetValue: '#FF0000' },
    { id: 'rule-inter', scope: 'typography', type: 'must', description: 'Use Inter for headlines', targetValue: 'Inter' }
  ]
};

describe('validateDesignSystemCompliance', () => {
  it('returns no issues for a compliant slide', () => {
    const slide = {
      id: 'slide_01',
      html: '<div data-pepetex-id="card-default" data-pepetex-type="card">Hello</div>',
      css: '.slide { background: #F8FAFC; font-family: Inter, sans-serif; }'
    };
    const issues = validateDesignSystemCompliance(slide, baseDesignSystem);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('flags colors not in the palette', () => {
    const slide = {
      id: 'slide_01',
      html: '<div></div>',
      css: '.slide { background: #FF5733; }'
    };
    const issues = validateDesignSystemCompliance(slide, baseDesignSystem);
    const colorIssues = issues.filter((i) => i.code === 'DS_COLOR_NOT_IN_PALETTE');
    expect(colorIssues.length).toBeGreaterThan(0);
    expect(colorIssues[0]!.severity).toBe('warning');
  });

  it('flags typography not in the system', () => {
    const slide = {
      id: 'slide_01',
      html: '<div></div>',
      css: '.slide { font-family: Arial; }'
    };
    const issues = validateDesignSystemCompliance(slide, baseDesignSystem);
    const typeIssues = issues.filter((i) => i.code === 'DS_TYPOGRAPHY_NOT_IN_SYSTEM');
    expect(typeIssues.length).toBeGreaterThan(0);
    expect(typeIssues[0]!.severity).toBe('warning');
  });

  it('flags low component usage ratio', () => {
    const slide = {
      id: 'slide_01',
      html: '<div data-pepetex-id="a" data-pepetex-type="headline"></div><div data-pepetex-id="b" data-pepetex-type="body"></div><div data-pepetex-id="c" data-pepetex-type="shape"></div>',
      css: '.slide {}'
    };
    const issues = validateDesignSystemCompliance(slide, baseDesignSystem);
    const usageIssues = issues.filter((i) => i.code === 'DS_LOW_COMPONENT_USAGE');
    expect(usageIssues.length).toBeGreaterThan(0);
    expect(usageIssues[0]!.severity).toBe('warning');
  });

  it('flags violated must-not rules as errors', () => {
    const slide = {
      id: 'slide_01',
      html: '<div style="background:#FF0000"></div>',
      css: ''
    };
    const issues = validateDesignSystemCompliance(slide, baseDesignSystem);
    const ruleIssues = issues.filter((i) => i.code === 'DS_RULE_rule-no-red');
    expect(ruleIssues.length).toBe(1);
    expect(ruleIssues[0]!.severity).toBe('error');
  });

  it('flags violated must rules as errors', () => {
    const slide = {
      id: 'slide_01',
      html: '<div></div>',
      css: '.slide { font-family: Arial; }'
    };
    const issues = validateDesignSystemCompliance(slide, baseDesignSystem);
    const ruleIssues = issues.filter((i) => i.code === 'DS_RULE_rule-inter');
    expect(ruleIssues.length).toBe(1);
    expect(ruleIssues[0]!.severity).toBe('error');
  });
});

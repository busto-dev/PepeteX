import type { GeneratedDeck, GeneratedSlide } from '../index.js';

export type DeckQualityIssueSeverity = 'warning' | 'error';
export type DeckQualityIssueCode =
  | 'UNDERDEVELOPED_DECK'
  | 'WEAK_SLIDE_PURPOSE'
  | 'UNSTYLED_SLIDE'
  | 'REPEATED_CARD_GRID_LAYOUT'
  | 'TINY_TEXT'
  | 'EXCESSIVE_PARAGRAPH_DENSITY'
  | 'WEAK_HIERARCHY'
  | 'MISSING_VISUAL_ANCHOR'
  | 'REPEATED_COMPOSITION';

export interface DeckQualityIssue {
  code: DeckQualityIssueCode;
  severity: DeckQualityIssueSeverity;
  message: string;
  repairHint: string;
  slideId?: string;
}

export interface DeckQualityReport {
  ok: boolean;
  issues: DeckQualityIssue[];
}

export interface InspectDeckQualityOptions {
  minBodyFontPx?: number;
  minHeadlineFontPx?: number;
  maxWordsPerSlide?: number;
  maxParagraphsPerSlide?: number;
  requireSubstantialDeck?: boolean;
  minSlideCount?: number;
}

export function inspectDeckQuality(
  deck: GeneratedDeck,
  options: InspectDeckQualityOptions = {}
): DeckQualityReport {
  const minBodyFontPx = options.minBodyFontPx ?? 18;
  const minHeadlineFontPx = options.minHeadlineFontPx ?? 32;
  const maxWordsPerSlide = options.maxWordsPerSlide ?? 130;
  const maxParagraphsPerSlide = options.maxParagraphsPerSlide ?? 5;
  const minSlideCount = options.minSlideCount ?? 6;
  const issues: DeckQualityIssue[] = [];
  const cardGridSlideIds: string[] = [];
  const weakPurposeSlideIds: string[] = [];
  const compositionCounts = new Map<string, string[]>();
  let anchorlessSlideCount = 0;

  if (options.requireSubstantialDeck && deck.slides.length < minSlideCount) {
    issues.push({
      code: 'UNDERDEVELOPED_DECK',
      severity: 'error',
      message: `Deck has ${deck.slides.length} slides, below the ${minSlideCount}-slide minimum for an unspecified full-deck request.`,
      repairHint: 'Expand the deck with a complete narrative arc and enough slides to cover the user request with one main takeaway per slide.'
    });
  }

  for (const slide of deck.slides) {
    const text = stripHtml(slide.html);
    const wordCount = text ? text.split(/\s+/).length : 0;
    const paragraphCount = countMatches(slide.html, /<p\b/gi) + countMatches(slide.html, /data-pepetex-type=["']body["']/gi);
    const fontSizes = extractFontSizes(`${slide.html}\n${slide.css}`);
    const minFontSize = fontSizes.length > 0 ? Math.min(...fontSizes) : null;
    const maxFontSize = fontSizes.length > 0 ? Math.max(...fontSizes) : null;
    const headlineCount = countPepeteXType(slide, 'headline');
    const visualAnchorCount =
      countPepeteXType(slide, 'image') +
      countPepeteXType(slide, 'chart') +
      countPepeteXType(slide, 'card') +
      countPepeteXType(slide, 'shape') +
      countPepeteXType(slide, 'decorative') +
      countPepeteXType(slide, 'background') +
      countPepeteXType(slide, 'group') +
      countMatches(slide.html, /<img\b|<svg\b|<table\b/gi);
    const cardCount = countPepeteXType(slide, 'card');
    const usesGrid = /display\s*:\s*grid|grid-template-columns/i.test(slide.css);
    const styling = inspectSlideStyling(slide);

    if (options.requireSubstantialDeck && isWeakSlidePurpose(slide.title, text)) {
      weakPurposeSlideIds.push(slide.id);
    }

    if (minFontSize !== null && minFontSize < minBodyFontPx) {
      issues.push({
        code: 'TINY_TEXT',
        severity: 'warning',
        slideId: slide.id,
        message: `Slide "${slide.title}" uses ${minFontSize}px text, below the ${minBodyFontPx}px minimum.`,
        repairHint: 'Increase small labels/body copy or reduce content density so text stays readable.'
      });
    }

    if (wordCount > maxWordsPerSlide || paragraphCount > maxParagraphsPerSlide) {
      issues.push({
        code: 'EXCESSIVE_PARAGRAPH_DENSITY',
        severity: 'warning',
        slideId: slide.id,
        message: `Slide "${slide.title}" is too dense (${wordCount} words, ${paragraphCount} body blocks).`,
        repairHint: 'Split the content, replace paragraphs with visual structure, or reduce copy.'
      });
    }

    const missingHeadlineElement = headlineCount === 0;
    const headlineTooSmall = maxFontSize !== null && maxFontSize < minHeadlineFontPx;
    if (missingHeadlineElement || headlineTooSmall) {
      issues.push({
        code: 'WEAK_HIERARCHY',
        severity: 'error',
        slideId: slide.id,
        message: missingHeadlineElement
          ? `Slide "${slide.title}" has no element marked data-pepetex-type="headline".`
          : `Slide "${slide.title}" headline is too small (largest text is ${maxFontSize}px; needs at least ${minHeadlineFontPx}px).`,
        // The most common failure mode is the model tagging the title as "header"/"title"
        // (both pass other checks) instead of the canonical "headline". Name the exact fix so
        // the repair loop does not waste attempts enlarging an incorrectly-typed title.
        repairHint: missingHeadlineElement
          ? `Tag the slide's dominant title element with data-pepetex-type="headline" — use exactly "headline", NOT "header", "title", or any synonym ("header" is only for a repeated slide-header band). Render it at ${minHeadlineFontPx}px or larger.`
          : `Increase the headline font-size to at least ${minHeadlineFontPx}px so it is the visually dominant element on the slide.`
      });
    }

    if (!styling.ok) {
      issues.push({
        code: 'UNSTYLED_SLIDE',
        severity: 'error',
        slideId: slide.id,
        message: `Slide "${slide.title}" does not include enough slide-specific CSS for a presentation canvas.`,
        repairHint: 'Add slide.css with scoped layout and visual styling: 1920x1080 artboard sizing, font sizes, spacing, background/gradient, cards/shapes/diagram surfaces, and visual hierarchy.'
      });
    }

    if (visualAnchorCount === 0) {
      anchorlessSlideCount += 1;
      // A single text-only slide (cover, section divider, a strong quote) is a
      // legitimate design choice, so this is a non-blocking nudge per slide. The
      // deck-level check below only errors when most slides lack any visual.
      issues.push({
        code: 'MISSING_VISUAL_ANCHOR',
        severity: 'warning',
        slideId: slide.id,
        message: `Slide "${slide.title}" has no visual anchor (image, chart, card, shape, or table).`,
        repairHint: 'Consider adding an image, chart, diagram group, or strong card/visual module — unless this is an intentionally typographic slide (cover, section divider, quote).'
      });
    }

    if (cardCount >= 4 && usesGrid) {
      cardGridSlideIds.push(slide.id);
    }

    const signature = compositionSignature(slide, usesGrid);
    compositionCounts.set(signature, [...(compositionCounts.get(signature) ?? []), slide.id]);
  }

  if (options.requireSubstantialDeck && deck.slides.length >= 3) {
    const anchorlessLimit = Math.max(2, Math.ceil(deck.slides.length * 0.4));
    if (anchorlessSlideCount > anchorlessLimit) {
      issues.push({
        code: 'MISSING_VISUAL_ANCHOR',
        severity: 'error',
        message: `${anchorlessSlideCount} of ${deck.slides.length} slides have no visual anchor — the deck is mostly wall-to-wall text.`,
        repairHint: 'Add meaningful visuals (images, charts, cards, diagrams) to the text-only slides. A few intentional typographic slides (cover, section dividers, quotes) are fine.'
      });
    }
  }

  if (cardGridSlideIds.length > 2) {
    issues.push({
      code: 'REPEATED_CARD_GRID_LAYOUT',
      severity: 'error',
      message: `Too many slides reuse dense card-grid layouts (${cardGridSlideIds.length} slides).`,
      repairHint: 'Vary compositions with hero statements, diagrams, timelines, comparison layouts, and visual anchors.'
    });
  }

  if (options.requireSubstantialDeck && weakPurposeSlideIds.length > Math.max(1, Math.floor(deck.slides.length * 0.35))) {
    issues.push({
      code: 'WEAK_SLIDE_PURPOSE',
      severity: 'error',
      message: `${weakPurposeSlideIds.length} slides use generic or weakly purposeful titles/content.`,
      repairHint: 'Rewrite slide titles and content around specific takeaways, decisions, evidence, or next actions.'
    });
  }

  const repeatedCompositionLimit = Math.max(3, Math.ceil(deck.slides.length * 0.45));
  for (const slideIds of compositionCounts.values()) {
    if (deck.slides.length >= 4 && slideIds.length > repeatedCompositionLimit) {
      issues.push({
        code: 'REPEATED_COMPOSITION',
        severity: 'warning',
        message: `${slideIds.length} slides share the same composition signature.`,
        repairHint: 'Change density, visual anchor, and layout rhythm across the deck.'
      });
    }
  }

  return {
    ok: issues.every((issue) => issue.severity !== 'error'),
    issues
  };
}

function countPepeteXType(slide: GeneratedSlide, type: string): number {
  const pattern = new RegExp(`data-pepetex-type=["']${type}["']`, 'gi');
  return countMatches(slide.html, pattern);
}

function countMatches(input: string, pattern: RegExp): number {
  return Array.from(input.matchAll(pattern)).length;
}

function extractFontSizes(input: string): number[] {
  return Array.from(input.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi), (match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
}

function inspectSlideStyling(slide: GeneratedSlide): { ok: boolean } {
  const css = slide.css.trim();
  if (css.length < 120) return { ok: false };
  if (!/(?:[.#]|\[)[^{}]+\{[^{}]+\}/.test(css)) return { ok: false };

  const hasLayout = /display\s*:\s*(grid|flex)|position\s*:\s*(relative|absolute)|grid-template-columns|inset\s*:/i.test(css);
  const hasTypography = /font-size\s*:\s*\d+(?:\.\d+)?px|font-weight\s*:|line-height\s*:/i.test(css);
  const hasVisualSurface = /background(?:-image|-color)?\s*:|linear-gradient\(|radial-gradient\(|border-radius\s*:|box-shadow\s*:|border\s*:|fill\s*:|stroke\s*:/i.test(css);
  const hasCanvasSelector = /\.pepetex-slide|data-pepetex-slide-id|\[data-pepetex-slide-id/i.test(css);

  return { ok: hasLayout && hasTypography && hasVisualSurface && hasCanvasSelector };
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isWeakSlidePurpose(title: string, text: string): boolean {
  const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  const genericTitles = new Set([
    'agenda',
    'introduction',
    'intro',
    'overview',
    'summary',
    'details',
    'key points',
    'conclusion',
    'next steps',
    'thank you'
  ]);

  if (/^slide\s*\d+$/i.test(normalizedTitle)) return true;
  if (genericTitles.has(normalizedTitle)) return true;

  const titleWords = normalizedTitle.split(/\s+/).filter(Boolean);
  const textWords = text.split(/\s+/).filter(Boolean);
  return titleWords.length <= 1 && textWords.length < 18;
}

function compositionSignature(slide: GeneratedSlide, usesGrid: boolean): string {
  const buckets = [
    usesGrid ? 'grid' : /display\s*:\s*flex/i.test(slide.css) ? 'flex' : 'freeform',
    countPepeteXType(slide, 'headline') > 0 ? 'headline' : 'no-headline',
    countPepeteXType(slide, 'image') > 0 ? 'image' : 'no-image',
    countPepeteXType(slide, 'chart') > 0 ? 'chart' : 'no-chart',
    countPepeteXType(slide, 'card') >= 4 ? 'many-cards' : countPepeteXType(slide, 'card') > 0 ? 'cards' : 'no-cards'
  ];

  return buckets.join('|');
}

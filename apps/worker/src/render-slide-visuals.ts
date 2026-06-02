import { JSDOM } from 'jsdom';
import postcss from 'postcss';
import type { GeneratedDeck, GeneratedSlide } from '@pepetex/ai';
import { renderChartToSvg } from './chart-renderer.js';
import { renderDiagramToSvg, closeDiagramBrowser } from './diagram-renderer.js';

export interface RenderSlideVisualsOptions {
  chartColors?: string[] | undefined;
}

/**
 * Renders all charts and diagrams in a deck to SVGs and injects them into
 * the slide HTML. This should be called during the commit phase before
 * persisting the deck revision.
 */
export async function renderDeckVisuals(
  deck: GeneratedDeck,
  options: RenderSlideVisualsOptions = {}
): Promise<GeneratedDeck> {
  const slides: GeneratedSlide[] = [];

  for (const slide of deck.slides) {
    const renderedSlide = await renderSlideVisuals(slide, options);
    slides.push(renderedSlide);
  }

  // Close the shared diagram browser to free resources
  await closeDiagramBrowser();

  return { ...deck, slides };
}

async function renderSlideVisuals(
  slide: GeneratedSlide,
  options: RenderSlideVisualsOptions
): Promise<GeneratedSlide> {
  if (slide.charts.length === 0 && slide.diagrams.length === 0) {
    return slide;
  }

  const dom = new JSDOM(`<!DOCTYPE html><body>${slide.html}</body>`);
  const document = dom.window.document;
  const body = document.body;

  // Render charts
  for (const chart of slide.charts) {
    const container = body.querySelector(`[data-pepetex-chart-id="${escapeSelector(chart.id)}"]`)
      ?? body.querySelector(`[data-pepetex-id="${escapeSelector(chart.id)}"][data-pepetex-type="chart"]`);

    if (container) {
      container.setAttribute('data-pepetex-chart-id', chart.id);
      if (!container.getAttribute('data-pepetex-id')) {
        container.setAttribute('data-pepetex-id', chart.id);
      }
      if (!container.getAttribute('data-pepetex-type')) {
        container.setAttribute('data-pepetex-type', 'chart');
      }
      const chartOptions: { colors?: string[] } = {};
      if (options.chartColors) {
        chartOptions.colors = options.chartColors;
      }
      try {
        const svg = sanitizeRenderedSvg(renderChartToSvg(chart, chartOptions));
        container.innerHTML = svg;
      } catch (error) {
        console.warn(
          `[render-slide-visuals] Failed to render chart ${chart.id} (kind=${chart.kind}): ${(error as Error)?.message ?? error}`
        );
      }
    }
  }

  // Render diagrams
  for (const diagram of slide.diagrams) {
    const container = body.querySelector(`[data-pepetex-diagram-id="${escapeSelector(diagram.id)}"]`)
      ?? body.querySelector(`[data-pepetex-id="${escapeSelector(diagram.id)}"][data-pepetex-type="diagram"]`);

    if (container) {
      try {
        const svg = sanitizeRenderedSvg(await renderDiagramToSvg(diagram));
        container.innerHTML = svg;
      } catch (error) {
        // A single bad diagram (unparseable mermaid source, unsupported kind) must
        // not fail the whole deck commit. Leave the original container intact.
        console.warn(
          `[render-slide-visuals] Failed to render diagram ${diagram.id} (kind=${diagram.kind}): ${(error as Error)?.message ?? error}`
        );
      }
    }
  }

  ensureInlineSiblingSeparators(body);

  const renderedHtml = body.innerHTML.trim();

  return {
    ...slide,
    html: renderedHtml
  };
}

function escapeSelector(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Inline tags whose adjacent siblings need an explicit whitespace separator —
// dom-to-pptx's collectTextParts() concatenates `<span>A</span><span>B</span>`
// into "AB" when there is no text node between them. AI prompts ask for block
// wrappers around stacked labels (eyebrow / title), but a defensive pass here
// rescues legacy decks too.
const INLINE_TAG_NAMES = new Set([
  'span', 'a', 'b', 'i', 'em', 'strong', 'mark', 'small',
  'sub', 'sup', 'code', 'kbd', 'samp', 'var', 'abbr', 'cite',
  'dfn', 'q', 'time', 's', 'u', 'del', 'ins', 'label'
]);

function ensureInlineSiblingSeparators(root: HTMLElement): void {
  const document = root.ownerDocument;
  if (!document) return;

  const walk = (node: Element): void => {
    const tagName = node.tagName.toLowerCase();
    // Skip SVG subtrees — text layout inside SVG is governed by tspan/text
    // positioning; dom-to-pptx handles SVG via svgAsVector serialization.
    if (tagName === 'svg') return;

    const children = Array.from(node.children);
    for (let i = 1; i < children.length; i += 1) {
      const prev = children[i - 1];
      const current = children[i];
      if (!prev || !current) continue;
      if (
        !INLINE_TAG_NAMES.has(prev.tagName.toLowerCase())
        || !INLINE_TAG_NAMES.has(current.tagName.toLowerCase())
      ) {
        continue;
      }

      let between: ChildNode | null = prev.nextSibling;
      let hasSeparator = false;
      while (between && between !== current) {
        if (
          between.nodeType === 3 /* TEXT_NODE */
          && /\s/.test(between.nodeValue ?? '')
        ) {
          hasSeparator = true;
          break;
        }
        between = between.nextSibling;
      }
      if (!hasSeparator) {
        node.insertBefore(document.createTextNode(' '), current);
      }
    }

    for (const child of children) {
      walk(child);
    }
  };

  walk(root);
}

function sanitizeRenderedSvg(svg: string): string {
  const dom = new JSDOM(`<!doctype html><body>${svg}</body>`);
  const document = dom.window.document;

  // Mermaid (and ECharts) emit a <style> block that holds class-based fills,
  // strokes, and label colors. The strict-CSP preview iframe accepts <style>
  // tags inside SVG, but dom-to-pptx serializes the SVG opaquely and PowerPoint
  // does not reliably honor embedded <style> blocks during SVG-as-vector import.
  // Inline the rules onto matching elements so the SVG is fully self-contained,
  // then drop the <style> tag.
  for (const styleElement of Array.from(document.querySelectorAll('style'))) {
    inlineStyleRules(document, styleElement.textContent ?? '');
    styleElement.remove();
  }

  for (const element of Array.from(document.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === 'style' && attribute.value.toLowerCase().includes('@import')) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === 'class' && /\bzr\d+-cls-\d+\b/.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return document.body.innerHTML.trim();
}

function inlineStyleRules(document: Document, css: string): void {
  if (!css.trim()) return;

  let root;
  try {
    root = postcss.parse(css);
  } catch {
    // Malformed CSS — safer to drop the styles than to partially inline them
    // and produce an inconsistent visual result.
    return;
  }

  root.walkRules((rule) => {
    // Skip rules nested inside @media / @supports / @keyframes / @font-face.
    // Our SVGs render at fixed dimensions, so responsive rules would mis-apply,
    // and animation/keyframe rules don't survive PPTX export anyway.
    if (rule.parent && rule.parent.type === 'atrule') {
      return;
    }

    const selectors = rule.selectors.filter((selector) => {
      const trimmed = selector.trim();
      if (!trimmed) return false;
      // Pseudo-classes/elements (:hover, :focus, ::before, etc.) don't apply to
      // a static SVG snapshot. Skip selectors containing them.
      if (/:[a-z-]/i.test(trimmed)) return false;
      return true;
    });
    if (selectors.length === 0) return;

    const declarations: Array<[string, string]> = [];
    rule.walkDecls((decl) => {
      // url() can pull network resources; PowerPoint's SVG renderer often
      // chokes on them. Drop these declarations.
      if (/url\s*\(/i.test(decl.value)) return;
      declarations.push([decl.prop, decl.value]);
    });
    if (declarations.length === 0) return;

    for (const selector of selectors) {
      let matches: NodeListOf<Element>;
      try {
        matches = document.querySelectorAll(selector);
      } catch {
        // querySelectorAll throws on selectors JSDOM doesn't understand
        // (newer pseudo-classes etc.). Skip rather than abort the whole pass.
        continue;
      }
      for (const element of Array.from(matches)) {
        mergeIntoInlineStyle(element, declarations);
      }
    }
  });
}

function mergeIntoInlineStyle(
  element: Element,
  declarations: ReadonlyArray<readonly [string, string]>
): void {
  const existing = element.getAttribute('style') ?? '';
  const existingProps = new Set<string>();
  for (const decl of existing.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const name = decl.slice(0, idx).trim().toLowerCase();
    if (name) existingProps.add(name);
  }

  const additions: string[] = [];
  for (const [prop, value] of declarations) {
    // Existing inline style wins over the rule's declarations — preserves any
    // explicit author intent on individual elements.
    if (existingProps.has(prop.toLowerCase())) continue;
    additions.push(`${prop}: ${value}`);
  }
  if (additions.length === 0) return;

  const trimmedExisting = existing.trim().replace(/;\s*$/, '');
  const merged = trimmedExisting
    ? `${trimmedExisting}; ${additions.join('; ')};`
    : `${additions.join('; ')};`;
  element.setAttribute('style', merged);
}

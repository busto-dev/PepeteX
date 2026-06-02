import { randomBytes } from 'node:crypto';

import { SLIDE_CANVAS, validateGeneratedDeckContract } from '@pepetex/html-contract';

export interface ExportJobDescriptor {
  deckId: string;
  revisionId: string;
  format: 'pptx';
}

export const EXPORT_LAYOUT = 'LAYOUT_16x9' as const;
export const THUMBNAIL_CONTENT_TYPE = 'image/png' as const;

export interface ThumbnailRenderableSlide {
  id: string;
  title: string;
  html: string;
  css: string;
}

export interface ExportFontFace {
  id?: string;
  fontFamily: string;
  fontAliases?: readonly string[];
  mimeType: string;
  dataUrl: string;
  fontWeight?: number | string | null;
  fontStyle?: string | null;
}

export interface BuildSlideThumbnailDocumentInput {
  slide: ThumbnailRenderableSlide;
  allowedAssetHosts?: readonly string[];
  assetUrls?: Readonly<Record<string, string>>;
  fontFaces?: readonly ExportFontFace[];
}

export interface SlideThumbnailDocument {
  contentType: 'text/html';
  csp: string;
  html: string;
  viewport: typeof SLIDE_CANVAS;
}

// Self-hosted Inter is served from the web app at this absolute path. The
// thumbnail iframe, PPTX export render page, and PDF export render page all
// load the same URL so previews and exports share identical font metrics.
// crossorigin="anonymous" is required for dom-to-pptx's font detection to read
// the embedded font face without a CORS preflight failure.
export const INTER_FONT_STYLESHEET_URL = '/fonts/inter/inter.css';

const THUMBNAIL_BASE_CSS = [
  `html,body{margin:0;padding:0;width:${SLIDE_CANVAS.width}px;height:${SLIDE_CANVAS.height}px;overflow:hidden;background:#ffffff;}`,
  'body{font-family:Inter,Segoe UI,system-ui,sans-serif;}',
  // Defensive default. dom-to-pptx's parseColor returns transparent as null and
  // does not walk the parent chain, so a slide root without an explicit
  // background-color exports as neutral gray. Slide CSS that sets its own
  // .pepetex-slide background-color overrides this. See dom-to-pptx utils.js
  // parseColor() and packages/html-contract slide root contract.
  '.pepetex-slide{background-color:#ffffff;}'
].join('');

export function buildSlideThumbnailDocument(
  input: BuildSlideThumbnailDocumentInput
): SlideThumbnailDocument {
  const cspOptions: {
    allowedAssetHosts?: readonly string[];
    assetUrls?: Readonly<Record<string, string>>;
  } = {};

  if (input.allowedAssetHosts) {
    cspOptions.allowedAssetHosts = input.allowedAssetHosts;
  }

  if (input.assetUrls) {
    cspOptions.assetUrls = input.assetUrls;
  }

  const csp = createThumbnailCsp(cspOptions);
  const fontFaceCss = buildFontFaceCss(input.fontFaces);

  return {
    contentType: 'text/html',
    csp,
    viewport: SLIDE_CANVAS,
    html: [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">`,
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escapeHtml(input.slide.title)}</title>`,
      `<link rel="stylesheet" href="${escapeHtml(INTER_FONT_STYLESHEET_URL)}" crossorigin="anonymous">`,
      ...(fontFaceCss ? [`<style>${fontFaceCss}</style>`] : []),
      `<style>${THUMBNAIL_BASE_CSS}</style>`,
      `<style>${escapeStyleText(input.slide.css)}</style>`,
      '</head>',
      '<body>',
      input.slide.html,
      '</body>',
      '</html>'
    ].join('')
  };
}

function createThumbnailCsp(input: {
  allowedAssetHosts?: readonly string[];
  assetUrls?: Readonly<Record<string, string>>;
}): string {
  const assetSources = collectAssetSources(input.allowedAssetHosts, input.assetUrls);
  const mediaSources = ['data:', ...assetSources].join(' ');

  return [
    "default-src 'none'",
    // Self for /fonts/inter/inter.css. 'unsafe-inline' is required for the
    // per-slide <style> blocks injected below.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${mediaSources}`,
    // 'self' so the self-hosted Inter woff2 files can be fetched alongside
    // any allowedAssetHosts the caller permits.
    `font-src 'self' ${mediaSources}`,
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
}

function collectAssetSources(
  allowedAssetHosts: readonly string[] | undefined,
  assetUrls: Readonly<Record<string, string>> | undefined
): string[] {
  const sources = new Set<string>();

  for (const hostEntry of allowedAssetHosts ?? []) {
    const normalizedHost = normalizeHostEntry(hostEntry);

    if (!normalizedHost) {
      continue;
    }

    sources.add(`https://${normalizedHost}`);
    sources.add(`https://*.${normalizedHost}`);
  }

  if (assetUrls) {
    for (const assetUrl of Object.values(assetUrls)) {
      try {
        const url = new URL(assetUrl);

        if (url.protocol === 'https:') {
          sources.add(url.origin);
        }
      } catch {
        continue;
      }
    }
  }

  return [...sources].sort();
}

function normalizeHostEntry(hostEntry: string): string | null {
  const trimmed = hostEntry.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.includes('://')) {
    try {
      return new URL(trimmed).hostname;
    } catch {
      return null;
    }
  }

  return trimmed.replace(/^\*\./, '');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeStyleText(value: string): string {
  return value.replace(/<\/style/gi, '<\\/style');
}

function buildFontFaceCss(fontFaces: readonly ExportFontFace[] | undefined): string {
  if (!fontFaces || fontFaces.length === 0) return '';

  return expandFontFaces(fontFaces)
    .map((font) => {
      if (!font.fontFamily.trim() || !isSafeFontDataUrl(font.dataUrl)) return null;
      const descriptors = [
        `font-family:"${escapeCssString(font.fontFamily)}"`,
        `src:url("${escapeCssString(font.dataUrl)}") format("${fontFormatForMime(font.mimeType)}")`,
        `font-display:block`,
        font.fontWeight !== undefined && font.fontWeight !== null
          ? `font-weight:${String(font.fontWeight)}`
          : null,
        font.fontStyle
          ? `font-style:${escapeCssIdentifier(font.fontStyle)}`
          : `font-style:normal`
      ].filter(Boolean);
      return `@font-face{${descriptors.join(';')}}`;
    })
    .filter((rule): rule is string => Boolean(rule))
    .join('\n');
}

function buildDomToPptxFontList(fontFaces: readonly ExportFontFace[] | undefined): Array<{ name: string; url: string }> {
  if (!fontFaces || fontFaces.length === 0) return [];
  return expandFontFaces(fontFaces)
    .filter((font) => font.fontFamily.trim() && isDomToPptxEmbeddableFontDataUrl(font.dataUrl))
    .map((font) => ({ name: font.fontFamily, url: dataUrlWithFontExtensionHint(font.dataUrl) }));
}

function buildSingleFileFontFamilyList(fontFaces: readonly ExportFontFace[] | undefined): string[] {
  if (!fontFaces || fontFaces.length === 0) return [];
  return [...new Set(
    expandFontFaces(fontFaces)
      .filter((font) => font.fontFamily.trim() && isDomToPptxEmbeddableFontDataUrl(font.dataUrl))
      .map((font) => font.fontFamily.trim())
  )];
}

function expandFontFaces(fontFaces: readonly ExportFontFace[]): ExportFontFace[] {
  const expanded: ExportFontFace[] = [];
  const seen = new Set<string>();

  for (const font of fontFaces) {
    const families = [
      font.fontFamily,
      ...(font.fontAliases ?? []),
      ...deriveFontFamilyAliases(font.fontFamily),
      ...(font.fontAliases ?? []).flatMap(deriveFontFamilyAliases)
    ];
    for (const family of families) {
      const normalizedFamily = family.trim();
      if (!normalizedFamily) continue;
      const key = [
        normalizedFamily.toLowerCase(),
        font.dataUrl,
        font.fontWeight ?? '',
        font.fontStyle ?? ''
      ].join('\u0000');
      if (seen.has(key)) continue;
      seen.add(key);
      expanded.push({ ...font, fontFamily: normalizedFamily });
    }
  }

  return expanded;
}

function deriveFontFamilyAliases(fontFamily: string): string[] {
  const trimmed = fontFamily.trim().replace(/^["']|["']$/g, '');
  const match = /^(.*?)[\s_-]+(regular|book|medium|semibold|semi-bold|bold|extrabold|extra-bold|black|heavy)$/i.exec(trimmed);
  if (!match?.[1] || !match[2]) return [];

  const prefix = match[1].trim();
  const style = match[2].replace(/[^a-z]/gi, '');
  const aliases = new Set<string>();
  if (new RegExp(`${style}$`, 'i').test(prefix.replace(/[^a-z0-9]/gi, ''))) {
    aliases.add(prefix);
  } else {
    aliases.add(`${prefix}${style[0]?.toUpperCase() ?? ''}${style.slice(1).toLowerCase()}`);
  }

  return [...aliases];
}

function isSafeFontDataUrl(value: string): boolean {
  return /^data:(font\/(?:ttf|otf|woff|woff2)|application\/(?:font-woff|font-woff2|x-font-ttf|x-font-otf|vnd\.ms-opentype|font-sfnt));base64,[a-z0-9+/=]+$/i.test(value);
}

function isDomToPptxEmbeddableFontDataUrl(value: string): boolean {
  return /^data:(font\/(?:ttf|otf|woff)|application\/(?:font-woff|x-font-ttf|x-font-otf|vnd\.ms-opentype|font-sfnt));base64,[a-z0-9+/=]+$/i.test(value);
}

function dataUrlWithFontExtensionHint(value: string): string {
  const mimeType = value.slice(5, value.indexOf(';')).toLowerCase();
  const extension = mimeType.includes('woff')
    ? 'woff'
    : mimeType.includes('opentype') || mimeType.includes('otf')
      ? 'otf'
      : 'ttf';
  return `${value}#.${extension}`;
}

function fontFormatForMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('woff2')) return 'woff2';
  if (normalized.includes('woff')) return 'woff';
  if (normalized.includes('opentype') || normalized.includes('otf')) return 'opentype';
  return 'truetype';
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n|\r|\f/g, ' ');
}

function escapeCssIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

// Each slide's CSS is scoped to the shared `.pepetex-slide` class by the
// html-contract validator. That isolates a slide's CSS from the surrounding
// page chrome, but it does NOT isolate slides from EACH OTHER: when every
// slide's CSS is concatenated into a single export document, multiple slides
// declaring the same selector — e.g. `.pepetex-slide { flex-direction: row }`
// vs `column`, or a reused `.badge`/`.left-panel` class — collide, and the
// last-declared rule wins for ALL slides. That collapses layouts, swaps
// backgrounds, and corrupts colors in the exported PPTX/PDF. The in-app preview
// never hits this because it renders each slide in its own isolated document.
//
// We restore per-slide isolation by rewriting each slide's `.pepetex-slide`
// root token to an attribute selector that targets only that slide's root
// element (every slide root carries a unique data-pepetex-slide-id matching the
// slide id). Because the validator scopes every selector under `.pepetex-slide`,
// rewriting that single token scopes the entire slide. The attribute selector
// has the same specificity (0,1,0) as the original class and is emitted after
// the document's base `.pepetex-slide` rule, so it still wins the cascade.
export function scopeSlideCssToRoot(css: string, slideId: string): string {
  const escapedId = slideId.replace(/["\\]/g, '\\$&');
  const attrSelector = `[data-pepetex-slide-id="${escapedId}"]`;
  // Match `.pepetex-slide` only as a complete class token — the negative
  // lookahead prevents corrupting class names like `.pepetex-slide-inner`.
  return css.replace(/\.pepetex-slide(?![\w-])/g, attrSelector);
}

// ─── PPTX Export page ────────────────────────────────────────────────────────

export interface PptxExportRenderable {
  id: string;
  title: string;
  html: string;
  css: string;
}

export interface BuildPptxExportDocumentInput {
  slides: PptxExportRenderable[];
  fileName: string;
  domToPptxScriptUrl: string;
  allowedAssetHosts?: readonly string[];
  assetUrls?: Readonly<Record<string, string>>;
  fontFaces?: readonly ExportFontFace[];
}

export interface PptxExportDocument {
  contentType: 'text/html';
  csp: string;
  html: string;
}

export function buildPptxExportDocument(
  input: BuildPptxExportDocumentInput
): PptxExportDocument {
  const scriptNonce = createCspNonce();
  const cspInput: { allowedAssetHosts?: readonly string[]; assetUrls?: Readonly<Record<string, string>>; scriptSrc: string; scriptNonce: string } = {
    scriptNonce,
    scriptSrc: input.domToPptxScriptUrl
  };
  if (input.allowedAssetHosts) cspInput.allowedAssetHosts = input.allowedAssetHosts;
  if (input.assetUrls) cspInput.assetUrls = input.assetUrls;

  const csp = createPptxExportCsp(cspInput);

  // Consolidate per-slide CSS into a single <style> block in <head>. dom-to-pptx
  // USAGE.md explicitly recommends inline styles or <head>-scoped <style> blocks
  // over interleaving <style> tags inside <body> between slide HTML — the
  // interleaved pattern triggers reliability issues in the converter (e.g. grid
  // containers measured before their stylesheet applies, producing collapsed
  // vertical-stack layouts in PPTX). Each slide's CSS is re-scoped to its own
  // root via scopeSlideCssToRoot so slides sharing generic class names
  // (.pepetex-slide, .badge, .left-panel, …) cannot override one another.
  const consolidatedSlideCss = input.slides
    .map((slide) => `/* slide ${slide.id} */\n${scopeSlideCssToRoot(slide.css, slide.id)}`)
    .join('\n\n');
  const fontFaceCss = buildFontFaceCss(input.fontFaces);
  const exportFonts = buildDomToPptxFontList(input.fontFaces);
  const singleFileFontFamilies = buildSingleFileFontFamilyList(input.fontFaces);

  const slideSections = input.slides
    .map((slide) => slide.html)
    .join('\n');

  const safeFileName = escapeHtml(input.fileName);

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">`,
    '<meta name="viewport" content="width=1920">',
    // Self-hosted Inter. crossorigin="anonymous" is required for dom-to-pptx's
    // font detection — without it the font face is opaque to the converter and
    // PowerPoint falls back to Arial.
    `<link rel="stylesheet" href="${escapeHtml(INTER_FONT_STYLESHEET_URL)}" crossorigin="anonymous">`,
    ...(fontFaceCss ? [`<style>${fontFaceCss}</style>`] : []),
    `<style>`,
    // Base CSS aligned with the in-app slide preview iframe so the captured
    // slide region matches what users see at preview time. dom-to-pptx iterates
    // each .pepetex-slide via getBoundingClientRect, so there is no need for
    // visual gaps between slides on the export render page.
    `html,body{margin:0;padding:0;background:#ffffff;overflow:hidden;}`,
    `body{font-family:Inter,Segoe UI,system-ui,sans-serif;}`,
    // background-color default: dom-to-pptx parseColor() treats transparent as
    // null and does not inherit from the parent chain, so a slide whose CSS
    // omits a root background renders as neutral gray in PPTX. Slide CSS that
    // sets its own .pepetex-slide background-color (or a sibling background
    // panel) overrides this default.
    `.pepetex-slide{display:block;width:${SLIDE_CANVAS.width}px;height:${SLIDE_CANVAS.height}px;position:relative;overflow:hidden;margin:0;background-color:#ffffff;}`,
    escapeStyleText(consolidatedSlideCss),
    `</style>`,
    `<script nonce="${escapeHtml(scriptNonce)}" src="${escapeHtml(input.domToPptxScriptUrl)}"></script>`,
    '</head>',
    '<body>',
    slideSections,
    `<script nonce="${escapeHtml(scriptNonce)}">`,
    `(function(){`,
    `  var _fileName = ${JSON.stringify(safeFileName)};`,
    `  var _fonts = ${JSON.stringify(exportFonts)};`,
    `  var _singleFileFontFamilies = new Set(${JSON.stringify(singleFileFontFamilies)});`,
    `  window.pepetexExportReady = false;`,
    `  window.pepetexExportError = null;`,
    `  // Capture console warnings/errors during export so the worker can surface`,
    `  // dom-to-pptx rasterization fallbacks (transform / backdrop-filter /`,
    `  // clip-path / unsupported gradients silently fall back to html2canvas PNGs).`,
    `  window.pepetexExportWarnings = [];`,
    `  function _stringifyArg(arg){`,
    `    if(typeof arg === 'string') return arg;`,
    `    try { return JSON.stringify(arg); } catch(_e){ return String(arg); }`,
    `  }`,
    `  function _captureConsole(level){`,
    `    var orig = console[level];`,
    `    if(typeof orig !== 'function') return;`,
    `    console[level] = function(){`,
    `      try {`,
    `        var msg = Array.prototype.map.call(arguments, _stringifyArg).join(' ');`,
    `        window.pepetexExportWarnings.push({ level: level, message: msg });`,
    `      } catch(_e){}`,
    `      return orig.apply(console, arguments);`,
    `    };`,
    `  }`,
    `  _captureConsole('warn');`,
    `  _captureConsole('error');`,
    `  function getDomToPptxApi(){`,
    `    var api = window.domToPptx || window.DomToPptx || window.domtopptx;`,
    `    return api && typeof api.exportToPptx === 'function' ? api : null;`,
    `  }`,
    `  function markReadyIfLoaded(){`,
    `    if(getDomToPptxApi()){`,
    `      window.pepetexExportReady = true;`,
    `      window.pepetexExportError = null;`,
    `      return true;`,
    `    }`,
    `    return false;`,
    `  }`,
    `  window.pepetexRunExport = async function(overrideFileName){`,
    `    var api = getDomToPptxApi();`,
    `    if(!api) throw new Error(window.pepetexExportError || 'dom-to-pptx browser API is not loaded on the export page.');`,
    `    var elements = Array.from(document.querySelectorAll('.pepetex-slide'));`,
    `    if(!elements.length) throw new Error('No .pepetex-slide elements found');`,
    `    if(_singleFileFontFamilies.size){`,
    `      document.querySelectorAll('.pepetex-slide,.pepetex-slide *').forEach(function(el){`,
    `        var family = (getComputedStyle(el).fontFamily || '').split(',')[0].replace(/['"]/g,'').trim();`,
    `        if(_singleFileFontFamilies.has(family)) el.style.fontWeight = '400';`,
    `      });`,
    `    }`,
    `    // Wait for any web fonts to finish loading so dom-to-pptx's autoEmbedFonts`,
    `    // sees the final font set. Without this the export sometimes embeds the`,
    `    // fallback font stack instead of the slide's intended typography.`,
    `    if(document.fonts && typeof document.fonts.ready?.then === 'function'){`,
    `      try { await document.fonts.ready; } catch(_e){}`,
    `    }`,
    `    var blob = await api.exportToPptx(elements,{`,
    `      fileName: overrideFileName || _fileName,`,
    `      skipDownload: true,`,
    `      svgAsVector: true,`,
    `      autoEmbedFonts: true,`,
    `      fonts: _fonts,`,
    `      layout: 'LAYOUT_16x9'`,
    `    });`,
    `    return new Promise(function(resolve,reject){`,
    `      var reader = new FileReader();`,
    `      reader.onloadend = function(){ resolve(reader.result); };`,
    `      reader.onerror = reject;`,
    `      reader.readAsDataURL(blob);`,
    `    });`,
    `  };`,
    `  if(!markReadyIfLoaded()){`,
    `    var attempts = 0;`,
    `    var readyTimer = setInterval(function(){`,
    `      attempts += 1;`,
    `      if(markReadyIfLoaded()){`,
    `        clearInterval(readyTimer);`,
    `      } else if(attempts >= 100){`,
    `        clearInterval(readyTimer);`,
    `        window.pepetexExportError = 'dom-to-pptx browser API did not load on the export page.';`,
    `      }`,
    `    }, 100);`,
    `  }`,
    `}())`,
    '</script>',
    '</body>',
    '</html>'
  ].join('\n');

  return { contentType: 'text/html', csp, html };
}

function createPptxExportCsp(input: {
  allowedAssetHosts?: readonly string[];
  assetUrls?: Readonly<Record<string, string>>;
  scriptSrc: string;
  scriptNonce: string;
}): string {
  const assetSources = collectAssetSources(input.allowedAssetHosts, input.assetUrls);
  const mediaSources = ['data:', ...assetSources].join(' ');

  // scriptSrc is same-origin relative path like /_pepetex/dom-to-pptx.bundle.js.
  // The inline bootstrap script uses a nonce so the page can keep unsafe-inline disabled.
  const scriptSources = ["'self'", `'nonce-${input.scriptNonce}'`].join(' ');

  return [
    "default-src 'none'",
    `script-src ${scriptSources}`,
    // 'self' allows the /fonts/inter/inter.css stylesheet; 'unsafe-inline' is
    // required for the per-slide <style> block.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${mediaSources}`,
    // 'self' for the self-hosted Inter woff2 files.
    `font-src 'self' ${mediaSources}`,
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
}

function createCspNonce(): string {
  return randomBytes(16).toString('base64');
}

// ─── PDF Export page ─────────────────────────────────────────────────────────
//
// PDF export bypasses dom-to-pptx entirely. The Playwright worker navigates to
// this page, waits for `window.pepetexPdfReady === true`, then calls
// `page.pdf()` with width/height set to the slide canvas. Because rendering
// goes through Chromium itself, the resulting PDF is essentially identical to
// what the user sees in the preview — no PowerPoint text-engine drift.

export interface PdfExportRenderable {
  id: string;
  title: string;
  html: string;
  css: string;
}

export interface BuildPdfExportDocumentInput {
  slides: PdfExportRenderable[];
  fileName: string;
  allowedAssetHosts?: readonly string[];
  assetUrls?: Readonly<Record<string, string>>;
  fontFaces?: readonly ExportFontFace[];
}

export interface PdfExportDocument {
  contentType: 'text/html';
  csp: string;
  html: string;
}

export function buildPdfExportDocument(
  input: BuildPdfExportDocumentInput
): PdfExportDocument {
  const scriptNonce = createCspNonce();
  const cspInput: {
    allowedAssetHosts?: readonly string[];
    assetUrls?: Readonly<Record<string, string>>;
    scriptNonce: string;
  } = { scriptNonce };
  if (input.allowedAssetHosts) cspInput.allowedAssetHosts = input.allowedAssetHosts;
  if (input.assetUrls) cspInput.assetUrls = input.assetUrls;

  const csp = createPdfExportCsp(cspInput);

  // See scopeSlideCssToRoot — slides share generic class names, so each slide's
  // CSS must be scoped to its own root to avoid cross-slide cascade collisions.
  const consolidatedSlideCss = input.slides
    .map((slide) => `/* slide ${slide.id} */\n${scopeSlideCssToRoot(slide.css, slide.id)}`)
    .join('\n\n');
  const fontFaceCss = buildFontFaceCss(input.fontFaces);

  const slideSections = input.slides
    .map((slide) => slide.html)
    .join('\n');

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">`,
    '<meta name="viewport" content="width=1920">',
    `<link rel="stylesheet" href="${escapeHtml(INTER_FONT_STYLESHEET_URL)}" crossorigin="anonymous">`,
    ...(fontFaceCss ? [`<style>${fontFaceCss}</style>`] : []),
    `<style>`,
    // @page must match the page.pdf() width/height exactly. `preferCSSPageSize`
    // on the Playwright side honors this. printBackground=true on the caller
    // side preserves backgrounds/shadows. The print-color-adjust:exact lines
    // are required for solid background colors to print at full saturation.
    `@page{size:${SLIDE_CANVAS.width}px ${SLIDE_CANVAS.height}px;margin:0;}`,
    `html,body{margin:0;padding:0;background:#ffffff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}`,
    `body{font-family:Inter,Segoe UI,system-ui,sans-serif;}`,
    `.pepetex-slide{display:block;width:${SLIDE_CANVAS.width}px;height:${SLIDE_CANVAS.height}px;position:relative;overflow:hidden;margin:0;background-color:#ffffff;break-after:page;page-break-after:always;}`,
    `.pepetex-slide:last-child{break-after:auto;page-break-after:auto;}`,
    escapeStyleText(consolidatedSlideCss),
    `</style>`,
    '</head>',
    '<body>',
    slideSections,
    `<script nonce="${escapeHtml(scriptNonce)}">`,
    `(function(){`,
    `  window.pepetexPdfReady = false;`,
    `  window.pepetexPdfError = null;`,
    `  window.pepetexExportWarnings = [];`,
    `  function _stringifyArg(arg){`,
    `    if(typeof arg === 'string') return arg;`,
    `    try { return JSON.stringify(arg); } catch(_e){ return String(arg); }`,
    `  }`,
    `  function _captureConsole(level){`,
    `    var orig = console[level];`,
    `    if(typeof orig !== 'function') return;`,
    `    console[level] = function(){`,
    `      try {`,
    `        var msg = Array.prototype.map.call(arguments, _stringifyArg).join(' ');`,
    `        window.pepetexExportWarnings.push({ level: level, message: msg });`,
    `      } catch(_e){}`,
    `      return orig.apply(console, arguments);`,
    `    };`,
    `  }`,
    `  _captureConsole('warn');`,
    `  _captureConsole('error');`,
    `  async function _settleResources(){`,
    `    // Wait for fonts to fully load — without this, Chromium can render the`,
    `    // PDF mid-font-swap and produce a flash-of-fallback-font effect on early`,
    `    // slides.`,
    `    if(document.fonts && typeof document.fonts.ready?.then === 'function'){`,
    `      try { await document.fonts.ready; } catch(_e){}`,
    `    }`,
    `    // Wait for all <img> elements to decode. Chromium's print pipeline does`,
    `    // not block on image decode, so a slow image can produce a missing`,
    `    // graphic in the PDF output even though the network request completed.`,
    `    var imgs = Array.from(document.images || []);`,
    `    await Promise.all(imgs.map(function(img){`,
    `      if(img.complete && img.naturalWidth > 0){ return Promise.resolve(); }`,
    `      return new Promise(function(resolve){`,
    `        var done = false;`,
    `        function finish(){ if(!done){ done = true; resolve(); } }`,
    `        img.addEventListener('load', finish, { once: true });`,
    `        img.addEventListener('error', finish, { once: true });`,
    `        setTimeout(finish, 15000);`,
    `      });`,
    `    }));`,
    `  }`,
    `  _settleResources().then(function(){`,
    `    window.pepetexPdfReady = true;`,
    `  }).catch(function(err){`,
    `    window.pepetexPdfError = err && err.message ? err.message : String(err);`,
    `    window.pepetexPdfReady = true; // proceed anyway; worker checks pepetexPdfError`,
    `  });`,
    `}())`,
    '</script>',
    '</body>',
    '</html>'
  ].join('\n');

  return { contentType: 'text/html', csp, html };
}

function createPdfExportCsp(input: {
  allowedAssetHosts?: readonly string[];
  assetUrls?: Readonly<Record<string, string>>;
  scriptNonce: string;
}): string {
  const assetSources = collectAssetSources(input.allowedAssetHosts, input.assetUrls);
  const mediaSources = ['data:', ...assetSources].join(' ');

  const scriptSources = ["'self'", `'nonce-${input.scriptNonce}'`].join(' ');

  return [
    "default-src 'none'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${mediaSources}`,
    `font-src 'self' ${mediaSources}`,
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
}

// ─── Export dry-run ───────────────────────────────────────────────────────────

export interface ExportDryRunResult {
  ok: boolean;
  slideCount: number;
  errors: Array<{ slideId: string; code: string; message: string }>;
  warnings: Array<{ slideId: string; code: string; message: string }>;
}

export function runExportDryRun(deck: unknown): ExportDryRunResult {
  const slideResults = validateGeneratedDeckContract({ deck });
  const errors: ExportDryRunResult['errors'] = [];
  const warnings: ExportDryRunResult['warnings'] = [];

  for (const slideResult of slideResults) {
    const slideId = slideResult.elementIndex[0]?.id ?? 'unknown';
    for (const err of slideResult.errors) {
      errors.push({ slideId, code: err.code, message: err.message });
    }
    for (const warn of slideResult.warnings) {
      warnings.push({ slideId, code: warn.code, message: warn.message });
    }
  }

  const deckObj = deck as { slides?: unknown[] } | null;
  const slideCount = Array.isArray(deckObj?.slides) ? deckObj.slides.length : 0;

  return {
    ok: errors.length === 0,
    slideCount,
    errors,
    warnings
  };
}

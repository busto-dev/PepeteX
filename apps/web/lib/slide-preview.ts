export const PREVIEW_MESSAGE_SOURCE = 'pepetex-preview';
export const PREVIEW_IFRAME_SANDBOX = 'allow-scripts';

export type PreviewValidationSeverity = 'ok' | 'warning' | 'repair_required' | 'blocked';
export type PreviewRuntimeMessageType =
  | 'ready'
  | 'render-error'
  | 'console-error'
  | 'console-warn'
  | 'element-click';

export interface PreviewIssue {
  code: string;
  message: string;
  detail?: string;
}

export interface PreviewSlideDocument {
  id: string;
  title: string;
  html: string;
  css: string;
}

export interface PreviewSlideValidationState {
  severity: PreviewValidationSeverity;
  errors: PreviewIssue[];
  warnings: PreviewIssue[];
}

export interface BuildSlidePreviewDocumentInput {
  slide: PreviewSlideDocument;
  validation?: PreviewSlideValidationState;
  allowedAssetHosts?: readonly string[];
  assetUrls?: Readonly<Record<string, string>>;
  fontFaces?: readonly PreviewFontFace[];
}

export interface PreviewFontFace {
  id?: string;
  fontFamily: string;
  fontAliases?: readonly string[];
  mimeType: string;
  dataUrl: string;
  fontWeight?: number | string | null;
  fontStyle?: string | null;
}

export interface SlidePreviewDocument {
  channel: string;
  csp: string;
  sandbox: typeof PREVIEW_IFRAME_SANDBOX;
  srcdoc: string;
  validation: PreviewSlideValidationState;
}

export interface PreviewRuntimeMessage {
  source: typeof PREVIEW_MESSAGE_SOURCE;
  channel: string;
  type: PreviewRuntimeMessageType;
  message?: string;
  detail?: string;
  elementCount?: number;
  elementId?: string;
  elementType?: string;
}

export interface PreviewCommandMessage {
  source: 'pepetex-parent';
  channel: string;
  command: 'enableCommentMode' | 'disableCommentMode' | 'setInteractionMode' | 'setSelectedElement';
  mode?: 'none' | 'comment' | 'edit';
  selectedElementId?: string | null;
}

const FRAME_BASE_CSS = [
  'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#ffffff;}',
  'body{font-family:Inter,Segoe UI,system-ui,sans-serif;}',
  '#pepetex-preview-root{display:grid;place-items:center;width:100%;height:100%;overflow:hidden;background:#ffffff;}',
  '#pepetex-preview-stage{position:relative;overflow:hidden;}'
].join('');

export function buildSlidePreviewDocument(
  input: BuildSlidePreviewDocumentInput
): SlidePreviewDocument {
  const validation = normalizeValidation(input.validation);
  const seed = [
    input.slide.id,
    input.slide.title,
    input.slide.html,
    input.slide.css,
    validation.severity,
    validation.errors.map((error) => `${error.code}:${error.message}`).join('|'),
    validation.warnings.map((warning) => `${warning.code}:${warning.message}`).join('|')
  ].join('::');
  const token = createStableToken(seed);
  const channel = `preview_${token}`;
  const nonce = createPreviewNonce(token);
  const csp = createPreviewCsp({
    nonce,
    allowedAssetHosts: input.allowedAssetHosts,
    assetUrls: input.assetUrls
  });
  const fontFaceCss = buildFontFaceCss(input.fontFaces);

  return {
    channel,
    csp,
    sandbox: PREVIEW_IFRAME_SANDBOX,
    srcdoc: [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">`,
      `<title>${escapeHtml(input.slide.title)}</title>`,
      ...(fontFaceCss ? [`<style>${fontFaceCss}</style>`] : []),
      `<style>${FRAME_BASE_CSS}</style>`,
      '</head>',
      '<body>',
      '<div id="pepetex-preview-root"></div>',
      `<script nonce="${escapeHtml(nonce)}">${buildPreviewRuntimeScript({
        channel,
        html: input.slide.html,
        css: input.slide.css,
        title: input.slide.title
      })}</script>`,
      '</body>',
      '</html>'
    ].join(''),
    validation
  };
}

function buildFontFaceCss(fontFaces: readonly PreviewFontFace[] | undefined): string {
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

function isSafeFontDataUrl(value: string): boolean {
  return /^data:(font\/(?:ttf|otf|woff|woff2)|application\/(?:font-woff|font-woff2|x-font-ttf|x-font-otf|vnd\.ms-opentype|font-sfnt));base64,[a-z0-9+/=]+$/i.test(value);
}

function expandFontFaces(fontFaces: readonly PreviewFontFace[]): PreviewFontFace[] {
  const expanded: PreviewFontFace[] = [];
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

export function isPreviewRuntimeMessage(value: unknown): value is PreviewRuntimeMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (value.source !== PREVIEW_MESSAGE_SOURCE) {
    return false;
  }

  if (typeof value.channel !== 'string' || value.channel.length === 0) {
    return false;
  }

  return (
    value.type === 'ready' ||
    value.type === 'render-error' ||
    value.type === 'console-error' ||
    value.type === 'console-warn' ||
    value.type === 'element-click'
  );
}

function createPreviewCsp(input: {
  nonce: string;
  allowedAssetHosts?: readonly string[];
  assetUrls?: Readonly<Record<string, string>>;
}): string {
  const assetSources = collectAssetSources(input.allowedAssetHosts, input.assetUrls);
  const imageSources = ['data:', ...assetSources].join(' ');

  return [
    "default-src 'none'",
    `script-src 'nonce-${input.nonce}'`,
    "style-src 'unsafe-inline'",
    `img-src ${imageSources}`,
    `font-src ${imageSources}`,
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

function buildPreviewRuntimeScript(input: {
  channel: string;
  html: string;
  css: string;
  title: string;
}): string {
  const channel = serializeForInlineScript(input.channel);
  const title = serializeForInlineScript(input.title);
  const html = serializeForInlineScript(input.html);
  const css = serializeForInlineScript(input.css);

  return `
(() => {
  const channel = ${channel};
  const title = ${title};
  const html = ${html};
  const css = ${css};
  const root = document.getElementById('pepetex-preview-root');
  document.title = title;

  const report = (type, payload = {}) => {
    parent.postMessage(
      {
        source: '${PREVIEW_MESSAGE_SOURCE}',
        channel,
        type,
        ...payload
      },
      '*'
    );
  };

  const stringifyValue = (value) => {
    if (value instanceof Error) {
      return value.name + ': ' + value.message;
    }

    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const patchConsole = (methodName, messageType) => {
    const originalMethod = console[methodName];

    if (typeof originalMethod !== 'function') {
      return;
    }

    console[methodName] = (...args) => {
      report(messageType, {
        message: args.map(stringifyValue).join(' ')
      });
      return originalMethod.apply(console, args);
    };
  };

  patchConsole('error', 'console-error');
  patchConsole('warn', 'console-warn');

  window.addEventListener('error', (event) => {
    report('render-error', {
      message: event.message || 'Unhandled preview error.',
      detail:
        event.filename && event.lineno
          ? event.filename + ':' + event.lineno + ':' + (event.colno || 0)
          : undefined
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    report('render-error', {
      message: stringifyValue(event.reason || 'Unhandled preview rejection.')
    });
  });

  if (!root) {
    report('render-error', {
      message: 'Preview root element is missing.'
    });
    return;
  }

  try {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const stage = document.createElement('div');
    stage.id = 'pepetex-preview-stage';
    stage.innerHTML = html;
    root.replaceChildren(stage);

    const slide = stage.firstElementChild;

    if (!(slide instanceof HTMLElement)) {
      report('render-error', {
        message: 'Preview did not receive a slide root element.'
      });
      return;
    }

    const updateScale = () => {
      const width = Number(slide.getAttribute('data-pepetex-width')) || 1920;
      const height = Number(slide.getAttribute('data-pepetex-height')) || 1080;

      if (!width || !height) {
        report('render-error', {
          message: 'Preview slide dimensions are invalid.'
        });
        return;
      }

      const scale = Math.min(window.innerWidth / width, window.innerHeight / height);
      slide.style.transformOrigin = 'top left';
      slide.style.transform = 'scale(' + scale + ')';
      slide.style.width = width + 'px';
      slide.style.height = height + 'px';
      slide.style.overflow = 'hidden';
      stage.style.width = width * scale + 'px';
      stage.style.height = height * scale + 'px';
    };

    stage.querySelectorAll('img').forEach((image) => {
      image.addEventListener('error', () => {
        report('render-error', {
          message:
            'Preview image failed to load: ' +
            (image.currentSrc || image.getAttribute('src') || 'unknown asset')
        });
      });
    });

    const interactionStyle = document.createElement('style');
    interactionStyle.textContent = [
      '.pepetex-preview-target{outline:2px dashed rgba(99,102,241,.45)!important;outline-offset:4px!important;cursor:pointer!important;}',
      '.pepetex-preview-target-hover{outline:4px solid #ec4899!important;outline-offset:6px!important;box-shadow:0 0 0 10px rgba(236,72,153,.16)!important;}',
      '.pepetex-preview-target-selected{outline:4px solid #22c55e!important;outline-offset:7px!important;box-shadow:0 0 0 12px rgba(34,197,94,.18)!important;}',
      '.pepetex-preview-boundary{position:fixed;display:none;box-sizing:border-box;pointer-events:none;border-radius:10px;z-index:2147483647;}',
      '.pepetex-preview-hover-boundary{border:4px solid #ec4899;box-shadow:0 0 0 10px rgba(236,72,153,.16),0 18px 42px rgba(15,23,42,.20);}',
      '.pepetex-preview-selected-boundary{border:4px solid #22c55e;box-shadow:0 0 0 10px rgba(34,197,94,.18),0 18px 42px rgba(15,23,42,.20);}'
    ].join('');
    document.head.appendChild(interactionStyle);

    const hoverBoundary = document.createElement('div');
    hoverBoundary.className = 'pepetex-preview-boundary pepetex-preview-hover-boundary';
    document.body.appendChild(hoverBoundary);

    const selectedBoundary = document.createElement('div');
    selectedBoundary.className = 'pepetex-preview-boundary pepetex-preview-selected-boundary';
    document.body.appendChild(selectedBoundary);

    let interactionMode = 'none';
    let selectedElementId = null;
    let hoveredElement = null;
    let refreshInteractionState = () => {};

    const interactiveSelector = '[data-pepetex-id]';
    const getInteractiveElement = (eventTarget) => {
      if (!(eventTarget instanceof Element)) return null;
      const candidate = eventTarget.closest(interactiveSelector);
      return candidate && stage.contains(candidate) ? candidate : null;
    };

    const getInteractiveElements = () => Array.from(stage.querySelectorAll(interactiveSelector));

    const findElementById = (elementId) =>
      getInteractiveElements().find((element) => element.getAttribute('data-pepetex-id') === elementId) || null;

    const isUsableRect = (rect) =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right >= 0 &&
      rect.bottom >= 0 &&
      rect.left <= window.innerWidth &&
      rect.top <= window.innerHeight;

    const containsPoint = (rect, clientX, clientY) =>
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    const elementDepth = (element) => {
      let depth = 0;
      let current = element;
      while (current && current !== stage) {
        depth += 1;
        current = current.parentElement;
      }
      return depth;
    };

    const findInteractiveElementAtPoint = (clientX, clientY) => {
      const elementsFromPoint =
        typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(clientX, clientY) : [];

      for (const elementFromPoint of elementsFromPoint) {
        const interactiveElement = getInteractiveElement(elementFromPoint);
        if (interactiveElement) return interactiveElement;
      }

      return getInteractiveElements()
        .map((element, index) => ({
          element,
          index,
          rect: element.getBoundingClientRect(),
          depth: elementDepth(element)
        }))
        .filter(({ rect }) => isUsableRect(rect) && containsPoint(rect, clientX, clientY))
        .sort((a, b) => {
          const areaDelta = a.rect.width * a.rect.height - b.rect.width * b.rect.height;
          if (areaDelta !== 0) return areaDelta;
          const depthDelta = b.depth - a.depth;
          return depthDelta !== 0 ? depthDelta : b.index - a.index;
        })[0]?.element ?? null;
    };

    const renderBoundaryBox = (boundary, element) => {
      if (interactionMode === 'none' || !element) {
        boundary.style.display = 'none';
        return;
      }

      const rect = element.getBoundingClientRect();
      if (!isUsableRect(rect)) {
        boundary.style.display = 'none';
        return;
      }

      boundary.style.display = 'block';
      boundary.style.left = rect.left + 'px';
      boundary.style.top = rect.top + 'px';
      boundary.style.width = rect.width + 'px';
      boundary.style.height = rect.height + 'px';
    };

    const applyInteractionState = () => {
      document.body.dataset.pepetexMode = interactionMode;
      stage.dataset.pepetexMode = interactionMode;
      stage.style.cursor = interactionMode === 'none' ? '' : interactionMode === 'comment' ? 'crosshair' : 'text';
      getInteractiveElements().forEach((element) => {
        const id = element.getAttribute('data-pepetex-id');
        element.classList.toggle('pepetex-preview-target', interactionMode !== 'none');
        element.classList.toggle('pepetex-preview-target-hover', interactionMode !== 'none' && element === hoveredElement);
        element.classList.toggle('pepetex-preview-target-selected', interactionMode !== 'none' && !!selectedElementId && id === selectedElementId);
        element.toggleAttribute('data-pepetex-hovered', interactionMode !== 'none' && element === hoveredElement);
        element.toggleAttribute('data-pepetex-selected', interactionMode !== 'none' && !!selectedElementId && id === selectedElementId);
      });
      renderBoundaryBox(hoverBoundary, hoveredElement);
      renderBoundaryBox(selectedBoundary, selectedElementId ? findElementById(selectedElementId) : null);
    };

    refreshInteractionState = applyInteractionState;

    const updateHoveredElement = (element) => {
      if (element === hoveredElement) return;
      hoveredElement = element;
      applyInteractionState();
    };

    window.addEventListener('resize', () => {
      updateScale();
      refreshInteractionState();
    });
    updateScale();

    if (typeof ResizeObserver === 'function') {
      const viewportObserver = new ResizeObserver(() => {
        updateScale();
        refreshInteractionState();
      });
      viewportObserver.observe(document.documentElement);
    }

    requestAnimationFrame(() => {
      updateScale();
      refreshInteractionState();
      requestAnimationFrame(() => {
        updateScale();
        refreshInteractionState();
      });
    });

    stage.addEventListener('pointermove', (event) => {
      if (interactionMode === 'none') return;
      updateHoveredElement(findInteractiveElementAtPoint(event.clientX, event.clientY));
    }, true);

    stage.addEventListener('pointerleave', () => {
      if (interactionMode === 'none') return;
      updateHoveredElement(null);
    }, true);

    stage.addEventListener('mouseover', (event) => {
      if (interactionMode === 'none') return;
      updateHoveredElement(findInteractiveElementAtPoint(event.clientX, event.clientY) || getInteractiveElement(event.target));
    }, true);

    stage.addEventListener('mouseout', (event) => {
      if (interactionMode === 'none' || !hoveredElement) return;
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Element && hoveredElement.contains(nextTarget)) return;
      updateHoveredElement(null);
    }, true);

    stage.addEventListener('click', (event) => {
      if (interactionMode === 'none') return;
      const element = findInteractiveElementAtPoint(event.clientX, event.clientY) || getInteractiveElement(event.target);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      const id = element.getAttribute('data-pepetex-id');
      const type = element.getAttribute('data-pepetex-type');
      if (id) {
        selectedElementId = id;
        applyInteractionState();
        report('element-click', { elementId: id, elementType: type ?? undefined });
      }
    }, true);

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.source !== 'pepetex-parent' || data.channel !== channel) return;
      if (data.command === 'enableCommentMode') {
        interactionMode = 'comment';
      } else if (data.command === 'disableCommentMode') {
        interactionMode = 'none';
        selectedElementId = null;
        hoveredElement = null;
      } else if (data.command === 'setInteractionMode') {
        interactionMode = data.mode === 'comment' || data.mode === 'edit' ? data.mode : 'none';
        if (data.selectedElementId !== undefined) selectedElementId = data.selectedElementId;
        if (interactionMode === 'none') hoveredElement = null;
      } else if (data.command === 'setSelectedElement') {
        selectedElementId = data.selectedElementId ?? null;
      }
      applyInteractionState();
    });

    applyInteractionState();

    requestAnimationFrame(() => {
      report('ready', {
        elementCount: stage.querySelectorAll('[data-pepetex-id]').length
      });
    });
  } catch (error) {
    report('render-error', {
      message: stringifyValue(error)
    });
  }
})();
  `.trim();
}

function normalizeValidation(
  validation: PreviewSlideValidationState | undefined
): PreviewSlideValidationState {
  if (!validation) {
    return {
      severity: 'ok',
      errors: [],
      warnings: []
    };
  }

  return {
    severity: validation.severity,
    errors: [...validation.errors],
    warnings: [...validation.warnings]
  };
}

function serializeForInlineScript(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createStableToken(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}

function createPreviewNonce(token: string): string {
  return `pepetex${token.replace(/[^a-zA-Z0-9]/g, '')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

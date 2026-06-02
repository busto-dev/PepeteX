import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PREVIEW_IFRAME_SANDBOX,
  PREVIEW_MESSAGE_SOURCE,
  buildSlidePreviewDocument,
  isPreviewRuntimeMessage
} from './slide-preview';

describe('buildSlidePreviewDocument', () => {
  it('builds a sandboxed preview document with runtime diagnostics and CSP', () => {
    const result = buildSlidePreviewDocument({
      slide: {
        id: 'slide_intro',
        title: 'Intro',
        html: '<section data-pepetex-slide-id="slide_intro"><div data-pepetex-id="headline_1">Hello</div></section>',
        css: '[data-pepetex-slide-id="slide_intro"] { width: 1920px; height: 1080px; }'
      },
      allowedAssetHosts: ['assets.pepetex.internal'],
      assetUrls: {
        hero: 'https://cdn.assets.pepetex.internal/decks/hero.png'
      }
    });

    expect(result.sandbox).toBe(PREVIEW_IFRAME_SANDBOX);
    expect(result.csp).toContain("default-src 'none'");
    expect(result.csp).toContain("script-src 'nonce-");
    expect(result.csp).toContain('https://assets.pepetex.internal');
    expect(result.csp).toContain('https://*.assets.pepetex.internal');
    expect(result.csp).toContain('https://cdn.assets.pepetex.internal');
    expect(result.srcdoc).toContain('Content-Security-Policy');
    expect(result.srcdoc).toContain(PREVIEW_MESSAGE_SOURCE);
    expect(result.srcdoc).toContain('console-error');
    expect(result.srcdoc).toContain('render-error');
    expect(result.srcdoc).toContain('headline_1');
  });

  it('uses a nonce value without punctuation that can be matched by CSP consistently', () => {
    const result = buildSlidePreviewDocument({
      slide: {
        id: 'slide_intro',
        title: 'Intro',
        html: '<section data-pepetex-slide-id="slide_intro"></section>',
        css: ''
      }
    });

    const nonceMatch = result.srcdoc.match(/<script nonce="([^"]+)">/);
    expect(nonceMatch?.[1]).toMatch(/^pepetex[a-zA-Z0-9]+$/);
    expect(result.csp).toContain(`script-src 'nonce-${nonceMatch?.[1]}'`);
  });

  it('normalizes missing validation state to a clean ok payload', () => {
    const result = buildSlidePreviewDocument({
      slide: {
        id: 'slide_intro',
        title: 'Intro',
        html: '<section data-pepetex-slide-id="slide_intro"></section>',
        css: ''
      }
    });

    expect(result.validation).toEqual({
      severity: 'ok',
      errors: [],
      warnings: []
    });
  });

  it('injects trusted custom font faces into the preview srcdoc', () => {
    const result = buildSlidePreviewDocument({
      slide: {
        id: 'slide_intro',
        title: 'Intro',
        html: '<section data-pepetex-slide-id="slide_intro"></section>',
        css: '[data-pepetex-slide-id="slide_intro"] { font-family: "Brand Sans"; }'
      },
      fontFaces: [{
        fontFamily: 'Brand Sans',
        mimeType: 'font/woff2',
        dataUrl: 'data:font/woff2;base64,AAE=',
        fontWeight: 700
      }]
    });

    expect(result.srcdoc).toContain('@font-face');
    expect(result.srcdoc).toContain('font-family:"Brand Sans"');
    expect(result.srcdoc).toContain('data:font/woff2;base64,AAE=');
    expect(result.csp).toContain('font-src data:');
  });

  it('installs the interaction command listener before reporting ready', () => {
    const result = buildSlidePreviewDocument({
      slide: {
        id: 'slide_intro',
        title: 'Intro',
        html: '<section data-pepetex-slide-id="slide_intro"><div data-pepetex-id="headline_1" data-pepetex-type="headline">Hello</div></section>',
        css: ''
      }
    });

    const commandListenerIndex = result.srcdoc.indexOf("window.addEventListener('message'");
    const readyReportIndex = result.srcdoc.indexOf("report('ready'");

    expect(commandListenerIndex).toBeGreaterThan(-1);
    expect(readyReportIndex).toBeGreaterThan(-1);
    expect(commandListenerIndex).toBeLessThan(readyReportIndex);
    expect(result.srcdoc).toContain("data.command === 'setInteractionMode'");
  });

  it('uses preview-owned geometry overlays for comment target hover and click detection', () => {
    const result = buildSlidePreviewDocument({
      slide: {
        id: 'slide_intro',
        title: 'Intro',
        html: '<section data-pepetex-slide-id="slide_intro"><div data-pepetex-id="headline_1" data-pepetex-type="headline"><span>Hello</span></div></section>',
        css: '[data-pepetex-slide-id="slide_intro"] [data-pepetex-id] { pointer-events: none; }'
      }
    });

    expect(result.srcdoc).toContain('pepetex-preview-hover-boundary');
    expect(result.srcdoc).toContain('const findInteractiveElementAtPoint = (clientX, clientY)');
    expect(result.srcdoc).toContain("typeof document.elementsFromPoint === 'function'");
    expect(result.srcdoc).toContain("stage.addEventListener('pointermove'");
    expect(result.srcdoc).toContain('findInteractiveElementAtPoint(event.clientX, event.clientY) || getInteractiveElement(event.target)');
    expect(result.srcdoc).toContain('document.body.dataset.pepetexMode = interactionMode');
    expect(result.srcdoc).toContain("element.toggleAttribute('data-pepetex-selected'");
  });

  it('scales previews from the fixed PepeteX canvas instead of rendered content size', () => {
    const result = buildSlidePreviewDocument({
      slide: {
        id: 'slide_intro',
        title: 'Intro',
        html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_intro"><h1>Intro</h1></section>',
        css: '.pepetex-slide { width: 50%; height: auto; }'
      }
    });

    expect(result.srcdoc).toContain("Number(slide.getAttribute('data-pepetex-width')) || 1920");
    expect(result.srcdoc).toContain("Number(slide.getAttribute('data-pepetex-height')) || 1080");
    expect(result.srcdoc).toContain("slide.style.width = width + 'px'");
    expect(result.srcdoc).not.toContain('slide.offsetWidth || Number');
  });
});

describe('SlidePreviewFrame interaction bridge', () => {
  it('does not require the iframe ready message before posting interaction commands', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/SlidePreviewFrame.vue'), 'utf8');

    expect(source).toContain("import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';");
    expect(source).toContain('const pendingInteractionCommand = shallowRef<PreviewCommandMessage | null>(null);');
    expect(source).toContain('function postInteractionCommand(command: PreviewCommandMessage)');
    expect(source).toContain('if (!iframeLoaded.value) return false;');
    expect(source).toContain('source: command.source');
    expect(source).not.toContain('!iframeLoaded.value || !runtimeReady.value || !pendingInteractionCommand.value');
  });

  it('keys the iframe by preview channel and has a ready watchdog', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/SlidePreviewFrame.vue'), 'utf8');

    expect(source).toContain('const previewFrameKey = computed(() => `${previewDocument.value.channel}:${frameResetCounter.value}`);');
    expect(source).toContain(':key="previewFrameKey"');
    expect(source).toContain("code: 'PREVIEW_TIMEOUT'");
    expect(source).toContain('frameResetCounter.value += 1;');
  });
});

describe('Deck page comment entry points', () => {
  it('opens click-to-comment mode from the Comments tab', () => {
    const source = readFileSync(resolve(process.cwd(), 'pages/decks/[deckId].vue'), 'utf8');

    expect(source).toContain('@click="setCommentMode(true)">Comments</button>');
  });

  it('uses fresh deck detail titles before list titles and refreshes the list after generation', () => {
    const source = readFileSync(resolve(process.cwd(), 'pages/decks/[deckId].vue'), 'utf8');

    expect(source).toContain("{{ deckDetail?.title ?? selectedDeck?.title ?? 'Untitled presentation' }}");
    expect(source).toContain('if (run.status === \'COMPLETED\' && selectedDeckId.value) {');
    expect(source).toContain('if (currentWorkspaceId.value) await loadDecks(currentWorkspaceId.value)');
  });
});

describe('isPreviewRuntimeMessage', () => {
  it('accepts valid runtime messages', () => {
    expect(
      isPreviewRuntimeMessage({
        source: PREVIEW_MESSAGE_SOURCE,
        channel: 'preview_123',
        type: 'ready',
        elementCount: 4
      })
    ).toBe(true);
  });

  it('rejects invalid payloads', () => {
    expect(isPreviewRuntimeMessage(null)).toBe(false);
    expect(isPreviewRuntimeMessage({})).toBe(false);
    expect(
      isPreviewRuntimeMessage({
        source: PREVIEW_MESSAGE_SOURCE,
        channel: '',
        type: 'ready'
      })
    ).toBe(false);
    expect(
      isPreviewRuntimeMessage({
        source: PREVIEW_MESSAGE_SOURCE,
        channel: 'preview_123',
        type: 'not-a-real-event'
      })
    ).toBe(false);
  });
});

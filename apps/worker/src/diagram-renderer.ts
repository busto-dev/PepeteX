import { createRequire } from 'node:module';

import { chromium, type Browser } from 'playwright-core';
import type { SlideDiagramData } from '@pepetex/ai';

export interface RenderDiagramOptions {
  width?: number;
  height?: number;
}

// Resolve mermaid via Node's package resolver so it works the same in dev
// (source at apps/worker/src/) and in Docker (compiled to /app/dist/).
// Previous URL-based resolution (../../../node_modules/...) overshot the Docker
// node_modules layout and silently failed in addScriptTag, leaving every
// diagram container empty in production.
const MERMAID_SCRIPT_PATH = createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js');

const DEFAULT_DIAGRAM_WIDTH = 960;
const DEFAULT_DIAGRAM_HEIGHT = 540;

let browserInstance: Browser | null = null;

interface MermaidBrowserApi {
  initialize(options: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

async function getBrowser(): Promise<Browser> {
  if (!browserInstance) {
    const launchOptions: { headless: true; executablePath?: string } = { headless: true };
    const executablePath = process.env.PEPETEX_CHROMIUM_EXECUTABLE_PATH;
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }
    browserInstance = await chromium.launch(launchOptions);
  }
  return browserInstance;
}

export async function closeDiagramBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * Renders a Mermaid diagram to an SVG string using Playwright.
 * Maintains a shared headless browser instance for efficiency.
 */
export async function renderDiagramToSvg(
  diagramData: SlideDiagramData,
  options: RenderDiagramOptions = {}
): Promise<string> {
  // Mermaid is the only supported renderer; it auto-detects the diagram subtype
  // (graph, flowchart, sequenceDiagram, gantt, etc.) from the source itself, so we
  // accept any `kind` label and let mermaid parse the source. If the source isn't
  // valid mermaid, mermaid.render will throw and the caller should catch + skip.
  const width = options.width ?? DEFAULT_DIAGRAM_WIDTH;
  const height = options.height ?? DEFAULT_DIAGRAM_HEIGHT;

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>body{margin:0;padding:0;background:#fff;}</style>
        </head>
        <body>
          <div id="root"></div>
        </body>
      </html>
    `);

    await page.addScriptTag({ path: MERMAID_SCRIPT_PATH });

    const mermaidSource = diagramData.source;
    const diagramId = `pepetex-diagram-${diagramData.id}`;

    const svg = await page.evaluate(
      async ({ source, id }) => {
        const mermaid = (window as unknown as { mermaid: MermaidBrowserApi }).mermaid;
        mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' });
        const result = await mermaid.render(id, source);
        return result.svg as string;
      },
      { source: mermaidSource, id: diagramId }
    );

    return makeSvgResponsive(svg, width, height);
  } finally {
    await page.close();
  }
}

function makeSvgResponsive(svg: string, _width: number, _height: number): string {
  return svg
    .replace(/width="100%"/, 'width="100%"')
    .replace(/height="100%"/, 'height="100%"')
    .replace(
      /viewBox="([^"]+)"/,
      (match) => `${match} preserveAspectRatio="xMidYMid meet"`
    );
}

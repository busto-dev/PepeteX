// Shared Chromium-launch helpers for the export workers (PPTX + PDF).
//
// Both export paths drive a headless Chromium with the same launch arguments
// and the same playwright-core dynamic import. Keeping this in one module makes
// it cheap to add new export formats (e.g. SVG/PNG) and keeps fidelity flags
// like --font-render-hinting=none in a single place.

type PageLoadState = 'load' | 'domcontentloaded' | 'networkidle';

export interface ExportPageLike {
  goto(url: string, options?: { waitUntil?: PageLoadState; timeout?: number }): Promise<void>;
  waitForFunction(fn: () => boolean | Promise<boolean>, options?: { timeout?: number }): Promise<void>;
  evaluate<T>(fn: (...args: unknown[]) => T | Promise<T>, ...args: unknown[]): Promise<T>;
  setViewportSize(viewport: { width: number; height: number }): Promise<void>;
  // page.pdf() is Chromium-only and is what the PDF export uses. Match
  // Playwright's signature loosely so the seam stays test-friendly.
  pdf?(options: {
    width?: string | number;
    height?: string | number;
    printBackground?: boolean;
    preferCSSPageSize?: boolean;
    margin?: { top?: string | number; right?: string | number; bottom?: string | number; left?: string | number };
    scale?: number;
    pageRanges?: string;
  }): Promise<Buffer | Uint8Array>;
  emulateMedia?(options: { media?: 'screen' | 'print' }): Promise<void>;
  close(): Promise<void>;
}

export interface ExportBrowserLike {
  newPage(): Promise<ExportPageLike>;
  close(): Promise<void>;
}

export interface ExportBrowserLauncher {
  launch(options: {
    headless: boolean;
    executablePath?: string;
    args?: string[];
  }): Promise<ExportBrowserLike>;
}

// --font-render-hinting=none keeps kerning/letter-spacing closer to non-headless
// Chromium, which makes the PDF export visually closer to the browser preview.
// The other flags are the same set the PPTX worker has used since launch.
export const SHARED_BROWSER_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--hide-scrollbars',
  '--font-render-hinting=none'
] as const;

export async function loadPlaywrightLauncher(): Promise<ExportBrowserLauncher> {
  try {
    const { chromium } = await import('playwright-core');
    return chromium as unknown as ExportBrowserLauncher;
  } catch {
    throw new Error(
      'playwright-core is not installed. Install it in the worker app or provide a browserLauncher.'
    );
  }
}

export function buildBrowserLaunchError(error: unknown, executablePath: string | undefined): Error {
  const message = error instanceof Error ? error.message : String(error);
  const looksLikeMissingBrowser = /executable doesn't exist|browser has not been installed|No such file|ENOENT|chromium/i.test(message);

  if (!looksLikeMissingBrowser) {
    return error instanceof Error ? error : new Error(message);
  }

  const configuredPath = executablePath
    ? `Configured Chromium path: ${executablePath}`
    : 'No PEPETEX_CHROMIUM_EXECUTABLE_PATH was configured.';

  return new Error([
    message,
    '',
    'Local export requires a Playwright-compatible Chromium executable for the worker.',
    'Run: corepack yarn playwright:install',
    'Then restart the worker with: corepack yarn dev:worker',
    'Alternatively set PEPETEX_CHROMIUM_EXECUTABLE_PATH to a local chromium or headless-shell executable.',
    configuredPath
  ].join('\n'));
}

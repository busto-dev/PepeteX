/// <reference lib="dom" />

import {
  THUMBNAIL_CONTENT_TYPE,
  buildSlideThumbnailDocument,
  type BuildSlideThumbnailDocumentInput
} from '@pepetex/export';
import type { ObjectStorageAdapter } from '@pepetex/storage';
import type { ThumbnailGenerateJobPayload } from '@pepetex/queue';

import { getCachedObjectStorageAdapter } from './object-storage';

const THUMBNAIL_BROWSER_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--hide-scrollbars'
] as const;

type PageLoadState = 'load' | 'domcontentloaded' | 'networkidle';

export interface ThumbnailPageLike {
  setViewportSize(viewport: { width: number; height: number }): Promise<void>;
  setContent(html: string, options?: { waitUntil?: PageLoadState }): Promise<void>;
  waitForLoadState(state: PageLoadState): Promise<void>;
  evaluate<T>(pageFunction: () => T | Promise<T>): Promise<T>;
  screenshot(options: { type: 'png' }): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface ThumbnailBrowserLike {
  newPage(): Promise<ThumbnailPageLike>;
  close(): Promise<void>;
}

export interface ThumbnailBrowserLauncher {
  launch(options: {
    headless: boolean;
    executablePath?: string;
    args?: string[];
  }): Promise<ThumbnailBrowserLike>;
}

export interface RenderSlideThumbnailOptions {
  browserLauncher?: ThumbnailBrowserLauncher;
  browserExecutablePath?: string;
}

export interface RenderedSlideThumbnail {
  contentType: typeof THUMBNAIL_CONTENT_TYPE;
  width: number;
  height: number;
  bytes: Uint8Array;
}

export interface GenerateThumbnailJobOptions extends RenderSlideThumbnailOptions {
  getObjectStorageAdapter?: (bucket: string) => ObjectStorageAdapter;
}

export interface GenerateThumbnailJobResult {
  contentType: typeof THUMBNAIL_CONTENT_TYPE;
  width: number;
  height: number;
  sizeBytes: number;
  generatedAt: string;
  storageBucket?: string;
  storageObjectPath?: string;
  storageGeneration?: string;
  storageEtag?: string;
}

export async function renderSlideThumbnail(
  input: BuildSlideThumbnailDocumentInput,
  options: RenderSlideThumbnailOptions = {}
): Promise<RenderedSlideThumbnail> {
  const document = buildSlideThumbnailDocument(input);
  const browserLauncher = options.browserLauncher ?? createPlaywrightThumbnailBrowserLauncher();
  const browserExecutablePath = normalizeOptionalText(
    options.browserExecutablePath ?? process.env.PEPETEX_CHROMIUM_EXECUTABLE_PATH
  );
  const browser = await browserLauncher.launch({
    headless: true,
    ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
    args: [...THUMBNAIL_BROWSER_ARGS]
  });
  let page: ThumbnailPageLike | undefined;

  try {
    page = await browser.newPage();
    await page.setViewportSize(document.viewport);
    await page.setContent(document.html, {
      waitUntil: 'load'
    });
    await page.waitForLoadState('networkidle');
    await page.evaluate(waitForRenderableAssets);

    const screenshot = await page.screenshot({
      type: 'png'
    });

    return {
      contentType: THUMBNAIL_CONTENT_TYPE,
      width: document.viewport.width,
      height: document.viewport.height,
      bytes: normalizeBinary(screenshot)
    };
  } finally {
    await closeQuietly(page);
    await closeQuietly(browser);
  }
}

export async function runGenerateThumbnailJob(
  payload: ThumbnailGenerateJobPayload,
  options: GenerateThumbnailJobOptions = {}
): Promise<GenerateThumbnailJobResult> {
  const generatedAt = resolveRequestedAt(payload.requestedAt);
  const rendered = await renderSlideThumbnail(
    {
      slide: payload.slide,
      ...(payload.allowedAssetHosts ? { allowedAssetHosts: payload.allowedAssetHosts } : {}),
      ...(payload.assetUrls ? { assetUrls: payload.assetUrls } : {}),
      ...(payload.fontFaces ? { fontFaces: payload.fontFaces } : {})
    },
    options
  );
  const result: GenerateThumbnailJobResult = {
    contentType: rendered.contentType,
    width: rendered.width,
    height: rendered.height,
    sizeBytes: rendered.bytes.byteLength,
    generatedAt: generatedAt.toISOString()
  };
  const uploadTarget = resolveUploadTarget(payload);

  if (!uploadTarget) {
    return result;
  }

  const adapter = (options.getObjectStorageAdapter ?? getCachedObjectStorageAdapter)(
    uploadTarget.storageBucket
  );
  const storedObject = await adapter.putObject({
    objectPath: uploadTarget.storageObjectPath,
    body: rendered.bytes,
    contentType: rendered.contentType,
    metadata: {
      jobId: payload.jobId,
      slideId: payload.slide.id,
      ...(payload.deckId ? { deckId: payload.deckId } : {})
    }
  });

  return {
    ...result,
    storageBucket: storedObject.bucket,
    storageObjectPath: storedObject.objectPath,
    ...(storedObject.generation ? { storageGeneration: storedObject.generation } : {}),
    ...(storedObject.etag ? { storageEtag: storedObject.etag } : {})
  };
}

export function createPlaywrightThumbnailBrowserLauncher(): ThumbnailBrowserLauncher {
  return {
    async launch(options) {
      const { chromium } = await import('playwright-core');
      const browser = await chromium.launch({
        headless: options.headless,
        ...(options.executablePath ? { executablePath: options.executablePath } : {}),
        ...(options.args ? { args: options.args } : {})
      });

      return {
        async newPage() {
          const page = await browser.newPage();

          return {
            setViewportSize: (viewport) => page.setViewportSize(viewport),
            setContent: (html, setContentOptions) => page.setContent(html, setContentOptions),
            waitForLoadState: (state) => page.waitForLoadState(state),
            evaluate: (pageFunction) => page.evaluate(pageFunction),
            screenshot: async (screenshotOptions) =>
              new Uint8Array(await page.screenshot(screenshotOptions)),
            close: () => page.close()
          };
        },
        close: () => browser.close()
      };
    }
  };
}

async function waitForRenderableAssets(): Promise<void> {
  try {
    await document.fonts?.ready;
  } catch {
    // Ignore font-readiness failures and continue with the screenshot.
  }

  const images = Array.from(document.images);

  await Promise.all(
    images.map((image) => {
      if (image.complete) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        const done = () => resolve();
        image.addEventListener('load', done, { once: true });
        image.addEventListener('error', done, { once: true });
      });
    })
  );
}

async function closeQuietly(resource: { close(): Promise<void> } | undefined): Promise<void> {
  if (!resource) {
    return;
  }

  try {
    await resource.close();
  } catch {
    // Ignore close errors; the caller is already exiting the render path.
  }
}

function normalizeBinary(value: Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function resolveRequestedAt(value: string): Date {
  const requestedAt = new Date(value);

  if (Number.isNaN(requestedAt.getTime())) {
    throw new Error('Thumbnail job requestedAt must be a valid ISO timestamp.');
  }

  return requestedAt;
}

function resolveUploadTarget(payload: ThumbnailGenerateJobPayload):
  | {
      storageBucket: string;
      storageObjectPath: string;
    }
  | undefined {
  if (!payload.storageBucket && !payload.storageObjectPath) {
    return undefined;
  }

  if (!payload.storageBucket || !payload.storageObjectPath) {
    throw new Error(
      'Thumbnail jobs must provide both storageBucket and storageObjectPath when upload is requested.'
    );
  }

  return {
    storageBucket: normalizeRequiredText(payload.storageBucket, 'Thumbnail storage bucket'),
    storageObjectPath: normalizeRequiredText(
      payload.storageObjectPath,
      'Thumbnail storage object path'
    )
  };
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }

  return normalized;
}

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThumbnailGenerateJobPayload } from '@pepetex/queue';
import type { ObjectStorageAdapter } from '@pepetex/storage';

import {
  createPlaywrightThumbnailBrowserLauncher,
  renderSlideThumbnail,
  runGenerateThumbnailJob,
  type ThumbnailBrowserLauncher,
  type ThumbnailBrowserLike,
  type ThumbnailPageLike
} from './thumbnail-generation';

const setViewportSize = vi.fn();
const setContent = vi.fn();
const waitForLoadState = vi.fn();
const evaluate = vi.fn();
const screenshot = vi.fn();
const closePage = vi.fn();
const closeBrowser = vi.fn();
const launch = vi.fn();
const putObject = vi.fn();

describe('renderSlideThumbnail', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setViewportSize.mockResolvedValue(undefined);
    setContent.mockResolvedValue(undefined);
    waitForLoadState.mockResolvedValue(undefined);
    evaluate.mockResolvedValue(undefined);
    screenshot.mockResolvedValue(new Uint8Array([1, 2, 3]));
    closePage.mockResolvedValue(undefined);
    closeBrowser.mockResolvedValue(undefined);
    launch.mockResolvedValue(createBrowserMock());
  });

  it('renders a slide into a 1920x1080 png screenshot', async () => {
    const result = await renderSlideThumbnail(
      {
        slide: {
          id: 'slide_1',
          title: 'Board Update',
          html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_1" style="width: 1920px; height: 1080px;"></section>',
          css: '[data-pepetex-slide-id="slide_1"] { background: #fff; }'
        }
      },
      {
        browserLauncher: createLauncherMock()
      }
    );

    expect(launch).toHaveBeenCalledWith({
      headless: true,
      args: ['--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars']
    });
    expect(setViewportSize).toHaveBeenCalledWith({
      width: 1920,
      height: 1080
    });
    expect(setContent).toHaveBeenCalledTimes(1);
    expect(waitForLoadState).toHaveBeenCalledWith('networkidle');
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(screenshot).toHaveBeenCalledWith({
      type: 'png'
    });
    expect(result).toEqual({
      contentType: 'image/png',
      width: 1920,
      height: 1080,
      bytes: new Uint8Array([1, 2, 3])
    });
    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });
});

describe('runGenerateThumbnailJob', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setViewportSize.mockResolvedValue(undefined);
    setContent.mockResolvedValue(undefined);
    waitForLoadState.mockResolvedValue(undefined);
    evaluate.mockResolvedValue(undefined);
    screenshot.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    closePage.mockResolvedValue(undefined);
    closeBrowser.mockResolvedValue(undefined);
    launch.mockResolvedValue(createBrowserMock());
    putObject.mockResolvedValue({
      bucket: 'pepetex-dev',
      objectPath: 'thumbnails/slide_1.png',
      contentType: 'image/png',
      sizeBytes: 4,
      generation: '7',
      etag: 'etag-1'
    });
  });

  it('uploads the generated thumbnail when storage target fields are provided', async () => {
    const payload: ThumbnailGenerateJobPayload = {
      jobId: 'job_1',
      workspaceId: 'workspace_1',
      actorUserId: 'user_1',
      deckId: 'deck_1',
      idempotencyKey: 'thumbnail-job-1',
      requestedAt: '2026-04-26T07:00:00.000Z',
      slide: {
        id: 'slide_1',
        title: 'Board Update',
        html: '<section class="pepetex-slide" data-pepetex-slide-id="slide_1" style="width: 1920px; height: 1080px;"></section>',
        css: '[data-pepetex-slide-id="slide_1"] { background: #fff; }'
      },
      storageBucket: 'pepetex-dev',
      storageObjectPath: 'thumbnails/slide_1.png'
    };

    const result = await runGenerateThumbnailJob(payload, {
      browserLauncher: createLauncherMock(),
      getObjectStorageAdapter: createObjectStorageAdapterFactory()
    });

    expect(putObject).toHaveBeenCalledWith({
      objectPath: 'thumbnails/slide_1.png',
      body: new Uint8Array([1, 2, 3, 4]),
      contentType: 'image/png',
      metadata: {
        deckId: 'deck_1',
        jobId: 'job_1',
        slideId: 'slide_1'
      }
    });
    expect(result).toEqual({
      contentType: 'image/png',
      width: 1920,
      height: 1080,
      sizeBytes: 4,
      generatedAt: '2026-04-26T07:00:00.000Z',
      storageBucket: 'pepetex-dev',
      storageObjectPath: 'thumbnails/slide_1.png',
      storageGeneration: '7',
      storageEtag: 'etag-1'
    });
  });
});

describe('createPlaywrightThumbnailBrowserLauncher', () => {
  it('returns a launcher object', () => {
    expect(createPlaywrightThumbnailBrowserLauncher()).toMatchObject({
      launch: expect.any(Function)
    });
  });
});

function createLauncherMock(): ThumbnailBrowserLauncher {
  return {
    launch
  };
}

function createBrowserMock(): ThumbnailBrowserLike {
  return {
    newPage: vi.fn(async (): Promise<ThumbnailPageLike> => ({
      setViewportSize,
      setContent,
      waitForLoadState,
      evaluate,
      screenshot,
      close: closePage
    })),
    close: closeBrowser
  };
}

function createObjectStorageAdapterFactory() {
  const adapter: ObjectStorageAdapter = {
    kind: 'gcs',
    bucket: 'pepetex-dev',
    putObject,
    getObject: vi.fn(),
    deleteObject: vi.fn(),
    createSignedReadUrl: vi.fn()
  };

  return vi.fn(() => adapter);
}

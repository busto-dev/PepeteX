import { prisma } from '@pepetex/db';
import { SLIDE_CANVAS } from '@pepetex/html-contract';
import type { ExportPdfJobPayload } from '@pepetex/queue';

import { getCachedObjectStorageAdapter } from './object-storage';
import {
  SHARED_BROWSER_ARGS,
  buildBrowserLaunchError,
  loadPlaywrightLauncher,
  type ExportBrowserLauncher,
  type ExportBrowserLike
} from './browser-launch';

const PDF_CONTENT_TYPE = 'application/pdf';

// Render page hosts every slide stacked vertically. The page.pdf() call below
// uses preferCSSPageSize so the slide's @page rule (1920x1080) determines page
// breaks — the viewport just needs to be large enough that all slides are in
// layout before printing. 50,000px covers ~45 slides; Chromium handles large
// viewports cheaply because nothing rasterizes until print.
const EXPORT_RENDER_VIEWPORT = { width: SLIDE_CANVAS.width, height: 50_000 } as const;

export interface RunExportPdfJobOptions {
  browserLauncher?: ExportBrowserLauncher;
  browserExecutablePath?: string;
}

export interface ExportPdfJobResult {
  exportedFileId: string;
  fileName: string;
  sizeBytes: number;
}

export async function runExportPdfJob(
  payload: ExportPdfJobPayload,
  options: RunExportPdfJobOptions = {}
): Promise<ExportPdfJobResult> {
  try {
    return await runExportPdfJobInner(payload, options);
  } catch (error) {
    await markExportPdfJobFailed(payload, error);
    throw error;
  }
}

async function runExportPdfJobInner(
  payload: ExportPdfJobPayload,
  options: RunExportPdfJobOptions
): Promise<ExportPdfJobResult> {
  const tokenRecord = await prisma.exportJobToken.findFirst({
    where: { id: payload.exportJobTokenId }
  });

  if (!tokenRecord) {
    throw new Error(`Export token not found: ${payload.exportJobTokenId}`);
  }
  if (tokenRecord.usedAt) {
    throw new Error(`Export token already consumed: ${payload.exportJobTokenId}`);
  }
  if (tokenRecord.expiresAt < new Date()) {
    throw new Error(`Export token expired: ${payload.exportJobTokenId}`);
  }

  await markExportPdfJobRunning(payload);

  const launcher = options.browserLauncher ?? (await loadPlaywrightLauncher());
  const executablePath =
    options.browserExecutablePath ?? process.env['PEPETEX_CHROMIUM_EXECUTABLE_PATH'];

  let browser: ExportBrowserLike | null = null;
  let pdfBuffer: Buffer;

  try {
    try {
      browser = await launcher.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: [...SHARED_BROWSER_ARGS]
      });
    } catch (error) {
      throw buildBrowserLaunchError(error, executablePath);
    }

    const page = await browser.newPage();

    const renderUrl = `${payload.internalExportBaseUrl}/internal/export/render-pdf/${payload.exportToken}`;

    try {
      await page.setViewportSize({ ...EXPORT_RENDER_VIEWPORT });

      // emulateMedia({ media: 'screen' }) prevents Chromium from applying any
      // print stylesheet — the slide CSS is authored for screen and the @page
      // rule handles page geometry on its own.
      if (typeof page.emulateMedia === 'function') {
        await page.emulateMedia({ media: 'screen' });
      }

      await page.goto(renderUrl, { waitUntil: 'networkidle', timeout: 60_000 });

      await page.waitForFunction(
        () => {
          const global = globalThis as { pepetexPdfReady?: boolean; pepetexPdfError?: string | null };
          return global.pepetexPdfReady === true || !!global.pepetexPdfError;
        },
        { timeout: 30_000 }
      );

      const readinessError = await page.evaluate<string | null>(() => {
        const global = globalThis as { pepetexPdfError?: string | null };
        return global.pepetexPdfError ?? null;
      });
      if (readinessError) {
        // Non-fatal — settle helper failed but we still attempt the print. Log it.
        console.warn('[export-pdf] PDF render page reported a resource-settle error.', {
          deckId: payload.deckId,
          error: readinessError
        });
      }

      if (typeof page.pdf !== 'function') {
        throw new Error('page.pdf() is not available on the configured browser page. PDF export requires headless Chromium via playwright-core.');
      }

      const pdfOutput = await page.pdf({
        width: `${SLIDE_CANVAS.width}px`,
        height: `${SLIDE_CANVAS.height}px`,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        scale: 1,
        pageRanges: ''
      });

      pdfBuffer = Buffer.isBuffer(pdfOutput) ? pdfOutput : Buffer.from(pdfOutput);

      // Surface any console warnings/errors captured during the render page's
      // resource-settle phase. Useful for spotting missing assets, CSP
      // violations, font-load failures.
      try {
        const captured = await page.evaluate<Array<{ level: string; message: string }>>(() => {
          const global = globalThis as { pepetexExportWarnings?: Array<{ level: string; message: string }> };
          return global.pepetexExportWarnings ?? [];
        });
        if (captured.length > 0) {
          console.warn(`[export-pdf] PDF render emitted ${captured.length} console message(s).`, {
            deckId: payload.deckId,
            messages: captured.slice(0, 20)
          });
        }
      } catch (warningCaptureError) {
        console.warn(
          '[export-pdf] Failed to read pepetexExportWarnings buffer.',
          warningCaptureError instanceof Error ? warningCaptureError.message : warningCaptureError
        );
      }
    } finally {
      await page.close().catch(() => undefined);
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }

  const storage = getCachedObjectStorageAdapter(payload.gcsBucket);
  await storage.putObject({
    objectPath: payload.gcsPath,
    body: pdfBuffer,
    contentType: PDF_CONTENT_TYPE,
    contentDisposition: `attachment; filename="${encodeURIComponent(payload.fileName)}"`,
    metadata: {
      'pepetex-version': payload.pepetexVersion ?? '',
      'pepetex-deck-id': payload.deckId ?? ''
    }
  });

  await prisma.exportJobToken.update({
    where: { id: payload.exportJobTokenId },
    data: { usedAt: new Date() }
  });

  const resolvedDeckId = payload.deckId ?? tokenRecord.deckId;
  const resolvedRevisionId = payload.revisionId ?? tokenRecord.revisionId;

  const existingRecord = payload.jobId
    ? await prisma.exportedFile.findFirst({ where: { jobId: payload.jobId } })
    : null;

  const recordData: Parameters<typeof prisma.exportedFile.create>[0]['data'] = {
    deckId: resolvedDeckId,
    revisionId: resolvedRevisionId,
    gcsBucket: payload.gcsBucket,
    gcsPath: payload.gcsPath,
    fileName: payload.fileName,
    sizeBytes: pdfBuffer.byteLength,
    format: 'PDF',
    exportedByUserId: payload.actorUserId,
    isFallback: false,
    status: 'COMPLETED'
  };
  if (payload.jobId) recordData.jobId = payload.jobId;
  if (payload.pepetexVersion) recordData.pepetexVersion = payload.pepetexVersion;

  const record = existingRecord
    ? await prisma.exportedFile.update({ where: { id: existingRecord.id }, data: recordData })
    : await prisma.exportedFile.create({ data: recordData });

  return {
    exportedFileId: record.id,
    fileName: payload.fileName,
    sizeBytes: pdfBuffer.byteLength
  };
}

async function markExportPdfJobRunning(payload: ExportPdfJobPayload): Promise<void> {
  if (!payload.jobId) return;

  await prisma.exportedFile.updateMany({
    where: {
      jobId: payload.jobId,
      status: 'QUEUED'
    },
    data: {
      status: 'RUNNING',
      fallbackReason: null
    }
  });
}

async function markExportPdfJobFailed(
  payload: ExportPdfJobPayload,
  error: unknown
): Promise<void> {
  if (!payload.jobId) return;

  const message = error instanceof Error ? error.message : String(error);

  try {
    const result = await prisma.exportedFile.updateMany({
      where: {
        jobId: payload.jobId,
        status: { in: ['QUEUED', 'RUNNING'] }
      },
      data: {
        status: 'FAILED',
        fallbackReason: message
      }
    });

    if (result.count === 0 && payload.deckId && payload.revisionId) {
      await prisma.exportedFile.create({
        data: {
          deckId: payload.deckId,
          revisionId: payload.revisionId,
          gcsBucket: payload.gcsBucket,
          gcsPath: payload.gcsPath,
          fileName: payload.fileName,
          sizeBytes: 0,
          format: 'PDF',
          exportedByUserId: payload.actorUserId,
          jobId: payload.jobId,
          pepetexVersion: payload.pepetexVersion,
          status: 'FAILED',
          fallbackReason: message
        }
      });
    }
  } catch (updateError) {
    console.error('Failed to mark PDF export as FAILED.', {
      jobId: payload.jobId,
      error: updateError instanceof Error ? updateError.message : String(updateError)
    });
  }
}

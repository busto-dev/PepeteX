import { prisma } from '@pepetex/db';
import type { ExportPptxJobPayload } from '@pepetex/queue';
import type { GeneratedDeck } from '@pepetex/ai';

import { getCachedObjectStorageAdapter } from './object-storage';
import { collectChartPositionsFromDocument, type ExtractedChartPosition } from './chart-position-extractor.js';
import { injectNativeChartsIntoPptx, type ChartInjection } from './pptx-chart-injector.js';
import {
  SHARED_BROWSER_ARGS,
  buildBrowserLaunchError,
  loadPlaywrightLauncher,
  type ExportBrowserLauncher,
  type ExportBrowserLike,
  type ExportPageLike
} from './browser-launch';

const PPTX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

// The export render page stacks every slide vertically at 1920×1080 each. The
// default Playwright viewport (1280×720) leaves all but the first slide below
// the fold, which causes dom-to-pptx's html2canvas raster fallbacks to capture
// blank/wrong regions. We set a generous viewport pre-navigation so the entire
// deck is in layout viewport regardless of slide count. 1920 × 50000 covers
// ~45 slides; browsers handle large viewports fine because nothing actually
// renders pixel-for-pixel — it just makes layout queries return correct values.
const EXPORT_RENDER_VIEWPORT = { width: 1920, height: 50000 } as const;

export type { ExportBrowserLauncher, ExportBrowserLike, ExportPageLike };

export interface RunExportPptxJobOptions {
  browserLauncher?: ExportBrowserLauncher;
  browserExecutablePath?: string;
}

export interface ExportPptxJobResult {
  exportedFileId: string;
  fileName: string;
  sizeBytes: number;
  isFallback: boolean;
  fallbackReason?: string;
}

export async function runExportPptxJob(
  payload: ExportPptxJobPayload,
  options: RunExportPptxJobOptions = {}
): Promise<ExportPptxJobResult> {
  try {
    return await runExportPptxJobInner(payload, options);
  } catch (error) {
    await markExportPptxJobFailed(payload, error);
    throw error;
  }
}

async function runExportPptxJobInner(
  payload: ExportPptxJobPayload,
  options: RunExportPptxJobOptions = {}
): Promise<ExportPptxJobResult> {
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

  await markExportPptxJobRunning(payload);

  const launcher = options.browserLauncher ?? (await loadPlaywrightLauncher());
  const executablePath =
    options.browserExecutablePath ?? process.env['PEPETEX_CHROMIUM_EXECUTABLE_PATH'];

  let browser: ExportBrowserLike | null = null;
  let isFallback = false;
  let fallbackReason: string | undefined;
  let pptxBuffer: Buffer;

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

    const renderUrl = `${payload.internalExportBaseUrl}/internal/export/render/${payload.exportToken}`;

    try {
      // Sized for the full vertically-stacked slide canvas. See
      // EXPORT_RENDER_VIEWPORT comment.
      await page.setViewportSize({ ...EXPORT_RENDER_VIEWPORT });

      // `networkidle` (no in-flight requests for 500ms) is more reliable than
      // `load` for the export page, which fetches images/fonts after DOMContentLoaded.
      await page.goto(renderUrl, { waitUntil: 'networkidle', timeout: 60_000 });

      // Wait until dom-to-pptx is loaded and the export function is ready
      await page.waitForFunction(
        () => {
          const global = globalThis as {
            pepetexExportReady?: boolean;
            pepetexExportError?: string | null;
            pepetexRunExport?: unknown;
            domToPptx?: { exportToPptx?: unknown };
            DomToPptx?: { exportToPptx?: unknown };
            domtopptx?: { exportToPptx?: unknown };
          };
          const api = global.domToPptx ?? global.DomToPptx ?? global.domtopptx;
          if (global.pepetexExportError) return true;
          return global.pepetexExportReady === true &&
            typeof global.pepetexRunExport === 'function' &&
            typeof api?.exportToPptx === 'function';
        },
        { timeout: 30_000 }
      );

      const exportReadinessError = await page.evaluate<string | null>(() => {
        const global = globalThis as { pepetexExportError?: string | null };
        return global.pepetexExportError ?? null;
      });
      if (exportReadinessError) {
        throw new Error(exportReadinessError);
      }

      // Wait for web fonts to finish loading. Without this, dom-to-pptx's
      // autoEmbedFonts can race the font load and embed the fallback stack.
      // The bootstrap script awaits document.fonts.ready inside pepetexRunExport
      // as well, but waiting up-front gives the page time to settle visually
      // before measurement and reduces the chance of a transient layout shift
      // during chart-position extraction.
      await page.evaluate<void>(async () => {
        const fontsApi = (document as Document & {
          fonts?: { ready?: Promise<unknown> };
        }).fonts;
        if (fontsApi?.ready) {
          try { await fontsApi.ready; } catch { /* ignore */ }
        }
      });

      // Call the export function — returns a base64 data URL: data:...;base64,<data>
      const dataUrl = await page.evaluate<string>(async () => {
        const runExport = (globalThis as { pepetexRunExport?: () => Promise<string> }).pepetexRunExport;
        if (typeof runExport !== 'function') {
          throw new Error('PPTX export function is not available on the render page.');
        }

        return runExport();
      });

      // Read back any console warnings/errors that fired inside the page during
      // the dom-to-pptx run. dom-to-pptx is a coordinate scraper (it measures each
      // element's final rect), so transform/translate and rotate map cleanly; but
      // some CSS still diverges — backdrop-filter / mix-blend-mode are dropped,
      // clip-path / mask / non-linear gradients fall back, and a few decorative
      // regions rasterize — those surface here so we can log them.
      try {
        const captured = await page.evaluate<Array<{ level: string; message: string }>>(() => {
          const global = globalThis as {
            pepetexExportWarnings?: Array<{ level: string; message: string }>;
          };
          return global.pepetexExportWarnings ?? [];
        });
        if (captured.length > 0) {
          console.warn(
            `[export-pptx] dom-to-pptx emitted ${captured.length} console message(s) during export. Some regions may have been rasterized to PNG instead of converted to native PPTX primitives.`,
            {
              deckId: payload.deckId,
              messages: captured.slice(0, 20)
            }
          );
        }
      } catch (warningCaptureError) {
        // Non-fatal: warning collection is observability only.
        console.warn(
          '[export-pptx] Failed to read pepetexExportWarnings buffer.',
          warningCaptureError instanceof Error ? warningCaptureError.message : warningCaptureError
        );
      }

      const base64Data = dataUrl.split(',')[1];
      if (!base64Data) {
        throw new Error('Export function returned empty data URL');
      }

      pptxBuffer = Buffer.from(base64Data, 'base64');

      // Stage 2: Inject native OOXML charts on top of SVG vectors
      try {
        const chartPositions = await page.evaluate<ExtractedChartPosition[]>(
          collectChartPositionsFromDocument as unknown as (...args: unknown[]) => ExtractedChartPosition[]
        );

        const revision = await prisma.deckRevision.findUnique({
          where: { id: payload.revisionId ?? tokenRecord.revisionId }
        });
        const deck = revision?.deckJson as GeneratedDeck | null;

        if (deck) {
          const { injections, deckChartsMissingPosition, domChartsMissingData } =
            planChartInjections(deck, chartPositions);

          // Surface charts present in deck JSON but not found in DOM positions —
          // these will render only as SVG vectors (or be missing entirely if the
          // AI didn't include a chart container in the slide HTML).
          if (deckChartsMissingPosition.length > 0) {
            console.warn(
              `[export-pptx] ${deckChartsMissingPosition.length} chart(s) in deck JSON have no matching DOM container; cannot inject as native PPTX charts.`,
              {
                deckId: payload.deckId,
                charts: deckChartsMissingPosition.slice(0, 20)
              }
            );
          }

          // DOM has a chart container but deck JSON has no entry for it — this
          // is unusual; the SVG will render but no native chart can be placed.
          if (domChartsMissingData.length > 0) {
            console.warn(
              `[export-pptx] ${domChartsMissingData.length} chart container(s) in slide HTML have no matching deck JSON chart data.`,
              {
                deckId: payload.deckId,
                charts: domChartsMissingData.slice(0, 20)
              }
            );
          }

          if (injections.length > 0) {
            const slideCount = deck.slides.length;
            const { buffer: nextBuffer, results } = await injectNativeChartsIntoPptx(
              pptxBuffer,
              slideCount,
              injections
            );
            pptxBuffer = nextBuffer;

            const injected = results.filter((r) => r.status === 'injected');
            const failed = results.filter((r) => r.status === 'failed');

            console.log(
              `[export-pptx] Native chart injection: ${injected.length} injected, ${failed.length} failed, ${deckChartsMissingPosition.length} missing-position, ${domChartsMissingData.length} missing-data.`,
              {
                deckId: payload.deckId,
                injected: injected.map((r) => ({
                  slideIndex: r.slideIndex,
                  chartId: r.chartId,
                  rawKind: r.rawKind,
                  renderKind: r.renderKind
                })),
                ...(failed.length > 0
                  ? {
                      failed: failed.map((r) => ({
                        slideIndex: r.slideIndex,
                        chartId: r.chartId,
                        rawKind: r.rawKind,
                        renderKind: r.renderKind,
                        error: r.errorMessage
                      }))
                    }
                  : {})
              }
            );
          }
        }
      } catch (stage2Err) {
        const stage2Message = stage2Err instanceof Error ? stage2Err.message : String(stage2Err);
        console.warn('PPTX Stage 2 (native chart injection) failed — keeping Stage 1 SVG vectors.', {
          deckId: payload.deckId,
          error: stage2Message
        });
        // Do not throw; Stage 1 output with SVG vectors is acceptable fallback
      }
    } catch (exportErr) {
      // Log static fallback — whole-slide image export is NOT a fallback here;
      // we surface the error so callers can retry.
      isFallback = true;
      fallbackReason = exportErr instanceof Error ? exportErr.message : String(exportErr);
      console.error('PPTX export via dom-to-pptx failed — marking as fallback', {
        deckId: payload.deckId,
        error: fallbackReason
      });
      throw exportErr;
    } finally {
      await page.close().catch(() => undefined);
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }

  // Upload to GCS
  const storage = getCachedObjectStorageAdapter(payload.gcsBucket);
  await storage.putObject({
    objectPath: payload.gcsPath,
    body: pptxBuffer,
    contentType: PPTX_CONTENT_TYPE,
    contentDisposition: `attachment; filename="${encodeURIComponent(payload.fileName)}"`,
    metadata: {
      'pepetex-version': payload.pepetexVersion ?? '',
      'pepetex-deck-id': payload.deckId ?? ''
    }
  });

  // Mark token used
  await prisma.exportJobToken.update({
    where: { id: payload.exportJobTokenId },
    data: { usedAt: new Date() }
  });

  const resolvedDeckId = payload.deckId ?? tokenRecord.deckId;
  const resolvedRevisionId = payload.revisionId ?? tokenRecord.revisionId;

  // Complete the queued ExportedFile record, or create one for legacy jobs that
  // were queued before persisted export statuses existed.
  const existingRecord = payload.jobId
    ? await prisma.exportedFile.findFirst({ where: { jobId: payload.jobId } })
    : null;

  const recordData: Parameters<typeof prisma.exportedFile.create>[0]['data'] = {
    deckId: resolvedDeckId,
    revisionId: resolvedRevisionId,
    gcsBucket: payload.gcsBucket,
    gcsPath: payload.gcsPath,
    fileName: payload.fileName,
    sizeBytes: pptxBuffer.byteLength,
    exportedByUserId: payload.actorUserId,
    isFallback,
    status: 'COMPLETED'
  };
  if (payload.jobId) recordData.jobId = payload.jobId;
  if (fallbackReason) recordData.fallbackReason = fallbackReason;
  if (payload.pepetexVersion) recordData.pepetexVersion = payload.pepetexVersion;

  const record = existingRecord
    ? await prisma.exportedFile.update({ where: { id: existingRecord.id }, data: recordData })
    : await prisma.exportedFile.create({ data: recordData });

  const result: ExportPptxJobResult = {
    exportedFileId: record.id,
    fileName: payload.fileName,
    sizeBytes: pptxBuffer.byteLength,
    isFallback
  };
  if (fallbackReason) result.fallbackReason = fallbackReason;
  return result;
}

async function markExportPptxJobRunning(payload: ExportPptxJobPayload): Promise<void> {
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

async function markExportPptxJobFailed(
  payload: ExportPptxJobPayload,
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
          exportedByUserId: payload.actorUserId,
          jobId: payload.jobId,
          pepetexVersion: payload.pepetexVersion,
          status: 'FAILED',
          fallbackReason: message
        }
      });
    }
  } catch (updateError) {
    console.error('Failed to mark PPTX export as FAILED.', {
      jobId: payload.jobId,
      error: updateError instanceof Error ? updateError.message : String(updateError)
    });
  }
}

interface ChartInjectionPlan {
  injections: ChartInjection[];
  /** Charts present in deck JSON but not found in DOM positions. */
  deckChartsMissingPosition: Array<{ slideIndex: number; chartId: string; kind: string }>;
  /** DOM chart containers without a matching deck JSON entry. */
  domChartsMissingData: Array<{ slideIndex: number; chartId: string }>;
}

/**
 * Reconciles deck-JSON chart entries with DOM-extracted chart positions to
 * produce a concrete injection list plus diagnostics. A chart can only be
 * injected as a native PPTX chart when both (a) its data exists in the deck
 * JSON and (b) a slide DOM container with a matching id was found.
 */
export function planChartInjections(
  deck: GeneratedDeck,
  domPositions: ExtractedChartPosition[]
): ChartInjectionPlan {
  const positionByKey = new Map<string, ExtractedChartPosition>();
  for (const pos of domPositions) {
    positionByKey.set(`${pos.slideIndex}:${pos.chartId}`, pos);
  }

  const injections: ChartInjection[] = [];
  const deckChartsMissingPosition: ChartInjectionPlan['deckChartsMissingPosition'] = [];
  const seenKeys = new Set<string>();

  deck.slides.forEach((slide, slideIndex) => {
    for (const chart of slide.charts ?? []) {
      const key = `${slideIndex}:${chart.id}`;
      seenKeys.add(key);
      const position = positionByKey.get(key);
      if (!position) {
        deckChartsMissingPosition.push({
          slideIndex,
          chartId: chart.id,
          kind: chart.kind
        });
        continue;
      }
      injections.push({
        slideIndex,
        chartId: chart.id,
        chartData: chart,
        position: {
          x: position.x,
          y: position.y,
          width: position.width,
          height: position.height
        }
      });
    }
  });

  const domChartsMissingData: ChartInjectionPlan['domChartsMissingData'] = [];
  for (const pos of domPositions) {
    const key = `${pos.slideIndex}:${pos.chartId}`;
    if (!seenKeys.has(key)) {
      domChartsMissingData.push({ slideIndex: pos.slideIndex, chartId: pos.chartId });
    }
  }

  return { injections, deckChartsMissingPosition, domChartsMissingData };
}


import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExportPptxJobPayload } from '@pepetex/queue';

import { planChartInjections, runExportPptxJob } from './export-pptx';
import type { ExportBrowserLauncher, ExportBrowserLike, ExportPageLike } from './export-pptx';
import type { GeneratedDeck } from '@pepetex/ai';
import type { ExtractedChartPosition } from './chart-position-extractor.js';
import { injectNativeChartsIntoPptx } from './pptx-chart-injector.js';

// Mock prisma
vi.mock('@pepetex/db', () => ({
  prisma: {
    exportJobToken: {
      findFirst: vi.fn(),
      update: vi.fn()
    },
    deckRevision: {
      findUnique: vi.fn()
    },
    exportedFile: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn()
    }
  }
}));

// Mock object storage
vi.mock('./object-storage', () => ({
  getCachedObjectStorageAdapter: vi.fn(() => ({
    putObject: vi.fn().mockResolvedValue({ objectPath: 'test-path' })
  }))
}));

const basePayload: ExportPptxJobPayload = {
  jobId: 'job_1',
  workspaceId: 'ws_1',
  actorUserId: 'user_1',
  deckId: 'deck_1',
  revisionId: 'rev_1',
  idempotencyKey: 'token_1',
  requestedAt: new Date().toISOString(),
  exportJobTokenId: 'token_1',
  exportToken: 'abc123',
  deckTitle: 'My Deck',
  internalExportBaseUrl: 'http://localhost:3000',
  gcsBucket: 'pepetex-test',
  gcsPath: 'exports/deck_1/presentation.pptx',
  fileName: 'presentation.pptx',
  pepetexVersion: '1.0.0'
};

function makeBrowserLauncher(dataUrl: string): ExportBrowserLauncher & { page: ExportPageLike } {
  const page: ExportPageLike = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation(async (fn: () => unknown) => {
      const source = String(fn);
      return source.includes('pepetexExportError') ? null : dataUrl;
    }),
    setViewportSize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  };
  const browser: ExportBrowserLike = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined)
  };
  return Object.assign({
    launch: vi.fn().mockResolvedValue(browser)
  }, { page });
}

describe('runExportPptxJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an ExportedFile record and returns result on success', async () => {
    const { prisma } = await import('@pepetex/db');

    const tokenRecord = {
      id: 'token_1',
      token: 'abc123',
      deckId: 'deck_1',
      revisionId: 'rev_1',
      actorUserId: 'user_1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null
    };
    (prisma.exportJobToken.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(tokenRecord);
    (prisma.exportJobToken.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.exportedFile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'exported_1',
      status: 'QUEUED'
    });
    (prisma.exportedFile.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (prisma.exportedFile.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'exported_1',
      fileName: 'presentation.pptx',
      sizeBytes: 100,
      isFallback: false
    });

    // A valid base64 data URL for a tiny PPTX-like buffer
    const fakeBase64 = Buffer.from('PK fake pptx content').toString('base64');
    const fakeDataUrl = `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${fakeBase64}`;

    const launcher = makeBrowserLauncher(fakeDataUrl);

    const result = await runExportPptxJob(basePayload, { browserLauncher: launcher });

    expect(result.exportedFileId).toBe('exported_1');
    expect(result.isFallback).toBe(false);
    expect(typeof (launcher.page.waitForFunction as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('function');
    expect(typeof (launcher.page.evaluate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('function');
    expect(prisma.exportedFile.updateMany).toHaveBeenCalledWith({
      where: { jobId: 'job_1', status: 'QUEUED' },
      data: { status: 'RUNNING', fallbackReason: null }
    });
    expect(prisma.exportedFile.update).toHaveBeenCalledWith({
      where: { id: 'exported_1' },
      data: expect.objectContaining({ status: 'COMPLETED', sizeBytes: expect.any(Number) })
    });
    expect(prisma.exportJobToken.update).toHaveBeenCalledWith({
      where: { id: 'token_1' },
      data: { usedAt: expect.any(Date) }
    });
  });

  it('throws when export token is expired', async () => {
    const { prisma } = await import('@pepetex/db');
    (prisma.exportJobToken.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'token_1',
      token: 'abc123',
      deckId: 'deck_1',
      revisionId: 'rev_1',
      actorUserId: 'user_1',
      expiresAt: new Date(Date.now() - 1000),
      usedAt: null
    });
    (prisma.exportedFile.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    const launcher = makeBrowserLauncher('data:;base64,');

    await expect(runExportPptxJob(basePayload, { browserLauncher: launcher })).rejects.toThrow(
      'Export token expired'
    );
    expect(prisma.exportedFile.updateMany).toHaveBeenCalledWith({
      where: { jobId: 'job_1', status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', fallbackReason: expect.stringContaining('Export token expired') }
    });
  });

  it('throws when export token not found', async () => {
    const { prisma } = await import('@pepetex/db');
    (prisma.exportJobToken.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      runExportPptxJob(basePayload, { browserLauncher: makeBrowserLauncher('data:;base64,') })
    ).rejects.toThrow('Export token not found');
  });
});

describe('planChartInjections', () => {
  function makeDeck(
    chartsBySlide: Array<Array<{ id: string; kind: string }>>
  ): GeneratedDeck {
    return {
      title: 'Deck',
      language: 'en',
      aspectRatio: '16:9',
      canvas: { width: 1920, height: 1080 },
      slides: chartsBySlide.map((charts, slideIndex) => ({
        id: `slide_${slideIndex}`,
        title: `Slide ${slideIndex}`,
        html: '',
        css: '',
        assets: [],
        diagrams: [],
        charts: charts.map((c) => ({
          id: c.id,
          kind: c.kind,
          categories: ['A', 'B'],
          series: [{ name: 'S', values: [1, 2] }]
        }))
      }))
    };
  }

  function pos(slideIndex: number, chartId: string): ExtractedChartPosition {
    return { slideIndex, chartId, x: 100, y: 100, width: 800, height: 400 };
  }

  it('matches deck charts to DOM positions and produces injections', () => {
    const deck = makeDeck([[{ id: 'chart-1', kind: 'bar' }, { id: 'chart-2', kind: 'pie' }]]);
    const positions = [pos(0, 'chart-1'), pos(0, 'chart-2')];

    const plan = planChartInjections(deck, positions);

    expect(plan.injections).toHaveLength(2);
    expect(plan.injections.map((i) => i.chartId).sort()).toEqual(['chart-1', 'chart-2']);
    expect(plan.deckChartsMissingPosition).toEqual([]);
    expect(plan.domChartsMissingData).toEqual([]);
  });

  it('reports deck charts that have no matching DOM container', () => {
    const deck = makeDeck([[{ id: 'chart-orphan', kind: 'stacked-bar' }]]);
    const positions: ExtractedChartPosition[] = [];

    const plan = planChartInjections(deck, positions);

    expect(plan.injections).toEqual([]);
    expect(plan.deckChartsMissingPosition).toEqual([
      { slideIndex: 0, chartId: 'chart-orphan', kind: 'stacked-bar' }
    ]);
    expect(plan.domChartsMissingData).toEqual([]);
  });

  it('reports DOM chart containers that have no matching deck JSON entry', () => {
    const deck = makeDeck([[]]);
    const positions = [pos(0, 'chart-ghost')];

    const plan = planChartInjections(deck, positions);

    expect(plan.injections).toEqual([]);
    expect(plan.deckChartsMissingPosition).toEqual([]);
    expect(plan.domChartsMissingData).toEqual([{ slideIndex: 0, chartId: 'chart-ghost' }]);
  });

  it('keeps slide-scoped matches separate so the same chart id on two slides does not collide', () => {
    const deck = makeDeck([
      [{ id: 'shared', kind: 'bar' }],
      [{ id: 'shared', kind: 'line' }]
    ]);
    const positions = [pos(1, 'shared')]; // only slide 1 has DOM

    const plan = planChartInjections(deck, positions);

    expect(plan.injections).toHaveLength(1);
    expect(plan.injections[0]?.slideIndex).toBe(1);
    expect(plan.injections[0]?.chartData.kind).toBe('line');
    expect(plan.deckChartsMissingPosition).toEqual([
      { slideIndex: 0, chartId: 'shared', kind: 'bar' }
    ]);
  });
});

describe('injectNativeChartsIntoPptx', () => {
  it('adds native chart and embedded workbook artifacts to a PPTX', async () => {
    const pptxgen = await import('pptxgenjs');
    const PptxGenJS = pptxgen.default;
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.addSlide().addText('Chart slide', { x: 0.5, y: 0.5, w: 3, h: 0.4 });

    const baseBuffer = Buffer.from(await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer);
    const { buffer, results } = await injectNativeChartsIntoPptx(baseBuffer, 1, [
      {
        slideIndex: 0,
        chartId: 'chart-1',
        chartData: {
          id: 'chart-1',
          kind: 'bar',
          categories: ['Jan', 'Feb', 'Mar'],
          series: [{ name: 'Revenue', values: [10, 12, 14] }]
        },
        position: { x: 240, y: 220, width: 900, height: 460 }
      }
    ]);

    expect(results).toEqual([
      expect.objectContaining({
        chartId: 'chart-1',
        status: 'injected',
        renderKind: 'bar'
      })
    ]);

    const zipDirectory = buffer.toString('latin1');
    expect(zipDirectory).toContain('ppt/charts/chart');
    expect(zipDirectory).toContain('ppt/embeddings/Microsoft_Excel_Worksheet');
  });
});

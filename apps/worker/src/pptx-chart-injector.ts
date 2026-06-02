import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Automizer from 'pptx-automizer';
import { normalizeSlideChartKind, type SlideChartData, type SupportedSlideChartKind } from '@pepetex/ai';

const SLIDE_WIDTH_PX = 1920;
const SLIDE_HEIGHT_PX = 1080;
const SLIDE_WIDTH_INCHES = 10;
const SLIDE_HEIGHT_INCHES = 5.625;

export interface ChartPosition {
  x: number; // pixels, relative to slide
  y: number; // pixels, relative to slide
  width: number; // pixels
  height: number; // pixels
}

export interface ChartInjection {
  slideIndex: number; // 0-based
  chartId: string;
  chartData: SlideChartData;
  position: ChartPosition;
  colors?: string[];
}

function pxToInchesX(px: number): number {
  return (px / SLIDE_WIDTH_PX) * SLIDE_WIDTH_INCHES;
}

function pxToInchesY(px: number): number {
  return (px / SLIDE_HEIGHT_PX) * SLIDE_HEIGHT_INCHES;
}

function mapChartType(kind: SupportedSlideChartKind): string {
  switch (kind) {
    case 'bar':
    case 'table-like':
      return 'bar';
    case 'line':
      return 'line';
    case 'area':
      return 'area';
    case 'pie':
      return 'pie';
    case 'donut':
      return 'doughnut';
    case 'scatter':
      return 'scatter';
    default:
      return 'bar';
  }
}

function buildPptxGenJsData(chartData: SlideChartData, renderKind: SupportedSlideChartKind): unknown[] {
  if (renderKind === 'pie' || renderKind === 'donut') {
    return [
      {
        name: chartData.title ?? 'Chart',
        labels: chartData.categories,
        values: chartData.series[0]?.values ?? []
      }
    ];
  }

  return chartData.series.map((series) => ({
    name: series.name,
    labels: chartData.categories,
    values: series.values
  }));
}

function buildChartOptions(
  chartData: SlideChartData,
  renderKind: SupportedSlideChartKind,
  position: ChartPosition,
  colors: string[] | undefined
): Record<string, unknown> {
  const options: Record<string, unknown> = {
    x: pxToInchesX(position.x),
    y: pxToInchesY(position.y),
    w: pxToInchesX(position.width),
    h: pxToInchesY(position.height),
    showValue: false,
    showPercent: renderKind === 'pie' || renderKind === 'donut',
    dataBorder: { pt: 0, color: 'FFFFFF' },
    dataLabelColor: '363636',
    dataLabelFontSize: 10
  };

  if (colors && colors.length > 0) {
    options.chartColors = colors;
  }

  if (chartData.title) {
    options.showTitle = true;
    options.title = chartData.title;
    options.titleFontSize = 14;
    options.titleColor = '1f2937';
  }

  if (renderKind === 'area') {
    options.lineDataSymbol = 'none';
  }

  if (renderKind === 'donut') {
    options.holeSize = 50;
  }

  return options;
}

export interface ChartInjectionResult {
  slideIndex: number;
  chartId: string;
  status: 'injected' | 'failed';
  rawKind: string;
  renderKind: SupportedSlideChartKind;
  errorMessage?: string;
}

export interface InjectNativeChartsResult {
  buffer: Buffer;
  results: ChartInjectionResult[];
}

/**
 * Injects native OOXML charts into an existing PPTX buffer using pptx-automizer.
 * The original slide content is preserved; native charts are added on top.
 *
 * Returns the new buffer plus a per-chart result list. A chart is only marked
 * `failed` when pptxgenjs/pptx-automizer threw while building it; charts not
 * present in `injections` are simply absent from the result list (they are
 * tracked by the caller via the position-extraction / deck-JSON match step).
 */
export async function injectNativeChartsIntoPptx(
  pptxBuffer: Buffer,
  slideCount: number,
  injections: ChartInjection[]
): Promise<InjectNativeChartsResult> {
  if (injections.length === 0) {
    return { buffer: pptxBuffer, results: [] };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pepetex-chart-inject-'));
  const inputPath = path.join(tempDir, 'input.pptx');
  const outputPath = path.join(tempDir, 'output.pptx');
  const results: ChartInjectionResult[] = [];

  try {
    fs.writeFileSync(inputPath, pptxBuffer);

    const automizer = new Automizer({
      templateDir: tempDir,
      outputDir: tempDir,
      compression: 0,
      rootTemplate: inputPath,
      removeExistingSlides: true
    });

    automizer.load(inputPath, 'source');
    await automizer.presentation();

    // Group injections by slide
    const bySlide = new Map<number, ChartInjection[]>();
    for (const injection of injections) {
      const list = bySlide.get(injection.slideIndex) ?? [];
      list.push(injection);
      bySlide.set(injection.slideIndex, list);
    }

    for (let slideNum = 1; slideNum <= slideCount; slideNum++) {
      const slideInjections = bySlide.get(slideNum - 1) ?? [];
      automizer.addSlide('source', slideNum, (slide) => {
        for (const injection of slideInjections) {
          const renderKind = normalizeSlideChartKind(injection.chartData.kind);
          const chartType = mapChartType(renderKind);
          const chartData = buildPptxGenJsData(injection.chartData, renderKind);
          const options = buildChartOptions(
            injection.chartData,
            renderKind,
            injection.position,
            injection.colors
          );

          slide.generate((pSlide, _pptxGenJs) => {
            try {
              const chartTypeEnum = (_pptxGenJs.ChartType as Record<string, string>)[chartType] ?? 'bar';
              pSlide.addChart(
                chartTypeEnum as 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter',
                chartData,
                options
              );
              results.push({
                slideIndex: injection.slideIndex,
                chartId: injection.chartId,
                status: 'injected',
                rawKind: injection.chartData.kind,
                renderKind
              });
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              results.push({
                slideIndex: injection.slideIndex,
                chartId: injection.chartId,
                status: 'failed',
                rawKind: injection.chartData.kind,
                renderKind,
                errorMessage
              });
            }
          }, `chart-${injection.chartId}`);
        }
      });
    }

    await automizer.write(path.basename(outputPath));
    const buffer = fs.readFileSync(outputPath);
    const successfulInjections = results.filter((result) => result.status === 'injected');
    if (successfulInjections.length > 0 && !hasNativeChartArtifacts(buffer)) {
      throw new Error('Native chart injection reported success but no chart/workbook artifacts were found in the PPTX.');
    }
    return { buffer, results };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function hasNativeChartArtifacts(buffer: Buffer): boolean {
  const zipText = buffer.toString('latin1');
  return zipText.includes('ppt/charts/chart') &&
    zipText.includes('ppt/embeddings/Microsoft_Excel_Worksheet');
}

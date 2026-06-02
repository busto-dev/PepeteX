import * as echarts from 'echarts';
import { normalizeSlideChartKind, type SlideChartData, type SupportedSlideChartKind } from '@pepetex/ai';

export interface RenderChartOptions {
  width?: number;
  height?: number;
  colors?: string[];
}

const DEFAULT_CHART_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16'
];

const DEFAULT_CHART_WIDTH = 800;
const DEFAULT_CHART_HEIGHT = 500;

export function renderChartToSvg(
  chartData: SlideChartData,
  options: RenderChartOptions = {}
): string {
  const width = options.width ?? DEFAULT_CHART_WIDTH;
  const height = options.height ?? DEFAULT_CHART_HEIGHT;
  const colors = options.colors ?? DEFAULT_CHART_COLORS;

  const chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    width,
    height
  });

  const echartsOption = buildEChartsOption(chartData, colors);
  chart.setOption(echartsOption);

  let svg = chart.renderToSVGString();
  chart.dispose();

  // Make the SVG responsive so it scales to its container
  svg = makeSvgResponsive(svg);

  return svg;
}

function buildEChartsOption(
  chartData: SlideChartData,
  colors: string[]
): echarts.EChartsOption {
  const renderKind: SupportedSlideChartKind = normalizeSlideChartKind(chartData.kind);
  const baseOption: echarts.EChartsOption = {
    color: colors,
    backgroundColor: 'transparent',
    legend: {
      bottom: 8,
      textStyle: { color: '#4b5563', fontSize: 12 }
    },
    grid: {
      left: 64,
      right: 32,
      top: chartData.title ? 56 : 32,
      bottom: 48,
      containLabel: false
    },
    tooltip: {
      trigger: 'axis'
    }
  };

  if (chartData.title) {
    (baseOption as Record<string, unknown>).title = {
      text: chartData.title,
      left: 'center',
      top: 8,
      textStyle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937'
      }
    };
  }

  switch (renderKind) {
    case 'bar':
    case 'line':
    case 'area':
    case 'scatter':
    case 'table-like': {
      const option: echarts.EChartsOption = { ...baseOption };
      (option as Record<string, unknown>).xAxis = {
        type: 'category',
        data: chartData.categories,
        axisLine: { lineStyle: { color: '#d1d5db' } },
        axisLabel: { color: '#6b7280', fontSize: 12 },
        axisTick: { show: false }
      };
      const yAxis: Record<string, unknown> = {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: '#6b7280', fontSize: 12 },
        splitLine: { lineStyle: { color: '#f3f4f6' } }
      };
      if (chartData.unit) {
        yAxis.name = chartData.unit;
        yAxis.nameTextStyle = { color: '#6b7280', fontSize: 12 };
      }
      (option as Record<string, unknown>).yAxis = yAxis;
      (option as Record<string, unknown>).series = chartData.series.map((series) => {
        const s: Record<string, unknown> = {
          name: series.name,
          data: series.values
        };
        if (renderKind === 'area') {
          s.type = 'line';
          s.areaStyle = { opacity: 0.25 };
          s.smooth = true;
        } else if (renderKind === 'table-like') {
          s.type = 'bar';
          s.itemStyle = { borderRadius: [4, 4, 0, 0] };
        } else {
          s.type = renderKind;
          if (renderKind === 'line') {
            s.smooth = true;
          }
          if (renderKind === 'bar') {
            s.itemStyle = { borderRadius: [4, 4, 0, 0] };
          }
        }
        return s;
      });
      return option;
    }

    case 'pie':
    case 'donut': {
      const option: echarts.EChartsOption = { ...baseOption };
      (option as Record<string, unknown>).tooltip = { trigger: 'item' };
      (option as Record<string, unknown>).series = [
        {
          type: 'pie',
          name: chartData.title ?? 'Chart',
          data: chartData.categories.map((category, index) => ({
            name: category,
            value: chartData.series[0]?.values[index] ?? 0
          })),
          radius: renderKind === 'donut' ? ['40%', '70%'] : '60%',
          itemStyle: {
            borderRadius: 6,
            borderColor: '#fff',
            borderWidth: 2
          },
          label: {
            show: true,
            color: '#4b5563',
            fontSize: 12
          }
        }
      ];
      return option;
    }

    default:
      return baseOption;
  }
}

function makeSvgResponsive(svg: string): string {
  // Replace fixed width/height with responsive 100% and preserve aspect ratio
  return svg
    .replace(/width="\d+"/, 'width="100%"')
    .replace(/height="\d+"/, 'height="100%"')
    .replace(
      /viewBox="([^"]+)"/,
      (match, _viewBox) => `${match} preserveAspectRatio="xMidYMid meet"`
    );
}

export interface ExtractedChartPosition {
  slideIndex: number;
  chartId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function collectChartPositionsFromDocument(inputDocument?: Document): ExtractedChartPosition[] {
  const document = inputDocument ?? (globalThis as unknown as { document: Document }).document;
  const results: ExtractedChartPosition[] = [];
  const slides = document.querySelectorAll('.pepetex-slide');

  slides.forEach((slide, slideIndex) => {
    const containers = slide.querySelectorAll('[data-pepetex-chart-id], [data-pepetex-type="chart"][data-pepetex-id]');
    containers.forEach((container) => {
      const chartId = container.getAttribute('data-pepetex-chart-id')
        ?? container.getAttribute('data-pepetex-id');
      if (!chartId) return;

      const rect = container.getBoundingClientRect();
      const slideRect = slide.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      results.push({
        slideIndex,
        chartId,
        x: rect.left - slideRect.left,
        y: rect.top - slideRect.top,
        width: rect.width,
        height: rect.height
      });
    });
  });

  return results;
}

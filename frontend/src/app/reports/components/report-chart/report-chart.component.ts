import { AfterViewInit, Component, ElementRef, Input, OnChanges, ViewChild } from '@angular/core';

@Component({
  selector: 'app-report-chart',
  templateUrl: './report-chart.component.html',
  styleUrls: ['./report-chart.component.css']
})
export class ReportChartComponent implements AfterViewInit, OnChanges {
  @Input() type: 'bar' | 'line' | 'pie' | 'doughnut' = 'bar';
  @Input() labels: string[] = [];
  @Input() data: number[] = [];
  @Input() title = '';

  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
  private chart: unknown = null;

  /** Stable id used by canvas[aria-describedby] -> sr-only fallback table. */
  readonly srTableId = `report-chart-sr-${Math.random().toString(36).slice(2, 9)}`;

  ngAfterViewInit(): void {
    this.renderChart();
  }

  ngOnChanges(): void {
    if (this.chart && typeof (this.chart as { destroy?: () => void }).destroy === 'function') {
      (this.chart as { destroy: () => void }).destroy();
    }
    this.renderChart();
  }

  /**
   * FN-1191 — read the chart accent from --primary-color so the canvas fill
   * tracks the global theme token rather than carrying a hardcoded hex.
   */
  private themeColor(token: string, fallback: string): string {
    if (typeof document === 'undefined' || !document.documentElement) return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    return value || fallback;
  }

  private renderChart(): void {
    if (!this.chartCanvas?.nativeElement) return;
    const accent = this.themeColor('--primary-color', '#1a237e');
    import('chart.js/auto').then((ChartModule) => {
      const Chart = (ChartModule as { Chart?: new (el: HTMLCanvasElement, config: unknown) => unknown }).Chart;
      if (!Chart) return;
      const config = {
        type: this.type,
        data: {
          labels: this.labels,
          datasets: [{ label: this.title, data: this.data, backgroundColor: accent, borderColor: accent }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      };
      this.chart = new Chart(this.chartCanvas.nativeElement, config);
    }).catch(() => {
      this.chart = null;
    });
  }
}

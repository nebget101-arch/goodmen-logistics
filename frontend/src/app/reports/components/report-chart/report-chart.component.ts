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

  ngAfterViewInit(): void {
    this.renderChart();
  }

  ngOnChanges(): void {
    if (this.chart && typeof (this.chart as { destroy?: () => void }).destroy === 'function') {
      (this.chart as { destroy: () => void }).destroy();
    }
    this.renderChart();
  }

  private renderChart(): void {
    if (!this.chartCanvas?.nativeElement) return;
    import('chart.js/auto').then((ChartModule) => {
      const Chart = (ChartModule as { Chart?: new (el: HTMLCanvasElement, config: unknown) => unknown }).Chart;
      if (!Chart) return;
      const config = {
        type: this.type,
        data: {
          labels: this.labels,
          datasets: [{ label: this.title, data: this.data, backgroundColor: '#1a237e', borderColor: '#1a237e' }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      };
      this.chart = new Chart(this.chartCanvas.nativeElement, config);
    }).catch(() => {
      this.chart = null;
    });
  }
}

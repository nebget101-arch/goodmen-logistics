import { AfterViewInit, Component, ElementRef, Input, OnChanges, ViewChild } from '@angular/core';
import { Chart, ChartConfiguration } from 'chart.js/auto';

@Component({
  selector: 'app-report-chart',
  templateUrl: './report-chart.component.html',
  styleUrls: ['./report-chart.component.css']
})
export class ReportChartComponent implements AfterViewInit, OnChanges {
  @Input() type: ChartConfiguration['type'] = 'bar';
  @Input() labels: string[] = [];
  @Input() data: number[] = [];
  @Input() title = '';

  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
  private chart?: Chart;

  ngAfterViewInit(): void {
    this.renderChart();
  }

  ngOnChanges(): void {
    if (this.chart) {
      this.chart.destroy();
      this.renderChart();
    }
  }

  private renderChart(): void {
    if (!this.chartCanvas) return;
    const config: ChartConfiguration = {
      type: this.type,
      data: {
        labels: this.labels,
        datasets: [
          {
            label: this.title,
            data: this.data,
            backgroundColor: '#1a237e',
            borderColor: '#1a237e'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        }
      }
    };

    this.chart = new Chart(this.chartCanvas.nativeElement, config);
  }
}

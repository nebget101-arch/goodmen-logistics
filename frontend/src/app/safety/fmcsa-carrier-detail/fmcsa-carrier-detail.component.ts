import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  FmcsaSafetyService,
  MonitoredCarrier,
  SafetySnapshot,
  BasicDetail,
  InspectionDetail
} from '../fmcsa-safety.service';
import { AccessControlService } from '../../services/access-control.service';

interface ChartDataset {
  label: string;
  data: (number | null)[];
  borderColor: string;
  backgroundColor: string;
  tension: number;
  pointRadius: number;
  pointHoverRadius: number;
  borderWidth: number;
  spanGaps: boolean;
}

@Component({
  selector: 'app-fmcsa-carrier-detail',
  templateUrl: './fmcsa-carrier-detail.component.html',
  styleUrls: ['./fmcsa-carrier-detail.component.css']
})
export class FmcsaCarrierDetailComponent implements OnInit, OnDestroy, AfterViewInit {
  carrier: MonitoredCarrier | null = null;
  latestSnapshot: SafetySnapshot | null = null;
  history: SafetySnapshot[] = [];
  basicDetails: BasicDetail[] = [];
  inspectionDetails: InspectionDetail[] = [];
  selectedInspection: InspectionDetail | null = null;
  loading = true;
  error = '';
  scrapingBasic = false;
  basicLoading = false;
  selectedBasic: BasicDetail | null = null;

  chartLabels: string[] = [];
  chartData: ChartDataset[] = [];

  // Pagination for history table
  historyPage = 0;
  historyPageSize = 10;

  @ViewChild('smsChart') smsChartCanvas!: ElementRef<HTMLCanvasElement>;
  private chart: unknown = null;
  private chartReady = false;
  private destroy$ = new Subject<void>();

  private readonly BASIC_CATEGORIES = [
    { key: 'unsafe_driving_score', label: 'Unsafe Driving', color: '#ef4444' },
    { key: 'hos_compliance_score', label: 'HOS Compliance', color: '#f59e0b' },
    { key: 'vehicle_maintenance_score', label: 'Vehicle Maint.', color: '#8b5cf6' },
    { key: 'controlled_substances_score', label: 'Ctrl Substances', color: '#ec4899' },
    { key: 'driver_fitness_score', label: 'Driver Fitness', color: '#38bdf8' },
    { key: 'crash_indicator_score', label: 'Crash Indicator', color: '#10b981' },
    { key: 'hazmat_score', label: 'Hazmat', color: '#f97316' }
  ];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private fmcsaService: FmcsaSafetyService,
    private accessControl: AccessControlService
  ) {}

  ngOnInit(): void {
    const carrierId = this.route.snapshot.paramMap.get('id') || '';
    if (!carrierId) {
      this.error = 'No carrier ID provided';
      this.loading = false;
      return;
    }
    this.loadCarrier(carrierId);
  }

  ngAfterViewInit(): void {
    this.chartReady = true;
    if (this.history.length > 0) {
      this.renderChart();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.destroyChart();
  }

  private loadCarrier(carrierId: string): void {
    this.loading = true;
    this.error = '';

    this.fmcsaService.getCarriers()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (carriers) => {
          this.carrier = carriers.find(c => c.id === carrierId) || null;
          if (!this.carrier) {
            this.error = 'Carrier not found';
            this.loading = false;
            return;
          }
          this.loadHistory(carrierId);
        },
        error: () => {
          this.error = 'Failed to load carrier data';
          this.loading = false;
        }
      });
  }

  private loadHistory(carrierId: string): void {
    this.fmcsaService.getCarrierHistory(carrierId, 100, 0)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (resp) => {
          this.history = resp.snapshots.sort(
            (a, b) => new Date(a.scraped_at).getTime() - new Date(b.scraped_at).getTime()
          );

          // Merge latest snapshot data into carrier for the info card
          if (this.history.length > 0 && this.carrier) {
            const latest = this.history[this.history.length - 1];
            this.latestSnapshot = latest;
            this.carrier = {
              ...this.carrier,
              total_drivers: latest.total_drivers ?? this.carrier.total_drivers,
              total_power_units: latest.total_power_units ?? this.carrier.total_power_units,
              operating_status: latest.operating_status ?? this.carrier.operating_status,
              safety_rating: latest.safety_rating ?? this.carrier.safety_rating,
              safety_rating_date: latest.safety_rating_date ?? (this.carrier as any).safety_rating_date,
              scraped_at: latest.scraped_at,
              authority_common: latest.authority_common ?? this.carrier.authority_common,
              authority_contract: latest.authority_contract ?? this.carrier.authority_contract,
              authority_broker: latest.authority_broker ?? this.carrier.authority_broker,
              bipd_insurance_on_file: latest.bipd_insurance_on_file ?? this.carrier.bipd_insurance_on_file,
              cargo_insurance_on_file: latest.cargo_insurance_on_file ?? this.carrier.cargo_insurance_on_file,
              bond_insurance_on_file: latest.bond_insurance_on_file ?? this.carrier.bond_insurance_on_file,
            } as any;
          }

          this.buildChartData();
          this.loading = false;
          this.loadBasicDetails();
          if (this.chartReady) {
            this.renderChart();
          }
        },
        error: () => {
          this.loading = false;
        }
      });
  }

  private buildChartData(): void {
    this.chartLabels = this.history.map(s =>
      new Date(s.scraped_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    );

    this.chartData = this.BASIC_CATEGORIES.map(cat => ({
      label: cat.label,
      data: this.history.map(s => (s as any)[cat.key] as number | null),
      borderColor: cat.color,
      backgroundColor: cat.color + '20',
      tension: 0.3,
      pointRadius: 3,
      pointHoverRadius: 6,
      borderWidth: 2,
      spanGaps: true
    }));
  }

  private renderChart(): void {
    if (!this.smsChartCanvas?.nativeElement || this.chartData.length === 0) return;
    this.destroyChart();

    import('chart.js/auto').then((ChartModule) => {
      const ChartCtor = (ChartModule as { Chart?: new (el: HTMLCanvasElement, config: unknown) => unknown }).Chart;
      if (!ChartCtor) return;

      this.chart = new ChartCtor(this.smsChartCanvas.nativeElement, {
        type: 'line',
        data: {
          labels: this.chartLabels,
          datasets: this.chartData
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              min: 0,
              max: 100,
              title: { display: true, text: 'Percentile', color: '#94a3b8' },
              ticks: { color: '#64748b' },
              grid: { color: 'rgba(51, 65, 85, 0.4)' }
            },
            x: {
              title: { display: true, text: 'Date', color: '#94a3b8' },
              ticks: { color: '#64748b' },
              grid: { color: 'rgba(51, 65, 85, 0.2)' }
            }
          },
          plugins: {
            legend: {
              display: true,
              position: 'bottom',
              labels: { color: '#94a3b8', usePointStyle: true, padding: 16 }
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              titleColor: '#e2e8f0',
              bodyColor: '#94a3b8',
              borderColor: 'rgba(51, 65, 85, 0.8)',
              borderWidth: 1
            }
          },
          interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false
          }
        }
      });
    }).catch(() => {
      this.chart = null;
    });
  }

  private destroyChart(): void {
    if (this.chart && typeof (this.chart as { destroy?: () => void }).destroy === 'function') {
      (this.chart as { destroy: () => void }).destroy();
      this.chart = null;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  getUsdotStatus(): string {
    return (this.carrier as any)?.usdot_status || 'N/A';
  }

  getUsdotStatusClass(): string {
    const status = ((this.carrier as any)?.usdot_status || '').toLowerCase();
    return status === 'active' ? 'status-active' : 'status-inactive';
  }

  getOperatingAuthorityClass(): string {
    const cleaned = this.cleanOperatingStatus(this.carrier?.operating_status || null).toLowerCase();
    return cleaned.includes('authorized') && !cleaned.includes('not') ? 'status-active' : 'status-inactive';
  }

  cleanOperatingStatus(status: string | null): string {
    if (!status) return 'N/A';
    const cleaned = status.replace(/\s*\*.*$/i, '').trim();
    return cleaned || status.split('*')[0].trim() || 'N/A';
  }

  getScoreClass(score: number | string | null): string {
    if (score === null || score === undefined) return 'score-na';
    const num = typeof score === 'string' ? parseFloat(score) : score;
    if (isNaN(num)) return 'score-na';
    if (num >= 75) return 'score-danger';
    if (num >= 50) return 'score-warning';
    return 'score-good';
  }

  getSafetyRatingClass(rating: string | null): string {
    if (!rating) return 'badge-na';
    const lower = rating.toLowerCase();
    if (lower === 'satisfactory') return 'badge-satisfactory';
    if (lower === 'conditional') return 'badge-conditional';
    if (lower === 'unsatisfactory') return 'badge-unsatisfactory';
    return 'badge-na';
  }

  getAuthorityStatus(value: string | null): string {
    if (!value) return 'N/A';
    const lower = value.toLowerCase();
    if (lower.includes('active') || lower === 'a') return 'Active';
    if (lower.includes('inactive') || lower === 'i' || lower.includes('revoked') || lower.includes('none')) return 'Inactive';
    return 'N/A';
  }

  getAuthorityClass(value: string | null): string {
    const status = this.getAuthorityStatus(value);
    if (status === 'Active') return 'status-active';
    if (status === 'Inactive') return 'status-inactive';
    return 'status-na';
  }

  getInsuranceStatus(value: string | null): string {
    if (!value || value === '0' || value.toLowerCase() === 'no' || value.toLowerCase() === 'none') return 'none';
    return 'filed';
  }

  formatScore(score: number | null): string {
    if (score === null || score === undefined) return 'N/A';
    return score.toString();
  }

  formatDate(dateStr: string | null): string {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  // ─── Inspection / Crash / Operations Helpers ────────────────────────────────

  isOosAboveAverage(rate: string | null, avg: string | null): boolean {
    if (!rate || !avg) return false;
    const rateNum = parseFloat(rate.replace('%', ''));
    const avgNum = parseFloat(avg.replace('%', ''));
    if (isNaN(rateNum) || isNaN(avgNum)) return false;
    return rateNum > avgNum;
  }

  formatOosRate(rate: string | null): string {
    if (rate === null || rate === undefined) return '0%';
    const num = parseFloat(rate.replace('%', ''));
    if (isNaN(num)) return '0%';
    return num + '%';
  }

  formatNationalAvg(avg: string | null): string {
    if (!avg) return 'N/A';
    const num = parseFloat(avg.replace('%', ''));
    if (isNaN(num)) return 'N/A';
    return num + '%';
  }

  getCargoList(): string[] {
    if (!this.latestSnapshot?.cargo_carried) return [];
    return this.latestSnapshot.cargo_carried
      .split(',')
      .map(c => c.trim())
      .filter(c => c.length > 0);
  }

  // ─── Pagination ──────────────────────────────────────────────────────────────

  get pagedHistory(): SafetySnapshot[] {
    const start = this.historyPage * this.historyPageSize;
    return this.history.slice().reverse().slice(start, start + this.historyPageSize);
  }

  get totalHistoryPages(): number {
    return Math.ceil(this.history.length / this.historyPageSize);
  }

  prevPage(): void {
    if (this.historyPage > 0) this.historyPage--;
  }

  nextPage(): void {
    if (this.historyPage < this.totalHistoryPages - 1) this.historyPage++;
  }

  // ─── BASIC Details ──────────────────────────────────────────────────────────

  canScrape(): boolean {
    return this.accessControl.hasPermission('fmcsa_safety.scrape');
  }

  scrapeBasicDetails(): void {
    if (!this.carrier) return;
    this.scrapingBasic = true;
    this.fmcsaService.triggerCarrierBasicDetailScrape(this.carrier.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.scrapingBasic = false;
        },
        error: () => {
          this.scrapingBasic = false;
          this.error = 'Failed to trigger BASIC detail scrape';
        }
      });
  }

  loadBasicDetails(): void {
    if (!this.carrier) return;
    this.basicLoading = true;
    this.fmcsaService.getCarrierBasicDetails(this.carrier.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (resp) => {
          this.basicDetails = resp.basic_details || [];
          if (this.basicDetails.length > 0 && !this.selectedBasic) {
            this.selectedBasic = this.basicDetails[0];
          }
          this.basicLoading = false;
        },
        error: () => {
          this.basicLoading = false;
        }
      });

    // Also load inspection details
    this.fmcsaService.getCarrierInspectionDetails(this.carrier.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (resp) => {
          this.inspectionDetails = (resp.inspection_details || []).map(d => ({
            ...d,
            vehicles: typeof d.vehicles === 'string' ? JSON.parse(d.vehicles) : (d.vehicles || []),
            violations: typeof d.violations === 'string' ? JSON.parse(d.violations) : (d.violations || []),
          }));
        },
        error: () => {}
      });
  }

  selectInspection(detail: InspectionDetail | null): void {
    this.selectedInspection = this.selectedInspection?.inspection_id === detail?.inspection_id ? null : detail;
  }

  selectBasic(detail: BasicDetail): void {
    this.selectedBasic = detail;
  }

  getBasicDisplayName(name: string): string {
    const map: Record<string, string> = {
      'UnsafeDriving': 'Unsafe Driving',
      'CrashIndicator': 'Crash Indicator',
      'HOSCompliance': 'HOS Compliance',
      'VehicleMaint': 'Vehicle Maint.',
      'DrugsAlcohol': 'Ctrl Substances',
      'HMCompliance': 'Hazmat',
      'DriverFitness': 'Driver Fitness'
    };
    return map[name] || name;
  }

  getBasicColor(name: string): string {
    const map: Record<string, string> = {
      'UnsafeDriving': '#ef4444',
      'CrashIndicator': '#10b981',
      'HOSCompliance': '#f59e0b',
      'VehicleMaint': '#8b5cf6',
      'DrugsAlcohol': '#ec4899',
      'HMCompliance': '#f97316',
      'DriverFitness': '#38bdf8'
    };
    return map[name] || '#94a3b8';
  }

  getInspectionDetailByReport(reportNumber: string | null): InspectionDetail | undefined {
    if (!reportNumber) return undefined;
    return this.inspectionDetails.find(d => d.report_number === reportNumber);
  }

  getMeasureClass(percentile: number | null, threshold: number | null): string {
    if (percentile === null) return 'score-na';
    if (threshold && percentile >= threshold) return 'score-danger';
    if (percentile >= 50) return 'score-warning';
    return 'score-good';
  }

  // ─── Navigation ──────────────────────────────────────────────────────────────

  goBack(): void {
    this.router.navigate(['/safety/fmcsa']);
  }
}

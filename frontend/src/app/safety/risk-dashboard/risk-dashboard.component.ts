import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FleetRiskSummary, RiskLevel, RiskTrend, SafetyRiskService } from '../safety-risk.service';

@Component({
  selector: 'app-risk-dashboard',
  templateUrl: './risk-dashboard.component.html',
  styleUrls: ['./risk-dashboard.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RiskDashboardComponent implements OnInit {
  summary: FleetRiskSummary | null = null;
  loading = false;
  error = '';

  constructor(
    private safetyRisk: SafetyRiskService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadSummary();
  }

  loadSummary(): void {
    this.loading = true;
    this.error = '';
    this.safetyRisk.getFleetSummary().subscribe({
      next: (data) => {
        this.summary = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Failed to load fleet risk summary.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  riskLevelClass(level: RiskLevel | string | null): string {
    switch (level) {
      case 'low': return 'badge-green';
      case 'medium': return 'badge-yellow';
      case 'high': return 'badge-red';
      case 'critical': return 'badge-critical';
      default: return 'badge-neutral';
    }
  }

  trendIcon(trend: RiskTrend | string | null): string {
    switch (trend) {
      case 'improving': return 'trending_up';
      case 'worsening': return 'trending_down';
      default: return 'trending_flat';
    }
  }

  trendClass(trend: RiskTrend | string | null): string {
    switch (trend) {
      case 'improving': return 'trend-up';
      case 'worsening': return 'trend-down';
      default: return 'trend-flat';
    }
  }

  get totalHighCritical(): number {
    if (!this.summary) return 0;
    return (this.summary.by_level.high ?? 0) + (this.summary.by_level.critical ?? 0);
  }

  get distributionTotal(): number {
    if (!this.summary) return 1;
    const t = this.summary.by_level.low + this.summary.by_level.medium +
              this.summary.by_level.high + this.summary.by_level.critical;
    return t > 0 ? t : 1;
  }

  levelWidth(count: number): number {
    return Math.round((count / this.distributionTotal) * 100);
  }

  navigateToDriver(driverId: string): void {
    this.router.navigate(['/safety/risk-scores', driverId]);
  }
}

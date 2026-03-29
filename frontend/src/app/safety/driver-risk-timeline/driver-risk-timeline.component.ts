import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import {
  CategoryScores,
  DriverRiskEventsResponse,
  DriverRiskScore,
  RiskEvent,
  RiskLevel,
  RiskTrend,
  SafetyRiskService,
} from '../safety-risk.service';

interface CategoryDef {
  key: keyof CategoryScores;
  label: string;
  weight: number;
}

const CATEGORY_DEFS: CategoryDef[] = [
  { key: 'mvr',       label: 'MVR',       weight: 25 },
  { key: 'psp',       label: 'PSP',       weight: 15 },
  { key: 'fmcsa',     label: 'FMCSA',     weight: 20 },
  { key: 'incidents', label: 'Incidents', weight: 15 },
  { key: 'claims',    label: 'Claims',    weight: 10 },
  { key: 'hos',       label: 'HOS',       weight: 10 },
  { key: 'training',  label: 'Training',  weight:  5 },
];

@Component({
  selector: 'app-driver-risk-timeline',
  templateUrl: './driver-risk-timeline.component.html',
  styleUrls: ['./driver-risk-timeline.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DriverRiskTimelineComponent implements OnInit {
  driverId = '';
  score: DriverRiskScore | null = null;
  events: RiskEvent[] = [];
  eventsTotal = 0;
  eventsPage = 1;
  eventsPageSize = 25;

  loading = false;
  loadingEvents = false;
  error = '';
  recalculating = false;

  readonly categoryDefs = CATEGORY_DEFS;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private safetyRisk: SafetyRiskService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.driverId = this.route.snapshot.paramMap.get('driverId') ?? '';
    if (this.driverId) {
      this.loadAll();
    }
  }

  loadAll(): void {
    this.loading = true;
    this.error = '';
    forkJoin({
      score: this.safetyRisk.getDriverScore(this.driverId),
      eventsResp: this.safetyRisk.getDriverEvents(this.driverId, this.eventsPage, this.eventsPageSize),
    }).subscribe({
      next: ({ score, eventsResp }) => {
        this.score = score;
        this.score = this.parseCategoryScores(score);
        this.events = eventsResp.data;
        this.eventsTotal = eventsResp.total;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Failed to load driver risk data.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private parseCategoryScores(score: DriverRiskScore): DriverRiskScore {
    if (!score.current) return score;
    let cats = score.current.category_scores;
    if (typeof cats === 'string') {
      try {
        cats = JSON.parse(cats) as CategoryScores;
      } catch {
        cats = null;
      }
    }
    return {
      ...score,
      current: { ...score.current, category_scores: cats },
    };
  }

  loadEvents(page: number): void {
    this.eventsPage = page;
    this.loadingEvents = true;
    this.safetyRisk.getDriverEvents(this.driverId, page, this.eventsPageSize).subscribe({
      next: (resp: DriverRiskEventsResponse) => {
        this.events = resp.data;
        this.eventsTotal = resp.total;
        this.loadingEvents = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingEvents = false;
        this.cdr.markForCheck();
      },
    });
  }

  recalculate(): void {
    this.recalculating = true;
    this.safetyRisk.recalculate(this.driverId).subscribe({
      next: () => {
        this.safetyRisk.getDriverScore(this.driverId).subscribe({
          next: (s) => {
            this.score = this.parseCategoryScores(s);
            this.recalculating = false;
            this.cdr.markForCheck();
          },
          error: () => {
            this.recalculating = false;
            this.cdr.markForCheck();
          },
        });
      },
      error: () => {
        this.recalculating = false;
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

  severityClass(severity: RiskLevel | string | null): string {
    return this.riskLevelClass(severity);
  }

  scoreColor(score: number | null): string {
    if (score === null) return '#94a3b8';
    if (score <= 25) return '#4ade80';
    if (score <= 50) return '#fbbf24';
    if (score <= 75) return '#f87171';
    return '#fca5a5';
  }

  scoreDelta(event: RiskEvent): string {
    if (event.score_before === null || event.score_after === null) return '';
    const delta = event.score_after - event.score_before;
    return delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
  }

  scoreDeltaClass(event: RiskEvent): string {
    if (event.score_before === null || event.score_after === null) return '';
    const delta = event.score_after - event.score_before;
    if (delta > 0) return 'delta-up';
    if (delta < 0) return 'delta-down';
    return 'delta-flat';
  }

  eventTypeIcon(eventType: string): string {
    switch (eventType) {
      case 'mvr_violation':       return 'directions_car';
      case 'inspection_fail':     return 'find_in_page';
      case 'accident':            return 'car_crash';
      case 'claim':               return 'request_quote';
      case 'hos_violation':       return 'schedule';
      case 'training_complete':   return 'school';
      case 'training_overdue':    return 'assignment_late';
      default:                    return 'event_note';
    }
  }

  get totalPages(): number {
    return Math.ceil(this.eventsTotal / this.eventsPageSize);
  }

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  getCategoryScore(key: keyof CategoryScores): number | null {
    return this.score?.current?.category_scores?.[key] ?? null;
  }

  back(): void {
    this.router.navigate(['/safety/risk-scores']);
  }
}

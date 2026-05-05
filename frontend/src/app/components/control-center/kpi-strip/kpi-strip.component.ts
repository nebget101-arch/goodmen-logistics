import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiService } from '../../../services/api.service';
import {
  DashboardWindow,
  DashboardWindowService,
} from '../../../services/dashboard-window.service';

type Severity = 'good' | 'warn' | 'critical';
type DeltaPolarity = 'higher-better' | 'lower-better';

interface KpiDef {
  id: string;
  label: string;
  /** Current-value renderer (string already formatted for display). */
  value: (s: Record<string, any>) => string;
  /** Optional secondary line (target / sub-text). */
  sub: (s: Record<string, any>) => string;
  /** Numeric source key in `delta` object — used for delta rendering. */
  deltaKey: string;
  /** Severity threshold logic from current snapshot. */
  severity: (s: Record<string, any>) => Severity;
  /** Click-through target. */
  routerLink: string | string[];
  queryParams?: Record<string, string>;
  /** Whether higher delta is good or bad. Drives delta arrow color. */
  polarity: DeltaPolarity;
  /** When true, delta is rendered as a percentage-point change. */
  deltaIsPercent?: boolean;
}

interface KpiViewModel {
  id: string;
  label: string;
  value: string;
  sub: string;
  severity: Severity;
  routerLink: string | string[];
  queryParams?: Record<string, string>;
  delta: {
    raw: number | null;
    text: string;
    direction: 'up' | 'down' | 'flat' | 'none';
    tone: 'good' | 'bad' | 'neutral';
  };
}

interface NormalizedStats {
  current: Record<string, any>;
  delta: Record<string, any>;
  hasDelta: boolean;
}

const KPI_DEFS: readonly KpiDef[] = [
  {
    id: 'active-drivers',
    label: 'Active Drivers',
    value: (s) => `${num(s['activeDrivers'])}/${num(s['totalDrivers'])}`,
    sub: (s) => `${num(s['totalDrivers'])} total in fleet`,
    deltaKey: 'activeDrivers',
    severity: () => 'good',
    routerLink: '/drivers',
    polarity: 'higher-better',
  },
  {
    id: 'vehicle-oos',
    label: 'Vehicles OOS',
    value: (s) => `${num(s['oosVehicles'])}`,
    sub: (s) => `${num(s['activeVehicles'])}/${num(s['totalVehicles'])} active`,
    deltaKey: 'oosVehicles',
    severity: (s) => (toNum(s['oosVehicles']) > 0 ? 'critical' : 'good'),
    routerLink: '/vehicles',
    queryParams: { filter: 'oos' },
    polarity: 'lower-better',
  },
  {
    id: 'hos-violations',
    label: 'HOS Violations',
    value: (s) => `${num(s['hosViolations'])}`,
    sub: () => 'Violations / warnings',
    deltaKey: 'hosViolations',
    severity: (s) => (toNum(s['hosViolations']) > 0 ? 'warn' : 'good'),
    routerLink: '/hos',
    polarity: 'lower-better',
  },
  {
    id: 'dqf-compliance',
    label: 'DQF Compliance',
    value: (s) => `${num(s['dqfComplianceRate'])}%`,
    sub: () => 'Target ≥ 90%',
    deltaKey: 'dqfComplianceRate',
    severity: (s) => {
      const v = toNum(s['dqfComplianceRate']);
      if (v < 75) return 'critical';
      if (v < 90) return 'warn';
      return 'good';
    },
    routerLink: '/drivers/dqf',
    polarity: 'higher-better',
    deltaIsPercent: true,
  },
  {
    id: 'med-certs',
    label: 'Medical Certs',
    value: (s) => `${num(s['expiredMedCerts'])}`,
    sub: (s) => `${num(s['upcomingMedCerts'])} expiring soon`,
    deltaKey: 'expiredMedCerts',
    severity: (s) => {
      if (toNum(s['expiredMedCerts']) > 0) return 'critical';
      if (toNum(s['upcomingMedCerts']) > 0) return 'warn';
      return 'good';
    },
    routerLink: '/drivers/dqf',
    queryParams: { filter: 'med-certs' },
    polarity: 'lower-better',
  },
  {
    id: 'maintenance-due',
    label: 'Maintenance Due',
    value: (s) => `${num(s['vehiclesNeedingMaintenance'])}`,
    sub: () => 'Vehicles needing service',
    deltaKey: 'vehiclesNeedingMaintenance',
    severity: (s) => (toNum(s['vehiclesNeedingMaintenance']) > 0 ? 'warn' : 'good'),
    routerLink: '/vehicles',
    queryParams: { filter: 'maintenance-due' },
    polarity: 'lower-better',
  },
];

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function num(v: unknown): string {
  return String(toNum(v));
}

function normalize(raw: any): NormalizedStats {
  if (!raw || typeof raw !== 'object') return { current: {}, delta: {}, hasDelta: false };
  if (raw.current && typeof raw.current === 'object') {
    const delta = raw.delta && typeof raw.delta === 'object' ? raw.delta : {};
    return { current: raw.current, delta, hasDelta: Object.keys(delta).length > 0 };
  }
  return { current: raw, delta: {}, hasDelta: false };
}

function buildDelta(
  rawDelta: number | null,
  polarity: DeltaPolarity,
  hasDelta: boolean,
  isPercent: boolean,
): KpiViewModel['delta'] {
  if (!hasDelta || rawDelta === null || !Number.isFinite(rawDelta)) {
    return { raw: null, text: '', direction: 'none', tone: 'neutral' };
  }
  const direction: 'up' | 'down' | 'flat' = rawDelta > 0 ? 'up' : rawDelta < 0 ? 'down' : 'flat';
  const tone: 'good' | 'bad' | 'neutral' =
    direction === 'flat'
      ? 'neutral'
      : (direction === 'up' && polarity === 'higher-better') ||
          (direction === 'down' && polarity === 'lower-better')
        ? 'good'
        : 'bad';
  const sign = rawDelta > 0 ? '+' : rawDelta < 0 ? '−' : '±';
  const abs = Math.abs(rawDelta);
  const text = `${sign}${isPercent ? `${abs}pp` : abs}`;
  return { raw: rawDelta, text, direction, tone };
}

/**
 * FN-1332 — top-of-page KPI strip.
 *
 * Replaces the old fleet-health metrics grid in the dashboard. Subscribes to
 * the global dashboard-window service so changing the Today/7d/30d selector
 * re-fetches stats scoped to that window. The endpoint may return either the
 * legacy flat-stats shape or the new {current, previous, delta} envelope from
 * FN-1333; the component handles both so frontend + backend can land in any
 * order.
 */
@Component({
  selector: 'app-kpi-strip',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './kpi-strip.component.html',
  styleUrls: ['./kpi-strip.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KpiStripComponent implements OnInit {
  loading = true;
  error: string | null = null;
  cards: KpiViewModel[] = [];
  activeWindow: DashboardWindow;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly api: ApiService,
    private readonly windowService: DashboardWindowService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.activeWindow = this.windowService.current();
  }

  ngOnInit(): void {
    this.windowService
      .window$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((w) => {
        this.activeWindow = w;
        this.fetch();
      });
  }

  private fetch(): void {
    this.loading = true;
    this.error = null;
    this.cdr.markForCheck();

    this.api
      .getDashboardStats({ window: this.activeWindow })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (raw) => {
          const stats = normalize(raw);
          this.cards = KPI_DEFS.map((def) => {
            const rawDelta = stats.delta[def.deltaKey];
            return {
              id: def.id,
              label: def.label,
              value: def.value(stats.current),
              sub: def.sub(stats.current),
              severity: def.severity(stats.current),
              routerLink: def.routerLink,
              queryParams: def.queryParams,
              delta: buildDelta(
                typeof rawDelta === 'number' ? rawDelta : null,
                def.polarity,
                stats.hasDelta,
                !!def.deltaIsPercent,
              ),
            };
          });
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[kpi-strip] load failed:', err);
          this.error = 'Could not load KPIs.';
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }

  trackById = (_: number, card: KpiViewModel): string => card.id;
}

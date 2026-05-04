import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subject, Subscription } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { WebsocketService } from './websocket.service';

export type SmartAlertType =
  | 'hos_imminent'
  | 'fatigue'
  | 'inspection_overdue'
  | 'late_load_risk';

export type SmartAlertSubjectKind = 'driver' | 'vehicle' | 'load';
export type SmartAlertSeverityBucket = 'critical' | 'high' | 'medium' | 'low';

export interface SmartAlertActionLink {
  label: string;
  /** Angular router commands array, e.g. ['/drivers', '123']. */
  routerLink?: (string | number)[];
  queryParams?: Record<string, string | number | boolean>;
  /** Absolute URL — present when the backend emits an external link instead of router commands. */
  href?: string;
}

/**
 * Server-shape (FN-1161 `GET /api/alerts/smart` and `alerts.smart.update`).
 * `severity` is a 0-100 numeric score; the categorical bucket is derived
 * client-side via `severityBucket()`.
 */
export interface SmartAlert {
  id: string;
  type: SmartAlertType;
  subjectId: string;
  subjectKind: SmartAlertSubjectKind;
  title: string;
  facts: Record<string, unknown>;
  severity: number;
  /** Optional link the AI scorer or aggregator may attach. */
  action?: SmartAlertActionLink;
  reasoning?: string;
  scoredBy?: string;
}

export interface SmartAlertsResponse {
  tenantId: string;
  alerts: SmartAlert[];
  upstreamErrors?: { source: string; error: string }[];
  generatedAt: string;
}

interface AlertsSnapshotEvent {
  tenantId: string;
  alerts: SmartAlert[];
  generatedAt: string;
}

interface AlertsDismissedEvent {
  tenantId: string;
  userId: string;
  alertId: string;
  dismissedAt: string;
}

/** WS event names emitted by the gateway (FN-1161). */
export const SMART_ALERT_WS_EVENTS = {
  UPDATE: 'alerts.smart.update',
  DISMISSED: 'alerts.smart.dismissed',
} as const;

/** Map a 0-100 numeric severity onto the categorical bucket used for the badge. */
export function severityBucket(score: number): SmartAlertSeverityBucket {
  const s = Number(score);
  if (!Number.isFinite(s)) return 'low';
  if (s >= 80) return 'critical';
  if (s >= 60) return 'high';
  if (s >= 40) return 'medium';
  return 'low';
}

/**
 * Render the `facts` blob into a single human-readable detail line. Backend
 * normalizers vary `facts` shape per alert type (FN-1161 `aggregator.js`),
 * so this helper is per-type.
 */
export function detailFor(alert: SmartAlert): string {
  const f = alert.facts || {};
  switch (alert.type) {
    case 'hos_imminent': {
      const minutes = pickNumber(f, ['minutesRemaining', 'minutes_remaining']);
      const window = pickString(f, ['windowType', 'window_type']);
      const driver = pickString(f, ['driverName', 'driver_name']);
      const parts: string[] = [];
      if (driver) parts.push(driver);
      if (minutes != null) parts.push(`${minutes} min until ${window || 'HOS'} violation`);
      else if (window) parts.push(`${window} window closing`);
      return parts.join(' — ') || 'Driver close to HOS violation.';
    }
    case 'fatigue': {
      const driver = pickString(f, ['driverName', 'driver_name']);
      const score = pickNumber(f, ['fatigueScore', 'fatigue_score', 'score']);
      const hours = pickNumber(f, ['consecutiveDutyHours', 'consecutive_duty_hours']);
      const parts: string[] = [];
      if (driver) parts.push(driver);
      if (score != null) parts.push(`fatigue score ${score}`);
      if (hours != null) parts.push(`${hours}h consecutive duty`);
      return parts.join(' — ') || 'Driver fatigue risk detected.';
    }
    case 'inspection_overdue': {
      const vehicle = pickString(f, ['vehicleLabel', 'vehicle_label', 'vehicleName', 'vehicle_name']);
      const days = pickNumber(f, ['daysOverdue', 'days_overdue']);
      const parts: string[] = [];
      if (vehicle) parts.push(vehicle);
      if (days != null) parts.push(`${days} day${days === 1 ? '' : 's'} overdue`);
      return parts.join(' — ') || 'Vehicle inspection overdue.';
    }
    case 'late_load_risk': {
      const load = pickString(f, ['loadNumber', 'load_number', 'reference']);
      const minutes = pickNumber(f, ['minutesLate', 'minutes_late']);
      const parts: string[] = [];
      if (load) parts.push(`Load ${load}`);
      if (minutes != null) parts.push(`${minutes} min over plan`);
      return parts.join(' — ') || 'Load delivery at risk.';
    }
    default:
      return 'Smart alert detected.';
  }
}

/**
 * Build a sensible action link when the backend doesn't emit one, based on
 * the subject of the alert. The component only renders the link when one is
 * present, so callers can rely on this returning `null` for unknown kinds.
 */
export function defaultActionFor(alert: SmartAlert): SmartAlertActionLink | null {
  if (alert.action) return alert.action;
  switch (alert.subjectKind) {
    case 'driver':
      return alert.subjectId
        ? { label: 'Open driver', routerLink: ['/drivers', alert.subjectId] }
        : null;
    case 'vehicle':
      return alert.subjectId
        ? { label: 'Open vehicle', routerLink: ['/vehicles', alert.subjectId] }
        : null;
    case 'load':
      return alert.subjectId
        ? { label: 'Open load', routerLink: ['/loads'], queryParams: { id: alert.subjectId } }
        : null;
    default:
      return null;
  }
}

/**
 * Smart Alerts feed for the Control Center panel.
 *
 * Source of truth is `GET /api/alerts/smart` (FN-1161). Live updates arrive
 * via Socket.IO events:
 *   • `alerts.smart.update`     — full snapshot, replaces the local list
 *   • `alerts.smart.dismissed`  — { alertId } removed for the current user
 *
 * Dismissals POST to `/api/alerts/smart/:id/dismiss`. Local state lives on
 * a BehaviorSubject so re-subscribers see the current ranked list immediately.
 */
@Injectable({ providedIn: 'root' })
export class SmartAlertsService implements OnDestroy {
  private readonly endpoint = `${environment.apiUrl}/alerts/smart`;
  private readonly _alerts$ = new BehaviorSubject<SmartAlert[]>([]);
  readonly alerts$: Observable<SmartAlert[]> = this._alerts$.asObservable();

  private readonly destroy$ = new Subject<void>();
  private wsSubscriptions: Subscription[] = [];
  private wsBound = false;

  constructor(
    private readonly http: HttpClient,
    private readonly ws: WebsocketService,
  ) {}

  /** Fetch the ranked alerts list from the gateway. */
  fetch(): Observable<SmartAlertsResponse> {
    return new Observable<SmartAlertsResponse>((sub) => {
      const inner = this.http.get<SmartAlertsResponse>(this.endpoint).subscribe({
        next: (resp) => {
          this._alerts$.next(this.normalize(resp?.alerts || []));
          sub.next(resp);
          sub.complete();
        },
        error: (err) => sub.error(err),
      });
      return () => inner.unsubscribe();
    });
  }

  /** Begin listening to live `alerts.smart.*` events. Idempotent. */
  startLiveUpdates(): void {
    if (this.wsBound) return;
    this.wsBound = true;

    this.wsSubscriptions.push(
      this.ws
        .on<AlertsSnapshotEvent>(SMART_ALERT_WS_EVENTS.UPDATE)
        .pipe(takeUntil(this.destroy$))
        .subscribe((evt) => {
          if (evt && Array.isArray(evt.alerts)) {
            this._alerts$.next(this.normalize(evt.alerts));
          }
        }),
    );
    this.wsSubscriptions.push(
      this.ws
        .on<AlertsDismissedEvent>(SMART_ALERT_WS_EVENTS.DISMISSED)
        .pipe(takeUntil(this.destroy$))
        .subscribe((evt) => {
          if (evt?.alertId) this.removeLocal(evt.alertId);
        }),
    );
  }

  /**
   * Dismiss an alert. Optimistically removes it from the local list, then
   * POSTs to the gateway. The server broadcasts `alerts.smart.dismissed`
   * to other tabs in the tenant room.
   */
  dismiss(alertId: string): Observable<void> {
    this.removeLocal(alertId);
    return this.http.post<void>(`${this.endpoint}/${encodeURIComponent(alertId)}/dismiss`, {});
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.wsSubscriptions.forEach((s) => s.unsubscribe());
    this.wsSubscriptions = [];
    this.wsBound = false;
    this._alerts$.complete();
  }

  /** Sort by severity desc; cap at 50. The gateway already ranks, but we
   *  re-sort defensively so a partial WS payload can't corrupt ordering. */
  private normalize(alerts: SmartAlert[]): SmartAlert[] {
    const filtered = (alerts || []).filter((a) => a && typeof a.id === 'string');
    filtered.sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));
    return filtered.slice(0, 50);
  }

  private removeLocal(alertId: string): void {
    const next = this._alerts$.value.filter((a) => a.id !== alertId);
    if (next.length !== this._alerts$.value.length) {
      this._alerts$.next(next);
    }
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length) return v;
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import type * as Leaflet from 'leaflet';
import { Subscription, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { PublicTrackService } from './public-track.service';
import {
  GeoPoint,
  PublicTrackErrorReason,
  PublicTrackMilestone,
  PublicTrackPayload
} from './public-track.models';

type ViewState = 'loading' | 'ready' | 'error';

/** How often we re-poll the read endpoint (acceptance criterion: 60s). */
const POLL_INTERVAL_MS = 60_000;
/** How often the "Last updated N min ago" label is recomputed. */
const CLOCK_TICK_MS = 30_000;

/**
 * FN-1678 (Story F) — standalone, UNAUTHENTICATED public tracking page mounted
 * at `/track/:token`. No app shell, no auth guard. Mobile-first: a status pill
 * + ETA hero, a map filling ~60% of the viewport, a milestone timeline, and a
 * "Last updated N min ago" line. Auto-refreshes every 60s via polling (not a
 * WebSocket). Honors the broker's `reveal_options`.
 *
 * Leaflet is imported dynamically so the map library lands in its own lazy
 * chunk and does not count against the page's initial-payload budget (≤ 200KB
 * gzipped); the shell renders first, the map hydrates a beat later.
 */
@Component({
  selector: 'app-public-track',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './public-track.component.html',
  styleUrls: ['./public-track.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PublicTrackComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapEl') private mapEl?: ElementRef<HTMLElement>;

  state: ViewState = 'loading';
  errorReason: PublicTrackErrorReason | null = null;
  payload: PublicTrackPayload | null = null;
  /** Recomputed every poll + clock tick from `payload.lastUpdatedAt`. */
  lastUpdatedLabel = '';

  private token = '';
  private now = Date.now();
  private pollSub?: Subscription;
  private clockSub?: Subscription;

  // Leaflet handles — populated lazily once the library + a payload arrive.
  private L?: typeof Leaflet;
  private map?: Leaflet.Map;
  private layers?: Leaflet.LayerGroup;
  private viewReady = false;

  constructor(
    private route: ActivatedRoute,
    private trackService: PublicTrackService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.fail('not_found');
      return;
    }
    this.startPolling();
    // Tick the relative-time label independently of the network poll so
    // "N min ago" stays honest between refreshes.
    this.clockSub = timer(CLOCK_TICK_MS, CLOCK_TICK_MS).subscribe(() => {
      this.now = Date.now();
      this.recomputeLastUpdated();
      this.cdr.markForCheck();
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    // A payload may have arrived before the view did; render now if so.
    if (this.payload) {
      void this.renderMap(this.payload);
    }
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
    this.clockSub?.unsubscribe();
    this.map?.remove();
  }

  // ── Polling ───────────────────────────────────────────────────────────────

  private startPolling(): void {
    this.pollSub = timer(0, POLL_INTERVAL_MS)
      .pipe(switchMap(() => this.trackService.fetch(this.token)))
      .subscribe({
        next: (payload) => this.onPayload(payload),
        error: (reason: PublicTrackErrorReason) => this.fail(reason)
      });
  }

  private onPayload(payload: PublicTrackPayload): void {
    this.payload = payload;
    this.state = 'ready';
    this.errorReason = null;
    this.now = Date.now();
    this.recomputeLastUpdated();
    this.cdr.markForCheck();
    if (this.viewReady) {
      void this.renderMap(payload);
    }
  }

  private fail(reason: PublicTrackErrorReason): void {
    // A transient network error shouldn't blow away a page that's already
    // showing good data — keep the last payload and let the next poll recover.
    if (reason === 'error' && this.payload) {
      return;
    }
    this.state = 'error';
    this.errorReason = reason;
    this.cdr.markForCheck();
  }

  /** Manual retry from the error state. */
  retry(): void {
    this.pollSub?.unsubscribe();
    this.state = 'loading';
    this.errorReason = null;
    this.cdr.markForCheck();
    this.startPolling();
  }

  // ── Derived view helpers (kept pure for OnPush + template clarity) ─────────

  private recomputeLastUpdated(): void {
    this.lastUpdatedLabel = this.payload
      ? PublicTrackComponent.relativeTime(this.payload.lastUpdatedAt, this.now)
      : '';
  }

  /** "Last updated just now / N min ago / N hr ago". */
  static relativeTime(iso: string, now: number): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diffMs = Math.max(0, now - then);
    const min = Math.floor(diffMs / 60_000);
    if (min < 1) return 'Updated just now';
    if (min === 1) return 'Updated 1 min ago';
    if (min < 60) return `Updated ${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr === 1) return 'Updated 1 hr ago';
    if (hr < 24) return `Updated ${hr} hr ago`;
    const days = Math.floor(hr / 24);
    return days === 1 ? 'Updated 1 day ago' : `Updated ${days} days ago`;
  }

  /** Modifier class for the status pill colour. */
  get statusModifier(): string {
    return this.payload ? `is-${this.payload.status}` : '';
  }

  /** SR-friendly description of the truck's progress for the live region. */
  get statusAnnouncement(): string {
    if (!this.payload) return '';
    const eta = this.payload.eta
      ? `, ETA ${new Date(this.payload.eta).toLocaleString()}`
      : '';
    return `${this.payload.statusLabel}${eta}. ${this.lastUpdatedLabel}.`;
  }

  trackMilestone(_: number, m: PublicTrackMilestone): string {
    return m.key;
  }

  // ── Map rendering (Leaflet, lazily imported) ───────────────────────────────

  private async renderMap(payload: PublicTrackPayload): Promise<void> {
    const host = this.mapEl?.nativeElement;
    if (!host) return;

    const points = this.collectPoints(payload);
    if (points.length === 0) {
      return; // Nothing to plot yet — the map placeholder stays visible.
    }

    // Run map work outside Angular: Leaflet's own listeners shouldn't trigger
    // change detection on every pan/zoom.
    await this.zone.runOutsideAngular(async () => {
      if (!this.L) {
        this.L = await import('leaflet');
      }
      const L = this.L;

      if (!this.map) {
        this.map = L.map(host, {
          zoomControl: true,
          attributionControl: true,
          // Keyboard a11y: arrows pan, +/- zoom.
          keyboard: true
        });
        this.map.attributionControl.setPrefix(false);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 18
        }).addTo(this.map);
        this.layers = L.layerGroup().addTo(this.map);
      }

      this.layers!.clearLayers();
      const L2 = L;
      const group = this.layers!;

      // Planned route line (reveal-gated).
      if (payload.reveal.routeLine && payload.routeLine?.length) {
        L2.polyline(payload.routeLine as Leaflet.LatLngExpression[], {
          color: '#67e8f9',
          weight: 4,
          opacity: 0.85
        }).addTo(group);
      }

      // Historical breadcrumb trail (reveal-gated).
      if (payload.reveal.breadcrumbs && payload.breadcrumbs?.length) {
        for (const b of payload.breadcrumbs) {
          L2.circleMarker([b.lat, b.lon], {
            radius: 3,
            color: '#38bdf8',
            opacity: 0.5,
            fillOpacity: 0.5
          })
            .bindTooltip('Past location', { direction: 'top' })
            .addTo(group);
        }
      }

      // Origin / destination pins.
      if (this.hasCoord(payload.origin)) {
        this.addPin(L2, group, payload.origin as GeoPoint, 'trip_origin', `Pickup: ${payload.origin.label}`);
      }
      if (this.hasCoord(payload.destination)) {
        this.addPin(L2, group, payload.destination as GeoPoint, 'place', `Delivery: ${payload.destination.label}`);
      }

      // Current truck position — the focal marker.
      if (payload.currentPosition) {
        this.addPin(L2, group, payload.currentPosition, 'local_shipping', 'Current truck location', true);
      }

      const bounds = L2.latLngBounds(points.map((p) => [p.lat, p.lon]));
      this.map!.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
      // Container is sized by flex/vh; recalc once layout settles.
      setTimeout(() => this.map?.invalidateSize(), 0);
    });
  }

  private addPin(
    L: typeof Leaflet,
    group: Leaflet.LayerGroup,
    p: GeoPoint,
    icon: string,
    label: string,
    isTruck = false
  ): void {
    const marker = L.marker([p.lat, p.lon], {
      keyboard: true,
      title: label,
      alt: label,
      icon: L.divIcon({
        className: `pt-marker${isTruck ? ' pt-marker--truck' : ''}`,
        html: `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      })
    });
    marker.bindTooltip(label, { direction: 'top' });
    marker.addTo(group);
  }

  private collectPoints(payload: PublicTrackPayload): GeoPoint[] {
    const pts: GeoPoint[] = [];
    if (payload.currentPosition) pts.push(payload.currentPosition);
    if (this.hasCoord(payload.origin)) pts.push(payload.origin as GeoPoint);
    if (this.hasCoord(payload.destination)) pts.push(payload.destination as GeoPoint);
    if (payload.reveal.routeLine && payload.routeLine?.length) {
      for (const [lat, lon] of payload.routeLine) pts.push({ lat, lon });
    }
    return pts;
  }

  private hasCoord(p: { lat?: number; lon?: number }): boolean {
    return typeof p?.lat === 'number' && typeof p?.lon === 'number';
  }
}

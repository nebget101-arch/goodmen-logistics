import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  IncidentTimelineEvent,
  RealtimeService,
} from '../../../services/realtime.service';

export const VENDOR_ETA_EVENT_TYPE = 'vendor_eta_confirmed';

@Component({
  selector: 'app-status-timeline',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './status-timeline.component.html',
  styleUrls: ['./status-timeline.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusTimelineComponent implements OnInit, OnChanges, OnDestroy {
  /** Incident whose live updates this component subscribes to. */
  @Input() incidentId = '';

  /** Initial events from the HTTP fetch (optimistic load). */
  @Input() events: IncidentTimelineEvent[] = [];

  protected displayEvents: IncidentTimelineEvent[] = [];
  protected hasVendorEta = false;

  private readonly seenIds = new Set<string>();
  private readonly destroy$ = new Subject<void>();

  constructor(
    private realtime: RealtimeService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.seedFromInput();
    this.subscribeToLiveUpdates();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['events'] && !changes['events'].firstChange) {
      this.seedFromInput();
    }
    if (changes['incidentId'] && !changes['incidentId'].firstChange) {
      this.destroy$.next();
      this.seenIds.clear();
      this.displayEvents = [];
      this.hasVendorEta = false;
      this.seedFromInput();
      this.subscribeToLiveUpdates();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  trackById(_index: number, event: IncidentTimelineEvent): string {
    return event.id;
  }

  protected labelFor(eventType: string): string {
    const map: Record<string, string> = {
      created: 'Incident created',
      status_changed: 'Status updated',
      triage_applied: 'Triaged',
      dispatch_assigned: 'Vendor dispatched',
      vendor_en_route: 'Vendor en route',
      vendor_arrived: 'Vendor arrived',
      vendor_eta_confirmed: 'Vendor ETA confirmed',
      resolved: 'Resolved',
      note_added: 'Note added',
      photo_uploaded: 'Photo uploaded',
      feedback_submitted: 'Feedback submitted',
    };
    return (
      map[eventType] ||
      eventType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    );
  }

  protected iconFor(eventType: string): string {
    const map: Record<string, string> = {
      created: 'add_circle',
      status_changed: 'sync',
      triage_applied: 'fact_check',
      dispatch_assigned: 'local_shipping',
      vendor_en_route: 'directions_car',
      vendor_arrived: 'place',
      vendor_eta_confirmed: 'schedule',
      resolved: 'check_circle',
      note_added: 'edit_note',
      photo_uploaded: 'photo_camera',
      feedback_submitted: 'star',
    };
    return map[eventType] || 'radio_button_checked';
  }

  protected metaSummary(event: IncidentTimelineEvent): string | null {
    const m = event.meta;
    if (!m) return null;
    if (event.event_type === 'status_changed') {
      const from = m['from_status'] as string | undefined;
      const to = m['to_status'] as string | undefined;
      if (from && to) return `${this.formatStatus(from)} → ${this.formatStatus(to)}`;
    }
    if (event.event_type === 'dispatch_assigned') {
      const vendor = m['vendor_name'] as string | undefined;
      const eta = m['eta_minutes'] as number | undefined;
      const parts = [vendor, eta != null ? `ETA ${eta} min` : null].filter(Boolean);
      return parts.join(' · ') || null;
    }
    if (event.event_type === 'vendor_eta_confirmed') {
      const eta = m['eta_minutes'] as number | undefined;
      return eta != null ? `ETA ${eta} min` : null;
    }
    return null;
  }

  private seedFromInput(): void {
    for (const e of this.events) {
      if (!this.seenIds.has(e.id)) {
        this.seenIds.add(e.id);
        this.displayEvents.push(e);
        if (e.event_type === VENDOR_ETA_EVENT_TYPE) this.hasVendorEta = true;
      }
    }
    this.displayEvents = this.sortedByTime(this.displayEvents);
    this.cdr.markForCheck();
  }

  private subscribeToLiveUpdates(): void {
    if (!this.incidentId) return;

    this.realtime
      .incidentTimeline$(this.incidentId)
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => {
        if (this.seenIds.has(event.id)) return;
        this.seenIds.add(event.id);
        this.displayEvents = this.sortedByTime([...this.displayEvents, event]);
        if (event.event_type === VENDOR_ETA_EVENT_TYPE) this.hasVendorEta = true;
        this.cdr.markForCheck();
      });
  }

  private sortedByTime(events: IncidentTimelineEvent[]): IncidentTimelineEvent[] {
    return [...events].sort(
      (a, b) =>
        new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
    );
  }

  private formatStatus(s: string): string {
    return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject, merge } from 'rxjs';
import { filter, map, takeUntil } from 'rxjs/operators';
import { WebsocketService } from './websocket.service';

export interface IncidentTimelineEvent {
  id: string;
  incident_id: string;
  event_type: string;
  actor?: string | null;
  meta?: Record<string, unknown> | null;
  occurred_at: string;
}

/** Incident-specific WS event names broadcast by the FleetNeuron gateway. */
export const INCIDENT_WS_EVENTS = {
  STATUS_CHANGED: 'incident:status_changed',
  TIMELINE_EVENT: 'incident:timeline_event',
} as const;

/**
 * FN-1244: Incident-channel facade over WebsocketService.
 *
 * Filters the gateway's tenant-scoped broadcast stream down to events for a
 * specific incident so components don't couple directly to raw WS event names.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService implements OnDestroy {
  private readonly destroy$ = new Subject<void>();

  constructor(private ws: WebsocketService) {}

  /**
   * Returns a merged stream of `status_changed` and `timeline_event` payloads
   * for the given incident, deduplicated by `id`. Completes when the service
   * is destroyed.
   */
  incidentTimeline$(incidentId: string): Observable<IncidentTimelineEvent> {
    const statusChanged$ = this.ws
      .on<IncidentTimelineEvent>(INCIDENT_WS_EVENTS.STATUS_CHANGED)
      .pipe(filter((e) => e?.incident_id === incidentId));

    const timelineEvent$ = this.ws
      .on<IncidentTimelineEvent>(INCIDENT_WS_EVENTS.TIMELINE_EVENT)
      .pipe(filter((e) => e?.incident_id === incidentId));

    return merge(statusChanged$, timelineEvent$).pipe(
      takeUntil(this.destroy$),
      map((e) => e as IncidentTimelineEvent),
    );
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

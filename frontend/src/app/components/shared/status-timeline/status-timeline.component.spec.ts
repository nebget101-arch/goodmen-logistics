/// <reference types="jasmine" />

import {
  ComponentFixture,
  fakeAsync,
  TestBed,
  tick,
} from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { StatusTimelineComponent, VENDOR_ETA_EVENT_TYPE } from './status-timeline.component';
import { RealtimeService, IncidentTimelineEvent } from '../../../services/realtime.service';

function makeEvent(
  overrides: Partial<IncidentTimelineEvent> = {},
): IncidentTimelineEvent {
  return {
    id: 'evt-1',
    incident_id: 'inc-1',
    event_type: 'status_changed',
    occurred_at: '2025-01-01T10:00:00Z',
    ...overrides,
  };
}

describe('StatusTimelineComponent', () => {
  let fixture: ComponentFixture<StatusTimelineComponent>;
  let component: StatusTimelineComponent;
  let liveEvents$: Subject<IncidentTimelineEvent>;

  beforeEach(async () => {
    liveEvents$ = new Subject<IncidentTimelineEvent>();
    const realtimeSpy = jasmine.createSpyObj<RealtimeService>('RealtimeService', [
      'incidentTimeline$',
    ]);
    realtimeSpy.incidentTimeline$.and.returnValue(liveEvents$.asObservable());

    await TestBed.configureTestingModule({
      imports: [CommonModule, StatusTimelineComponent],
      providers: [{ provide: RealtimeService, useValue: realtimeSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(StatusTimelineComponent);
    component = fixture.componentInstance;
  });

  it('renders nothing in the list when no events provided', () => {
    component.incidentId = 'inc-1';
    component.events = [];
    fixture.detectChanges();
    const entries = fixture.nativeElement.querySelectorAll('.status-timeline__entry:not(.status-timeline__entry--placeholder)');
    expect(entries.length).toBe(0);
  });

  it('renders initial events from the @Input', () => {
    component.incidentId = 'inc-1';
    component.events = [
      makeEvent({ id: 'e1', event_type: 'created', occurred_at: '2025-01-01T09:00:00Z' }),
      makeEvent({ id: 'e2', event_type: 'triage_applied', occurred_at: '2025-01-01T10:00:00Z' }),
    ];
    fixture.detectChanges();
    const entries = fixture.nativeElement.querySelectorAll(
      '.status-timeline__entry:not(.status-timeline__entry--placeholder)',
    );
    expect(entries.length).toBe(2);
  });

  it('displays events in chronological order', () => {
    component.incidentId = 'inc-1';
    component.events = [
      makeEvent({ id: 'e2', event_type: 'triage_applied', occurred_at: '2025-01-01T10:00:00Z' }),
      makeEvent({ id: 'e1', event_type: 'created', occurred_at: '2025-01-01T09:00:00Z' }),
    ];
    fixture.detectChanges();
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.status-timeline__label:not(.status-timeline__label--pending)'),
    ).map((el: any) => el.textContent.trim());
    expect(labels[0]).toBe('Incident created');
    expect(labels[1]).toBe('Triaged');
  });

  it('shows the vendor-ETA placeholder when no vendor_eta_confirmed event exists', () => {
    component.incidentId = 'inc-1';
    component.events = [makeEvent()];
    fixture.detectChanges();
    const placeholder = fixture.nativeElement.querySelector('.status-timeline__entry--placeholder');
    expect(placeholder).toBeTruthy();
  });

  it('hides the vendor-ETA placeholder when vendor_eta_confirmed event is present', () => {
    component.incidentId = 'inc-1';
    component.events = [makeEvent({ id: 'e1', event_type: VENDOR_ETA_EVENT_TYPE })];
    fixture.detectChanges();
    const placeholder = fixture.nativeElement.querySelector('.status-timeline__entry--placeholder');
    expect(placeholder).toBeNull();
  });

  it('appends live events from RealtimeService without duplicates', fakeAsync(() => {
    component.incidentId = 'inc-1';
    component.events = [makeEvent({ id: 'e1', event_type: 'created', occurred_at: '2025-01-01T09:00:00Z' })];
    fixture.detectChanges();

    const liveEvt = makeEvent({ id: 'e2', event_type: 'triage_applied', occurred_at: '2025-01-01T10:00:00Z' });
    liveEvents$.next(liveEvt);
    tick();
    fixture.detectChanges();

    const entries = fixture.nativeElement.querySelectorAll(
      '.status-timeline__entry:not(.status-timeline__entry--placeholder)',
    );
    expect(entries.length).toBe(2);
  }));

  it('does not add duplicate events received via WS', fakeAsync(() => {
    component.incidentId = 'inc-1';
    const evt = makeEvent({ id: 'e1', event_type: 'created', occurred_at: '2025-01-01T09:00:00Z' });
    component.events = [evt];
    fixture.detectChanges();

    // emit same id via WS
    liveEvents$.next(evt);
    tick();
    fixture.detectChanges();

    const entries = fixture.nativeElement.querySelectorAll(
      '.status-timeline__entry:not(.status-timeline__entry--placeholder)',
    );
    expect(entries.length).toBe(1);
  }));

  it('hides vendor-ETA placeholder when live event of that type arrives', fakeAsync(() => {
    component.incidentId = 'inc-1';
    component.events = [];
    fixture.detectChanges();

    liveEvents$.next(makeEvent({ id: 'e1', event_type: VENDOR_ETA_EVENT_TYPE, occurred_at: '2025-01-01T11:00:00Z' }));
    tick();
    fixture.detectChanges();

    const placeholder = fixture.nativeElement.querySelector('.status-timeline__entry--placeholder');
    expect(placeholder).toBeNull();
  }));

  it('shows empty-state message when events array is empty', () => {
    component.incidentId = 'inc-1';
    component.events = [];
    fixture.detectChanges();
    const empty = fixture.nativeElement.querySelector('.status-timeline__empty');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No events yet');
  });

  it('renders meta summary for status_changed events', () => {
    component.incidentId = 'inc-1';
    component.events = [
      makeEvent({
        id: 'e1',
        event_type: 'status_changed',
        meta: { from_status: 'NEW', to_status: 'TRIAGED' },
      }),
    ];
    fixture.detectChanges();
    const meta = fixture.nativeElement.querySelector('.status-timeline__meta');
    expect(meta.textContent.trim()).toContain('New → Triaged');
  });
});

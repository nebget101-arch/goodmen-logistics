/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';

import { PublicTrackComponent } from './public-track.component';
import { PublicTrackService } from './public-track.service';
import { PublicTrackPayload, PublicTrackReveal } from './public-track.models';

function makePayload(over: Partial<PublicTrackPayload> = {}): PublicTrackPayload {
  const reveal: PublicTrackReveal = { driverName: false, vehicleNumber: false, breadcrumbs: false, routeLine: true };
  return {
    loadNumber: 'L-1042',
    status: 'in_transit',
    statusLabel: 'In transit',
    eta: '2026-06-04T18:00:00.000Z',
    lastUpdatedAt: new Date().toISOString(),
    reveal,
    // No coordinates → renderMap() returns before importing Leaflet, keeping
    // these specs free of the map library and headless-browser layout flake.
    currentPosition: null,
    origin: { label: 'Dallas, TX' },
    destination: { label: 'Memphis, TN' },
    milestones: [
      { key: 'pickup', label: 'Picked up', state: 'complete', timestamp: '2026-06-03T08:00:00.000Z' },
      { key: 'in_transit', label: 'In transit', state: 'current', timestamp: '2026-06-03T09:00:00.000Z' },
      { key: 'delivered', label: 'Delivered', state: 'upcoming', timestamp: null }
    ],
    ...over
  };
}

describe('PublicTrackComponent', () => {
  let fixture: ComponentFixture<PublicTrackComponent>;
  let component: PublicTrackComponent;
  let serviceSpy: jasmine.SpyObj<PublicTrackService>;
  let tokenValue: string | null;

  function setup(): void {
    serviceSpy = jasmine.createSpyObj<PublicTrackService>('PublicTrackService', ['fetch']);
    TestBed.configureTestingModule({
      imports: [PublicTrackComponent],
      providers: [
        { provide: PublicTrackService, useValue: serviceSpy },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => tokenValue } } }
        }
      ]
    });
    fixture = TestBed.createComponent(PublicTrackComponent);
    component = fixture.componentInstance;
  }

  beforeEach(() => {
    tokenValue = 'tok-123';
  });

  describe('relativeTime()', () => {
    const base = new Date('2026-06-03T12:00:00.000Z').getTime();
    it('reports "just now" under a minute', () => {
      expect(PublicTrackComponent.relativeTime('2026-06-03T11:59:30.000Z', base)).toBe('Updated just now');
    });
    it('reports minutes', () => {
      expect(PublicTrackComponent.relativeTime('2026-06-03T11:45:00.000Z', base)).toBe('Updated 15 min ago');
    });
    it('reports hours', () => {
      expect(PublicTrackComponent.relativeTime('2026-06-03T10:00:00.000Z', base)).toBe('Updated 2 hr ago');
    });
    it('handles a bad timestamp gracefully', () => {
      expect(PublicTrackComponent.relativeTime('not-a-date', base)).toBe('');
    });
  });

  it('shows not_found when the route has no token', () => {
    tokenValue = null;
    setup();
    component.ngOnInit();
    expect(component.state).toBe('error');
    expect(component.errorReason).toBe('not_found');
    expect(serviceSpy.fetch).not.toHaveBeenCalled();
  });

  it('renders payload on a successful poll', () => {
    setup();
    serviceSpy.fetch.and.returnValue(of(makePayload()));
    component.ngOnInit();
    expect(serviceSpy.fetch).toHaveBeenCalledWith('tok-123');
    expect(component.state).toBe('ready');
    expect(component.payload?.loadNumber).toBe('L-1042');
    expect(component.lastUpdatedLabel).toContain('Updated');
    expect(component.statusModifier).toBe('is-in_transit');
    component.ngOnDestroy();
  });

  it('re-polls every 60s', fakeAsync(() => {
    setup();
    serviceSpy.fetch.and.returnValue(of(makePayload()));
    component.ngOnInit();
    expect(serviceSpy.fetch).toHaveBeenCalledTimes(1);
    tick(60_000);
    expect(serviceSpy.fetch).toHaveBeenCalledTimes(2);
    tick(60_000);
    expect(serviceSpy.fetch).toHaveBeenCalledTimes(3);
    component.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('maps a 410 to the expired state', () => {
    setup();
    serviceSpy.fetch.and.returnValue(throwError(() => 'gone'));
    component.ngOnInit();
    expect(component.state).toBe('error');
    expect(component.errorReason).toBe('gone');
  });

  it('keeps showing good data through a transient network error', () => {
    setup();
    component.ngOnInit(); // token present; nothing fetched yet because we drive manually below
    // Simulate a good payload, then a transient error.
    (component as any).onPayload(makePayload());
    expect(component.state).toBe('ready');
    (component as any).fail('error');
    expect(component.state).toBe('ready'); // stayed up
    component.ngOnDestroy();
  });

  describe('reveal_options gating (DOM)', () => {
    it('shows the driver name only when revealed', () => {
      setup();
      serviceSpy.fetch.and.returnValue(
        of(makePayload({ reveal: { driverName: true, vehicleNumber: false, breadcrumbs: false, routeLine: true }, driverName: 'Jordan P.' }))
      );
      fixture.detectChanges(); // ngOnInit + ngAfterViewInit (renderMap no-ops: no coords)
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Jordan P.');
      component.ngOnDestroy();
    });

    it('hides the driver name when not revealed even if present in payload', () => {
      setup();
      serviceSpy.fetch.and.returnValue(
        of(makePayload({ reveal: { driverName: false, vehicleNumber: false, breadcrumbs: false, routeLine: true }, driverName: 'Jordan P.' }))
      );
      fixture.detectChanges();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('Jordan P.');
      component.ngOnDestroy();
    });

    it('always renders the FleetNeuron AI branding', () => {
      setup();
      serviceSpy.fetch.and.returnValue(of(makePayload()));
      fixture.detectChanges();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('FleetNeuron');
      component.ngOnDestroy();
    });
  });
});

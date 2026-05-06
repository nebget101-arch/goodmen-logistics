import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA, SimpleChange } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';

import { RecommendDriverModalComponent } from './recommend-driver-modal.component';
import {
  LoadsService,
  RecommendDriverCandidate,
  RecommendDriverResponse,
} from '../../../services/loads.service';
import { LoadDetail } from '../../../models/load-dashboard.model';

describe('RecommendDriverModalComponent (FN-1439)', () => {
  let component: RecommendDriverModalComponent;
  let fixture: ComponentFixture<RecommendDriverModalComponent>;
  let loadsService: jasmine.SpyObj<LoadsService>;

  const sampleCandidate = (overrides: Partial<RecommendDriverCandidate> = {}): RecommendDriverCandidate => ({
    driverId: 'd-1',
    name: 'Alice',
    score: 0.92,
    rationale: '85mi away, 6.5h HOS, equipment match',
    hosRemaining: 6.5,
    distanceMiles: 85,
    equipmentMatch: true,
    lastLoadWithCustomer: '2026-04-12',
    ...overrides,
  });

  const sampleDetail = (): LoadDetail => ({
    id: 'L1',
    load_number: 'L-001',
    status: 'DRAFT',
    billing_status: 'PENDING',
    rate: 1500,
    notes: null,
    broker_id: null,
    broker_name: null,
    po_number: null,
    truck_id: null,
    trailer_id: null,
    driver_id: null,
    stops: [],
    attachments: [],
  } as unknown as LoadDetail);

  beforeEach(async () => {
    loadsService = jasmine.createSpyObj<LoadsService>('LoadsService', [
      'recommendDriver',
      'updateLoad',
    ]);

    await TestBed.configureTestingModule({
      declarations: [RecommendDriverModalComponent],
      providers: [{ provide: LoadsService, useValue: loadsService }],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(RecommendDriverModalComponent);
    component = fixture.componentInstance;
  });

  function openWithLoad(loadId = 'L1'): void {
    component.open = true;
    component.loadId = loadId;
    component.loadDetail = sampleDetail();
    component.ngOnChanges({
      open: new SimpleChange(false, true, true),
      loadId: new SimpleChange(null, loadId, true),
    });
  }

  describe('fetching candidates', () => {
    it('calls recommendDriver and populates candidates when opened', () => {
      const response: RecommendDriverResponse = {
        success: true,
        candidates: [sampleCandidate(), sampleCandidate({ driverId: 'd-2', score: 0.81 })],
        reasoning: 'Top 2 within 200mi with positive HOS',
      };
      loadsService.recommendDriver.and.returnValue(of(response));

      openWithLoad();

      expect(loadsService.recommendDriver).toHaveBeenCalledWith('L1');
      expect(component.loading).toBeFalse();
      expect(component.candidates.length).toBe(2);
      expect(component.reasoning).toBe('Top 2 within 200mi with positive HOS');
    });

    it('shows the empty state when AI fails (no hard error)', () => {
      loadsService.recommendDriver.and.returnValue(throwError(() => ({ status: 500 })));

      openWithLoad();

      expect(component.loading).toBeFalse();
      expect(component.candidates).toEqual([]);
      expect(component.errorMessage).toBe('');
    });

    it('resets state when the modal is closed (open=false)', () => {
      loadsService.recommendDriver.and.returnValue(of({ success: true, candidates: [sampleCandidate()] }));
      openWithLoad();
      expect(component.candidates.length).toBe(1);

      component.open = false;
      component.ngOnChanges({ open: new SimpleChange(true, false, false) });

      expect(component.candidates).toEqual([]);
      expect(component.assigningDriverId).toBeNull();
    });
  });

  describe('label helpers', () => {
    it('formats score as a 0–100% string and clamps out-of-range values', () => {
      expect(component.scoreLabel(0.92)).toBe('92%');
      expect(component.scoreLabel(1.4)).toBe('100%');
      expect(component.scoreLabel(-0.1)).toBe('0%');
    });

    it('formats HOS hours with 1 decimal and falls back to em-dash on missing data', () => {
      expect(component.hosLabel(6.5)).toBe('6.5h');
      expect(component.hosLabel(null as any)).toBe('—');
    });

    it('rounds distance miles and falls back to em-dash on missing data', () => {
      expect(component.distanceLabel(85.4)).toBe('85 mi');
      expect(component.distanceLabel(NaN)).toBe('—');
    });
  });

  describe('assigning a candidate', () => {
    it('calls updateLoad with chosen driver + AI rationale fields and emits assigned()', () => {
      loadsService.recommendDriver.and.returnValue(of({ success: true, candidates: [sampleCandidate()] }));
      const refreshed = { ...sampleDetail(), driver_id: 'd-1' } as LoadDetail;
      loadsService.updateLoad.and.returnValue(of({ success: true, data: refreshed }));
      const assignedSpy = jasmine.createSpy('assigned');
      component.assigned.subscribe(assignedSpy);

      openWithLoad();
      component.onAssign(sampleCandidate());

      expect(loadsService.updateLoad).toHaveBeenCalledTimes(1);
      const [calledLoadId, payload] = loadsService.updateLoad.calls.mostRecent().args;
      expect(calledLoadId).toBe('L1');
      expect(payload['driverId']).toBe('d-1');
      expect(payload['assignmentSource']).toBe('ai');
      expect(payload['assignmentRationale']).toBe('85mi away, 6.5h HOS, equipment match');
      expect(payload['assignmentScore']).toBe(0.92);
      expect(assignedSpy).toHaveBeenCalledWith(refreshed);
      expect(component.assigningDriverId).toBeNull();
    });

    it('surfaces backend error messages and clears the assigning spinner', () => {
      loadsService.recommendDriver.and.returnValue(of({ success: true, candidates: [sampleCandidate()] }));
      loadsService.updateLoad.and.returnValue(
        throwError(() => ({ error: { error: 'Driver not eligible' } })),
      );

      openWithLoad();
      component.onAssign(sampleCandidate());

      expect(component.errorMessage).toBe('Driver not eligible');
      expect(component.assigningDriverId).toBeNull();
    });

    it('blocks concurrent assigns while one is already in flight', () => {
      loadsService.recommendDriver.and.returnValue(of({ success: true, candidates: [sampleCandidate()] }));
      // Never resolves: simulates an in-flight call.
      loadsService.updateLoad.and.returnValue(new Subject<any>());

      openWithLoad();
      component.onAssign(sampleCandidate());
      expect(component.assigningDriverId).toBe('d-1');

      component.onAssign(sampleCandidate({ driverId: 'd-2' }));
      // Still d-1, second call ignored.
      expect(component.assigningDriverId).toBe('d-1');
      expect(loadsService.updateLoad).toHaveBeenCalledTimes(1);
    });
  });

  describe('close + manual fallback', () => {
    it('emits close() when not assigning', () => {
      const closeSpy = jasmine.createSpy('close');
      component.close.subscribe(closeSpy);
      component.onClose();
      expect(closeSpy).toHaveBeenCalled();
    });

    it('does not close while an assignment is in flight', () => {
      component.assigningDriverId = 'd-1';
      const closeSpy = jasmine.createSpy('close');
      component.close.subscribe(closeSpy);
      component.onClose();
      expect(closeSpy).not.toHaveBeenCalled();
    });

    it('emits manualAssign() when the empty-state link is clicked', () => {
      const manualSpy = jasmine.createSpy('manualAssign');
      component.manualAssign.subscribe(manualSpy);
      component.onManualAssign();
      expect(manualSpy).toHaveBeenCalled();
    });
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';

import { LoadDetailDrawerComponent } from './load-detail-drawer.component';
import { LoadsService } from '../../../services/loads.service';
import { UserPreferencesService } from '../../../services/user-preferences.service';
import { LoadDetail } from '../../../models/load-dashboard.model';

describe('LoadDetailDrawerComponent — Trip Metrics wiring (FN-1054)', () => {
  let component: LoadDetailDrawerComponent;
  let fixture: ComponentFixture<LoadDetailDrawerComponent>;

  const loadsServiceStub = {
    getLoad: jasmine.createSpy('getLoad').and.returnValue(of({ data: null })),
  };
  const userPrefsStub = {};

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [LoadDetailDrawerComponent],
      providers: [
        { provide: LoadsService, useValue: loadsServiceStub },
        { provide: UserPreferencesService, useValue: userPrefsStub },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadDetailDrawerComponent);
    component = fixture.componentInstance;
  });

  function makeDetail(overrides: Partial<LoadDetail> = {}): LoadDetail {
    return {
      id: 'L1',
      load_number: 'L-001',
      status: 'DRAFT',
      billing_status: 'PENDING',
      stops: [],
      attachments: [],
      ...overrides,
    } as LoadDetail;
  }

  describe('populateFromDetail()', () => {
    it('populates totalMiles/emptyMiles/loadedMiles from numeric values', () => {
      (component as any).populateFromDetail(
        makeDetail({ total_miles: 500, empty_miles: 50, loaded_miles: 450 }),
      );

      expect(component.totalMiles).toBe(500);
      expect(component.emptyMiles).toBe(50);
      expect(component.loadedMiles).toBe(450);
    });

    it('coerces stringified numerics (Postgres NUMERIC → string)', () => {
      (component as any).populateFromDetail(
        makeDetail({
          total_miles: '500.5' as any,
          empty_miles: '50' as any,
          loaded_miles: '450.5' as any,
        }),
      );

      expect(component.totalMiles).toBe(500.5);
      expect(component.emptyMiles).toBe(50);
      expect(component.loadedMiles).toBe(450.5);
    });

    it('returns null for missing/invalid metrics (no NaN leaks)', () => {
      (component as any).populateFromDetail(
        makeDetail({
          total_miles: null,
          empty_miles: undefined,
          loaded_miles: 'not-a-number' as any,
        }),
      );

      expect(component.totalMiles).toBeNull();
      expect(component.emptyMiles).toBeNull();
      expect(component.loadedMiles).toBeNull();
    });

    it('resets metrics to null when called with null detail', () => {
      component.totalMiles = 100;
      component.emptyMiles = 10;
      component.loadedMiles = 90;

      (component as any).populateFromDetail(null);

      expect(component.totalMiles).toBeNull();
      expect(component.emptyMiles).toBeNull();
      expect(component.loadedMiles).toBeNull();
    });

    it('treats empty-string metrics as null', () => {
      (component as any).populateFromDetail(
        makeDetail({
          total_miles: '' as any,
          empty_miles: '' as any,
          loaded_miles: '' as any,
        }),
      );

      expect(component.totalMiles).toBeNull();
      expect(component.emptyMiles).toBeNull();
      expect(component.loadedMiles).toBeNull();
    });
  });
});

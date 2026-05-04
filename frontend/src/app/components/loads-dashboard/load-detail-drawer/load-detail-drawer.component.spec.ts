import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';

import { LoadDetailDrawerComponent } from './load-detail-drawer.component';
import { LoadsService } from '../../../services/loads.service';
import { UserPreferencesService } from '../../../services/user-preferences.service';
import { LoadAttachment, LoadDetail } from '../../../models/load-dashboard.model';

describe('LoadDetailDrawerComponent — Trip Metrics wiring (FN-1054)', () => {
  let component: LoadDetailDrawerComponent;
  let fixture: ComponentFixture<LoadDetailDrawerComponent>;

  const loadsServiceStub = {
    getLoad: jasmine.createSpy('getLoad').and.returnValue(of({ data: null })),
    deleteAttachment: jasmine.createSpy('deleteAttachment').and.returnValue(of({ success: true })),
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

  // FN-1071 — Saved attachments rendering + delete
  describe('saved attachments (FN-1071)', () => {
    function makeAttachment(id: string, overrides: Partial<LoadAttachment> = {}): LoadAttachment {
      return {
        id,
        load_id: 'L1',
        type: 'BOL',
        file_name: `file-${id}.pdf`,
        file_url: `https://example.test/${id}.pdf`,
        mime_type: 'application/pdf',
        created_at: '2026-04-14T12:00:00Z',
        ...overrides,
      } as LoadAttachment;
    }

    it('populates savedAttachments from d.attachments instead of dropping the payload', () => {
      const attachments = [makeAttachment('a1'), makeAttachment('a2')];
      (component as any).populateFromDetail(makeDetail({ attachments }));

      expect(component.savedAttachments.length).toBe(2);
      expect(component.savedAttachments[0].id).toBe('a1');
      // Defensive copy — should not be the same array reference
      expect(component.savedAttachments).not.toBe(attachments);
    });

    it('resets savedAttachments to [] when called with null detail', () => {
      component.savedAttachments = [makeAttachment('a1')];
      (component as any).populateFromDetail(null);
      expect(component.savedAttachments).toEqual([]);
    });

    it('handles a load with zero attachments (empty array, no errors)', () => {
      (component as any).populateFromDetail(makeDetail({ attachments: [] }));
      expect(component.savedAttachments).toEqual([]);
    });

    it('optimistically removes the row and calls deleteAttachment on the service', () => {
      component.loadId = 'L1';
      component.loadDetail = makeDetail({ attachments: [makeAttachment('a1'), makeAttachment('a2')] });
      component.savedAttachments = component.loadDetail.attachments.slice();
      loadsServiceStub.deleteAttachment.calls.reset();

      component.onDeleteSavedAttachment('a1');

      expect(loadsServiceStub.deleteAttachment).toHaveBeenCalledWith('L1', 'a1');
      expect(component.savedAttachments.map(a => a.id)).toEqual(['a2']);
      expect(component.loadDetail!.attachments.map(a => a.id)).toEqual(['a2']);
    });

    it('restores the row and surfaces an error when delete fails', () => {
      component.loadId = 'L1';
      const original = [makeAttachment('a1'), makeAttachment('a2')];
      component.loadDetail = makeDetail({ attachments: original });
      component.savedAttachments = original.slice();
      loadsServiceStub.deleteAttachment.and.returnValue(throwError(() => new Error('boom')));

      component.onDeleteSavedAttachment('a1');

      expect(component.savedAttachments.map(a => a.id)).toEqual(['a1', 'a2']);
      expect(component.errorMessage).toContain('Failed to delete');
      // Restore stub for subsequent tests
      loadsServiceStub.deleteAttachment.and.returnValue(of({ success: true }));
    });

    it('no-ops when loadId is null', () => {
      component.loadId = null;
      component.savedAttachments = [makeAttachment('a1')];
      loadsServiceStub.deleteAttachment.calls.reset();

      component.onDeleteSavedAttachment('a1');

      expect(loadsServiceStub.deleteAttachment).not.toHaveBeenCalled();
      expect(component.savedAttachments.length).toBe(1);
    });
  });
});

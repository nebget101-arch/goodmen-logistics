/// <reference types="jasmine" />

import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { FmcsaImportsAdminComponent } from './fmcsa-imports.component';
import {
  FmcsaImportRun,
  FmcsaImportsService,
} from '../../../services/fmcsa-imports.service';

const buildRun = (overrides: Partial<FmcsaImportRun> = {}): FmcsaImportRun => ({
  id: 'r-1',
  file: 'census',
  triggered_by: 'manual',
  started_at: '2026-05-06T10:00:00Z',
  finished_at: '2026-05-06T10:01:30Z',
  status: 'success',
  rows_inserted: 100,
  rows_updated: 5,
  rows_skipped: 0,
  error_message: null,
  dry_run: false,
  ...overrides,
});

describe('FmcsaImportsAdminComponent', () => {
  let component: FmcsaImportsAdminComponent;
  let fixture: ComponentFixture<FmcsaImportsAdminComponent>;
  let serviceSpy: jasmine.SpyObj<FmcsaImportsService>;
  let progressSubject: BehaviorSubject<number>;

  beforeEach(() => {
    progressSubject = new BehaviorSubject<number>(0);
    serviceSpy = jasmine.createSpyObj<FmcsaImportsService>(
      'FmcsaImportsService',
      ['list', 'run', 'runUpload'],
      { uploadProgress$: progressSubject.asObservable() },
    );
    serviceSpy.list.and.returnValue(of({ success: true, data: [] }));
    serviceSpy.run.and.returnValue(of({ success: true, data: { runIds: ['r-1'] } }));
    serviceSpy.runUpload.and.returnValue(
      of({ runId: 'up-1', file: 'census.csv', uploadedSizeBytes: 100 }),
    );

    TestBed.configureTestingModule({
      declarations: [FmcsaImportsAdminComponent],
      imports: [FormsModule],
      providers: [{ provide: FmcsaImportsService, useValue: serviceSpy }],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    });

    fixture = TestBed.createComponent(FmcsaImportsAdminComponent);
    component = fixture.componentInstance;
  });

  it('loads ledger on init', () => {
    fixture.detectChanges();
    expect(serviceSpy.list).toHaveBeenCalled();
    expect(component.runs).toEqual([]);
    expect(component.historyLoaded).toBeTrue();
  });

  it('disables Run button until at least one file is selected', () => {
    fixture.detectChanges();
    expect(component.hasSelection()).toBeFalse();
    component.toggle('census');
    expect(component.hasSelection()).toBeTrue();
    expect(component.selectedFiles()).toEqual(['census']);
  });

  it('opens confirmation modal only when something is selected', () => {
    fixture.detectChanges();
    component.openConfirm();
    expect(component.confirmOpen).toBeFalse();
    component.toggle('inspections');
    component.openConfirm();
    expect(component.confirmOpen).toBeTrue();
  });

  it('submits selected files and clears selection on success', () => {
    fixture.detectChanges();
    component.toggle('census');
    component.toggle('sms');
    component.dryRun = true;
    component.submit();
    expect(serviceSpy.run).toHaveBeenCalledWith({ files: ['census', 'sms'], dryRun: true });
    expect(component.message).toContain('dry-run');
    expect(component.confirmOpen).toBeFalse();
    expect(component.hasSelection()).toBeFalse();
  });

  it('surfaces backend error message on failed submit', () => {
    fixture.detectChanges();
    serviceSpy.run.and.returnValue(throwError(() => ({ error: { error: 'Forbidden' } })));
    component.toggle('crashes');
    component.submit();
    expect(component.error).toBe('Forbidden');
    expect(component.submitting).toBeFalse();
  });

  it('detects active runs and schedules a refresh while any are queued/running', fakeAsync(() => {
    const runningRun = buildRun({ status: 'running', finished_at: null });
    serviceSpy.list.and.returnValue(of({ success: true, data: [runningRun] }));

    fixture.detectChanges();
    expect(component.hasActiveRun()).toBeTrue();
    expect(serviceSpy.list).toHaveBeenCalledTimes(1);

    serviceSpy.list.and.returnValue(of({ success: true, data: [buildRun({ status: 'success' })] }));
    tick(5000);
    expect(serviceSpy.list).toHaveBeenCalledTimes(2);
    expect(component.hasActiveRun()).toBeFalse();

    // No further polling once everything has completed.
    tick(5000);
    expect(serviceSpy.list).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  }));

  it('formats row delta only for terminal statuses', () => {
    expect(component.formatRowDelta(buildRun({ status: 'queued' }))).toBe('—');
    expect(component.formatRowDelta(buildRun({ status: 'running' }))).toBe('—');
    const success = component.formatRowDelta(
      buildRun({ status: 'success', rows_inserted: 12, rows_updated: 3, rows_skipped: 1 })
    );
    expect(success).toContain('+12');
    expect(success).toContain('~3');
    expect(success).toContain('↷1');
  });

  it('exposes friendly status and trigger labels', () => {
    expect(component.statusLabel('queued')).toBe('Queued');
    expect(component.statusLabel('running')).toBe('Running');
    expect(component.statusLabel('success')).toBe('Success');
    expect(component.statusLabel('error')).toBe('Error');
    expect(component.triggerLabel('cron')).toBe('Cron');
    expect(component.triggerLabel('manual')).toBe('Manual');
  });

  // ─── Upload modal (FN-1458) ────────────────────────────────────────────

  describe('upload modal', () => {
    const makeFile = (name = 'census.csv', size = 100): File => {
      const blob = new Blob(['x'.repeat(size)], { type: 'text/csv' });
      return new File([blob], name, { type: 'text/csv' });
    };

    it('opens with the row prefill when launched from a row', () => {
      fixture.detectChanges();
      component.openUpload('inspections');
      expect(component.uploadOpen).toBeTrue();
      expect(component.uploadFileType).toBe('inspections');
      expect(component.uploadFile).toBeNull();
      expect(component.uploadDryRun).toBeFalse();
    });

    it('opens with no prefill when launched from the header', () => {
      fixture.detectChanges();
      component.openUpload();
      expect(component.uploadOpen).toBeTrue();
      expect(component.uploadFileType).toBe('');
    });

    it('disables submit until both file and fileType are set', () => {
      fixture.detectChanges();
      component.openUpload();
      expect(component.uploadSubmitDisabled()).toBeTrue();

      component.uploadFile = makeFile();
      expect(component.uploadSubmitDisabled()).toBeTrue();

      component.uploadFileType = 'census';
      expect(component.uploadSubmitDisabled()).toBeFalse();
    });

    it('closes the modal on close when no upload is in flight', () => {
      fixture.detectChanges();
      component.openUpload();
      component.closeUpload();
      expect(component.uploadOpen).toBeFalse();
    });

    it('ignores closeUpload while an upload is in flight', () => {
      fixture.detectChanges();
      component.openUpload();
      component.uploadInFlight = true;
      component.closeUpload();
      expect(component.uploadOpen).toBeTrue();
    });

    it('submits via runUpload, refreshes the ledger, and closes on success', () => {
      fixture.detectChanges();
      const file = makeFile('authority.csv', 50);
      component.openUpload('authority');
      component.uploadFile = file;
      component.uploadDryRun = true;
      serviceSpy.list.calls.reset();

      component.submitUpload();

      expect(serviceSpy.runUpload).toHaveBeenCalledWith(file, 'authority', true);
      expect(component.uploadOpen).toBeFalse();
      expect(component.uploadInFlight).toBeFalse();
      expect(component.message).toContain('authority.csv');
      // ledger refreshed
      expect(serviceSpy.list).toHaveBeenCalled();
    });

    it('shows the API error message on 413 and keeps the modal open', () => {
      fixture.detectChanges();
      serviceSpy.runUpload.and.returnValue(
        throwError(() => ({ status: 413, error: { error: 'Upload exceeds 1 GB limit' } })),
      );
      const file = makeFile();
      component.openUpload();
      component.uploadFile = file;
      component.uploadFileType = 'sms';
      component.submitUpload();

      expect(component.uploadOpen).toBeTrue();
      expect(component.uploadInFlight).toBeFalse();
      expect(component.uploadError).toBe('Upload exceeds 1 GB limit');
    });

    it('shows a fallback message on 413 when API does not return a body', () => {
      fixture.detectChanges();
      serviceSpy.runUpload.and.returnValue(throwError(() => ({ status: 413 })));
      const file = makeFile();
      component.openUpload();
      component.uploadFile = file;
      component.uploadFileType = 'sms';
      component.submitUpload();

      expect(component.uploadError).toContain('1 GB');
      expect(component.uploadOpen).toBeTrue();
    });

    it('mirrors uploadProgress$ values into uploadProgress', () => {
      fixture.detectChanges();
      progressSubject.next(42);
      expect(component.uploadProgress).toBe(42);
    });

    it('escape closes the upload modal when not in flight', () => {
      fixture.detectChanges();
      component.openUpload();
      component.onEscape();
      expect(component.uploadOpen).toBeFalse();
    });

    it('escape is a no-op while upload is in flight', () => {
      fixture.detectChanges();
      component.openUpload();
      component.uploadInFlight = true;
      component.onEscape();
      expect(component.uploadOpen).toBeTrue();
    });
  });
});

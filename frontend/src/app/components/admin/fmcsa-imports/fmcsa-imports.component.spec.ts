/// <reference types="jasmine" />

import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';

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

  beforeEach(() => {
    serviceSpy = jasmine.createSpyObj<FmcsaImportsService>('FmcsaImportsService', ['list', 'run']);
    serviceSpy.list.and.returnValue(of({ success: true, data: [] }));
    serviceSpy.run.and.returnValue(of({ success: true, data: { runIds: ['r-1'] } }));

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
});

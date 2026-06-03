/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';

import {
  InvoiceReviewModalComponent,
  ReviewRow
} from './invoice-review-modal.component';
import { ApiService, InvoiceUploadResult } from '../../services/api.service';

function makeResult(overrides: Partial<InvoiceUploadResult['extracted']> = {}): InvoiceUploadResult {
  return {
    fileUrl: 'https://r2/x.pdf',
    extracted: {
      vendor: 'Acme Parts',
      reference: 'PO-42',
      invoiceDate: '2026-05-07',
      lines: [
        {
          sku: 'SKU-A',
          description: 'Brake pad',
          qty: 4,
          unitCost: 12.5,
          match: { partId: 'part-1', sku: 'SKU-A', name: 'Brake pad' }
        },
        {
          sku: 'NEW-SKU',
          description: 'Headlight bulb',
          qty: 2,
          unitCost: 22,
          match: null
        }
      ],
      ...overrides
    }
  };
}

describe('InvoiceReviewModalComponent (FN-1491)', () => {
  let fixture: ComponentFixture<InvoiceReviewModalComponent>;
  let component: InvoiceReviewModalComponent;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['addReceivingLine', 'createPart']);
    api.addReceivingLine.and.returnValue(of({ data: { id: 'line-X' } }));
    api.createPart.and.returnValue(of({ data: { id: 'part-NEW', name: 'Headlight bulb' } }));

    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule],
      declarations: [InvoiceReviewModalComponent],
      providers: [{ provide: ApiService, useValue: api }]
    }).compileComponents();

    fixture = TestBed.createComponent(InvoiceReviewModalComponent);
    component = fixture.componentInstance;
    component.ticketId = 'tkt-1';
  });

  it('renders the extracting spinner with elapsed seconds when extracting=true', fakeAsync(() => {
    component.open = true;
    component.extracting = true;
    component.ngOnChanges({
      open: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true },
      extracting: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true }
    } as any);
    fixture.detectChanges();

    const spinner = fixture.nativeElement.querySelector('.irm__spinner');
    expect(spinner).toBeTruthy();

    tick(2000);
    fixture.detectChanges();
    expect(component.elapsedSec).toBe(2);

    component.extracting = false;
    component.ngOnChanges({
      extracting: { currentValue: false, previousValue: true, firstChange: false, isFirstChange: () => false }
    } as any);
    tick(3000);
    expect(component.elapsedSec).toBe(2);
  }));

  it('hydrates rows from extraction result and computes status counts', () => {
    component.open = true;
    component.extracting = false;
    component.result = makeResult();
    component.ngOnChanges({
      open: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true },
      result: { currentValue: component.result, previousValue: null, firstChange: true, isFirstChange: () => true }
    } as any);
    fixture.detectChanges();

    expect(component.rows.length).toBe(2);
    expect(component.matchedCount).toBe(1);
    expect(component.unmatchedCount).toBe(1);
    expect(component.skippedCount).toBe(0);

    const matchedRow = component.rows[0];
    expect(matchedRow.status).toBe('matched');
    expect(matchedRow.partId).toBe('part-1');

    const unmatchedRow = component.rows[1];
    expect(unmatchedRow.status).toBe('unmatched');
    expect(unmatchedRow.partId).toBeNull();
  });

  it('skipping a row removes it from the apply set without losing other rows', () => {
    component.open = true;
    component.result = makeResult();
    component.ngOnChanges({
      open: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true },
      result: { currentValue: component.result, previousValue: null, firstChange: true, isFirstChange: () => true }
    } as any);

    component.skipRow(component.rows[0]);

    expect(component.rows[0].status).toBe('skipped');
    expect(component.rows[1].status).toBe('unmatched');
    expect(component.matchedCount).toBe(0);
    expect(component.skippedCount).toBe(1);
  });

  it('Quick Add Part calls createPart with the row sku/description and resolves the row to matched', () => {
    component.open = true;
    component.result = makeResult();
    component.ngOnChanges({
      open: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true },
      result: { currentValue: component.result, previousValue: null, firstChange: true, isFirstChange: () => true }
    } as any);

    const unmatched = component.rows[1];
    expect(unmatched.status).toBe('unmatched');

    component.quickAddPart(unmatched);

    expect(api.createPart).toHaveBeenCalledWith(jasmine.objectContaining({
      sku: 'NEW-SKU',
      name: 'Headlight bulb',
      description: 'Headlight bulb'
    }));
    expect(unmatched.partId).toBe('part-NEW');
    expect(unmatched.status).toBe('matched');
    expect(component.matchedCount).toBe(2);
  });

  it('Quick Add Part surfaces backend errors inline without breaking other rows', () => {
    component.open = true;
    component.result = makeResult();
    component.ngOnChanges({
      open: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true },
      result: { currentValue: component.result, previousValue: null, firstChange: true, isFirstChange: () => true }
    } as any);

    api.createPart.and.returnValue(
      throwError(() => ({ error: { error: 'SKU already exists' } }))
    );

    const unmatched = component.rows[1];
    component.quickAddPart(unmatched);

    expect(unmatched.quickAddBusy).toBeFalse();
    expect(unmatched.status).toBe('unmatched');
    expect(unmatched.quickAddError).toBe('SKU already exists');
    // Other row untouched.
    expect(component.rows[0].status).toBe('matched');
  });

  it('Apply N matched lines POSTs once per matched row and emits a summary', () => {
    component.open = true;
    component.result = makeResult();
    component.ngOnChanges({
      open: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true },
      result: { currentValue: component.result, previousValue: null, firstChange: true, isFirstChange: () => true }
    } as any);

    const summarySpy = jasmine.createSpy('applied');
    const closedSpy = jasmine.createSpy('closed');
    component.applied.subscribe(summarySpy);
    component.closed.subscribe(closedSpy);

    component.apply();

    expect(api.addReceivingLine).toHaveBeenCalledTimes(1);
    expect(api.addReceivingLine).toHaveBeenCalledWith('tkt-1', 'part-1', 4, 12.5);
    expect(summarySpy).toHaveBeenCalledWith({ appliedCount: 1, failedCount: 0 });
    // Modal auto-closes when all rows succeed.
    expect(closedSpy).toHaveBeenCalled();
  });

  it('Apply keeps the modal open when some rows fail and surfaces the row error', () => {
    component.open = true;
    component.result = makeResult();
    component.ngOnChanges({
      open: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true },
      result: { currentValue: component.result, previousValue: null, firstChange: true, isFirstChange: () => true }
    } as any);

    api.addReceivingLine.and.returnValue(
      throwError(() => ({ error: { error: 'inventory locked' } }))
    );

    const summarySpy = jasmine.createSpy('applied');
    const closedSpy = jasmine.createSpy('closed');
    component.applied.subscribe(summarySpy);
    component.closed.subscribe(closedSpy);

    component.apply();

    expect(component.applying).toBeFalse();
    expect(component.errorMsg).toContain('failed to apply');
    const matchedRow = component.rows.find((r) => r.partId === 'part-1') as ReviewRow;
    expect(matchedRow.applyError).toBe('inventory locked');
    expect(summarySpy).toHaveBeenCalledWith({ appliedCount: 0, failedCount: 1 });
    expect(closedSpy).not.toHaveBeenCalled();
  });

  it('canApply is false when no matched rows are available', () => {
    component.open = true;
    component.result = makeResult({ lines: [{ sku: 'X', description: 'x', qty: 1, unitCost: 1, match: null }] });
    component.ngOnChanges({
      open: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true },
      result: { currentValue: component.result, previousValue: null, firstChange: true, isFirstChange: () => true }
    } as any);

    expect(component.canApply).toBeFalse();
    component.apply(); // no-op
    expect(api.addReceivingLine).not.toHaveBeenCalled();
  });
});

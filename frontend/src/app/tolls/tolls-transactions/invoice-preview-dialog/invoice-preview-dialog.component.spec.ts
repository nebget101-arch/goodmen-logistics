/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { InvoicePreviewDialogComponent, InvoicePreviewDialogData } from './invoice-preview-dialog.component';
import { TollsService } from '../../tolls.service';
import { ExtractedTollTransaction } from '../../tolls.model';

describe('InvoicePreviewDialogComponent — low-confidence badge (FN-1449)', () => {
  let fixture: ComponentFixture<InvoicePreviewDialogComponent>;

  function buildRow(overrides: Partial<ExtractedTollTransaction> = {}): ExtractedTollTransaction {
    return {
      transaction_date: '2026-04-12',
      provider_name: 'E-ZPass',
      plaza_name: 'NJ Turnpike',
      plate_number: '',
      amount: 4.25,
      ...overrides,
    };
  }

  function build(data: InvoicePreviewDialogData) {
    TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule],
      declarations: [InvoicePreviewDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: () => {} } },
        { provide: TollsService, useValue: { createTransactions: () => of({ success: true, created: 0 }) } },
      ],
    });
    fixture = TestBed.createComponent(InvoicePreviewDialogComponent);
    fixture.detectChanges();
  }

  it('renders a "Verify" badge on rows flagged low_confidence', () => {
    build({
      transactions: [buildRow({ low_confidence: true })],
      warnings: [],
    });
    const badge = fixture.nativeElement.querySelector('.badge-verify') as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.textContent?.trim()).toBe('Verify');
  });

  it('does NOT render a "Verify" badge on confident rows', () => {
    build({
      transactions: [buildRow({ low_confidence: false })],
      warnings: [],
    });
    expect(fixture.nativeElement.querySelector('.badge-verify')).toBeNull();
  });

  it('marks low-confidence rows with the data attribute and class', () => {
    build({
      transactions: [
        buildRow({ low_confidence: true }),
        buildRow({ low_confidence: false }),
      ],
      warnings: [],
    });
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect((rows[0] as HTMLElement).getAttribute('data-low-confidence')).toBe('true');
    expect((rows[0] as HTMLElement).classList.contains('low-confidence')).toBeTrue();
    expect((rows[1] as HTMLElement).getAttribute('data-low-confidence')).toBeNull();
    expect((rows[1] as HTMLElement).classList.contains('low-confidence')).toBeFalse();
  });
});

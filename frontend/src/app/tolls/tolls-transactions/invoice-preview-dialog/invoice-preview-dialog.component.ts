import { Component, Inject, ChangeDetectionStrategy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { TollsService } from '../../tolls.service';
import {
  ExtractedTollTransaction,
  CreateTollTransactionPayload,
} from '../../tolls.model';

export interface InvoicePreviewDialogData {
  transactions: ExtractedTollTransaction[];
  warnings: string[];
}

@Component({
  selector: 'app-invoice-preview-dialog',
  templateUrl: './invoice-preview-dialog.component.html',
  styleUrls: ['./invoice-preview-dialog.component.css'],
  changeDetection: ChangeDetectionStrategy.Default,
})
export class InvoicePreviewDialogComponent {
  rows: ExtractedTollTransaction[];
  warnings: string[];
  saving = false;
  error = '';

  constructor(
    private readonly tollsService: TollsService,
    private readonly dialogRef: MatDialogRef<InvoicePreviewDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: InvoicePreviewDialogData,
  ) {
    this.rows = data.transactions.map(t => ({ ...t }));
    this.warnings = data.warnings || [];
  }

  removeRow(index: number): void {
    this.rows.splice(index, 1);
  }

  async confirmAll(): Promise<void> {
    if (!this.rows.length) return;
    this.saving = true;
    this.error = '';

    const payloads = this.rows.map(r => ({
      transaction_date: r.transaction_date,
      provider_name: r.provider_name,
      plaza_name: r.plaza_name,
      plate_number_raw: (r as any).plate_number_raw || r.plate_number || null,
      amount: r.amount,
      entry_point: r.entry_point,
      exit_point: r.exit_point,
      city: (r as any).city || null,
      state: (r as any).state || null,
      truck_id: (r as any).truck_id || null,
      driver_id: (r as any).driver_id || null,
      matched_status: (r as any).matched_status || 'unmatched',
      notes: (r as any).notes || null,
      source: 'invoice_upload',
    }));

    try {
      await firstValueFrom(this.tollsService.createTransactions(payloads));
      this.dialogRef.close({ saved: true, count: payloads.length });
    } catch (err: unknown) {
      const e = err as { error?: { error?: string }; message?: string };
      this.error = e?.error?.error || e?.message || 'Failed to save transactions.';
    } finally {
      this.saving = false;
    }
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}

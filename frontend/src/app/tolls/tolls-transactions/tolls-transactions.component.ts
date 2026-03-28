import { Component, ViewChild, ElementRef, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { TollsService } from '../tolls.service';
import { InvoicePreviewDialogComponent, InvoicePreviewDialogData } from './invoice-preview-dialog/invoice-preview-dialog.component';

@Component({
  selector: 'app-tolls-transactions',
  templateUrl: './tolls-transactions.component.html',
  styleUrls: ['./tolls-transactions.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TollsTransactionsComponent {
  @ViewChild('invoiceFileInput') invoiceFileInput!: ElementRef<HTMLInputElement>;

  uploading = false;
  uploadError = '';
  successMessage = '';

  /** Accepted file types for the invoice input */
  readonly acceptedTypes = '.jpg,.jpeg,.png,.pdf';

  constructor(
    private readonly tollsService: TollsService,
    private readonly dialog: MatDialog,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  triggerFileInput(): void {
    this.invoiceFileInput.nativeElement.click();
  }

  async onFilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const fileList = input.files;
    if (!fileList || !fileList.length) return;

    const files = Array.from(fileList);
    // Reset so the same file can be re-selected
    input.value = '';

    this.uploading = true;
    this.uploadError = '';
    this.successMessage = '';
    this.cdr.markForCheck();

    try {
      const result = await firstValueFrom(this.tollsService.uploadInvoiceImage(files));

      this.uploading = false;
      this.cdr.markForCheck();

      if (!result.transactions?.length) {
        this.uploadError = 'No transactions could be extracted from the uploaded invoice.';
        this.cdr.markForCheck();
        return;
      }

      const dialogData: InvoicePreviewDialogData = {
        transactions: result.transactions,
        warnings: result.warnings || [],
      };

      const dialogRef = this.dialog.open(InvoicePreviewDialogComponent, {
        width: '960px',
        maxWidth: '96vw',
        maxHeight: '90vh',
        disableClose: false,
        panelClass: 'invoice-preview-panel',
        data: dialogData,
      });

      const dialogResult = await firstValueFrom(dialogRef.afterClosed());
      if (dialogResult?.saved) {
        this.successMessage = `${dialogResult.count} transaction${dialogResult.count === 1 ? '' : 's'} saved successfully.`;
        this.cdr.markForCheck();
        // Auto-clear success message after 5 seconds
        setTimeout(() => {
          this.successMessage = '';
          this.cdr.markForCheck();
        }, 5000);
      }
    } catch (err: unknown) {
      const e = err as { error?: { error?: string }; message?: string };
      this.uploadError = e?.error?.error || e?.message || 'Failed to process invoice. Please try again.';
      this.uploading = false;
      this.cdr.markForCheck();
    }
  }
}

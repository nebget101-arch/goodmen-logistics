import { Component, OnInit, ViewChild, ElementRef, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { TollsService } from '../tolls.service';
import { TollTransaction } from '../tolls.model';
import { ApiService } from '../../services/api.service';
import { InvoicePreviewDialogComponent, InvoicePreviewDialogData } from './invoice-preview-dialog/invoice-preview-dialog.component';

@Component({
  selector: 'app-tolls-transactions',
  templateUrl: './tolls-transactions.component.html',
  styleUrls: ['./tolls-transactions.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TollsTransactionsComponent implements OnInit {
  @ViewChild('invoiceFileInput') invoiceFileInput!: ElementRef<HTMLInputElement>;

  loading = false;
  error = '';
  rows: TollTransaction[] = [];
  total = 0;

  // Filters
  dateFrom = '';
  dateTo = '';
  driverFilter = '';
  truckFilter = '';

  pageSize = 50;
  pageOffset = 0;

  // Manual entry dialog
  showDialog = false;
  saving = false;
  saveError = '';
  saveSuccess = '';

  form: Record<string, any> = {};

  // Autocomplete data
  trucks: any[] = [];
  drivers: any[] = [];

  // Invoice upload
  uploading = false;
  uploadError = '';
  successMessage = '';
  readonly acceptedTypes = '.jpg,.jpeg,.png,.pdf';

  constructor(
    private tolls: TollsService,
    private api: ApiService,
    private readonly dialog: MatDialog,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.load();
    this.loadAutocompleteData();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.tolls.getTransactions({
      limit: this.pageSize,
      offset: this.pageOffset,
      date_from: this.dateFrom || undefined,
      date_to: this.dateTo || undefined,
    }).subscribe({
      next: (res) => { this.rows = res.rows; this.total = res.total; this.loading = false; this.cdr.markForCheck(); },
      error: (err) => { this.error = err.error?.error || 'Failed to load transactions'; this.loading = false; this.cdr.markForCheck(); }
    });
  }

  loadAutocompleteData(): void {
    this.api.getVehicles().subscribe({ next: (v: any) => this.trucks = Array.isArray(v) ? v : (v?.rows || []) });
    this.api.getDrivers().subscribe({ next: (d: any) => this.drivers = Array.isArray(d) ? d : (d?.rows || []) });
  }

  applyFilters(): void { this.pageOffset = 0; this.load(); }
  clearFilters(): void { this.dateFrom = ''; this.dateTo = ''; this.driverFilter = ''; this.truckFilter = ''; this.pageOffset = 0; this.load(); }

  get pageNumber(): number { return Math.floor(this.pageOffset / this.pageSize) + 1; }
  get totalPages(): number { return Math.ceil(this.total / this.pageSize); }
  prevPage(): void { if (this.pageOffset > 0) { this.pageOffset -= this.pageSize; this.load(); } }
  nextPage(): void { if (this.pageOffset + this.pageSize < this.total) { this.pageOffset += this.pageSize; this.load(); } }

  openDialog(): void {
    this.form = {
      transaction_date: new Date().toISOString().slice(0, 10),
      provider_name: '',
      plaza_name: '',
      entry_location: '',
      exit_location: '',
      city: '',
      state: '',
      amount: '',
      truck_id: '',
      driver_id: '',
      notes: '',
    };
    this.saveError = '';
    this.saveSuccess = '';
    this.showDialog = true;
  }

  closeDialog(): void { this.showDialog = false; }

  saveTransaction(): void {
    if (!this.form['transaction_date'] || !this.form['provider_name'] || !this.form['amount']) {
      this.saveError = 'Date, Provider, and Amount are required';
      return;
    }
    this.saving = true;
    this.saveError = '';
    this.saveSuccess = '';

    const payload: any = { ...this.form };
    payload.amount = parseFloat(payload.amount);
    if (!payload.truck_id) delete payload.truck_id;
    if (!payload.driver_id) delete payload.driver_id;

    this.tolls.createTransaction(payload).subscribe({
      next: () => {
        this.saving = false;
        this.saveSuccess = 'Toll transaction created successfully';
        this.showDialog = false;
        this.load();
      },
      error: (err) => {
        this.saving = false;
        this.saveError = err.error?.error || 'Failed to create transaction';
      }
    });
  }

  matchClass(status: string): string {
    if (status === 'matched') return 'pill-green';
    if (status === 'partial') return 'pill-yellow';
    return 'pill-red';
  }

  fmtCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0);
  }

  // ─── Invoice Upload ────────────────────────────────────────────────────────
  triggerFileInput(): void {
    this.invoiceFileInput.nativeElement.click();
  }

  async onFilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const fileList = input.files;
    if (!fileList || !fileList.length) return;

    const files = Array.from(fileList);
    input.value = '';

    this.uploading = true;
    this.uploadError = '';
    this.successMessage = '';
    this.cdr.markForCheck();

    try {
      const result = await firstValueFrom(this.tolls.uploadInvoiceImage(files));

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
        setTimeout(() => {
          this.successMessage = '';
          this.cdr.markForCheck();
        }, 5000);
        this.load();
      }
    } catch (err: unknown) {
      const e = err as { error?: { error?: string }; message?: string };
      this.uploadError = e?.error?.error || e?.message || 'Failed to process invoice. Please try again.';
      this.uploading = false;
      this.cdr.markForCheck();
    }
  }
}

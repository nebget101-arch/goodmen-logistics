import { Component, OnInit } from '@angular/core';
import { FuelService } from '../fuel.service';
import { FuelTransaction } from '../fuel.model';
import { Router } from '@angular/router';
@Component({
  selector: 'app-fuel-transactions',
  templateUrl: './fuel-transactions.component.html',
  styleUrls: ['./fuel-transactions.component.css']
})
export class FuelTransactionsComponent implements OnInit {
  loading = false;
  error = '';
  rows: FuelTransaction[] = [];
  total = 0;

  // Filters
  dateFrom = '';
  dateTo = '';
  provider = '';
  matchedStatus = '';
  productType = '';
  search = '';

  pageSize = 50;
  pageOffset = 0;

  drawerTxn: FuelTransaction | null = null;
  drawerExceptions: any[] = [];
  drawerLoading = false;

  deletingId: string | null = null;

  constructor(private fuel: FuelService, private router: Router) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    this.fuel.getTransactions({
      limit: this.pageSize,
      offset: this.pageOffset,
      date_from: this.dateFrom || undefined,
      date_to: this.dateTo || undefined,
      provider: this.provider || undefined,
      matched_status: this.matchedStatus || undefined,
      product_type: this.productType || undefined,
    }).subscribe({
      next: (res) => { this.rows = res.rows; this.total = res.total; this.loading = false; },
      error: (err) => { this.error = err.error?.error || 'Failed to load transactions'; this.loading = false; }
    });
  }

  applyFilters(): void { this.pageOffset = 0; this.load(); }
  clearFilters(): void { this.dateFrom = ''; this.dateTo = ''; this.provider = ''; this.matchedStatus = ''; this.productType = ''; this.pageOffset = 0; this.load(); }

  get pageNumber(): number { return Math.floor(this.pageOffset / this.pageSize) + 1; }
  get totalPages(): number { return Math.ceil(this.total / this.pageSize); }
  prevPage(): void { if (this.pageOffset > 0) { this.pageOffset -= this.pageSize; this.load(); } }
  nextPage(): void { if (this.pageOffset + this.pageSize < this.total) { this.pageOffset += this.pageSize; this.load(); } }

  openDrawer(txn: FuelTransaction): void {
    this.drawerTxn = txn;
    this.drawerExceptions = [];
    this.drawerLoading = true;
    this.fuel.getTransaction(txn.id).subscribe({
      next: (res) => { this.drawerExceptions = res.exceptions; this.drawerLoading = false; },
      error: () => { this.drawerLoading = false; }
    });
  }

  closeDrawer(): void { this.drawerTxn = null; }

  deleteTransaction(txn: FuelTransaction): void {
    if (!confirm(`Delete this transaction from ${txn.provider_name} on ${txn.transaction_date}? This cannot be undone.`)) return;
    this.deletingId = txn.id;
    this.fuel.deleteTransaction(txn.id).subscribe({
      next: () => { this.deletingId = null; this.load(); },
      error: (err) => { this.error = err.error?.error || 'Delete failed'; this.deletingId = null; }
    });
  }

  exportCsv(): void {
    const headers = ['Date','Provider','Card','Truck','Driver','Vendor','City','ST','Gallons','Amount','PPG','Odometer','Product Type','Category','Matched','Settlement','Source'];
    const lines = [headers.join(',')];
    for (const r of this.rows) {
      lines.push([
        r.transaction_date, r.provider_name, r.card_number_masked || '',
        r.truck_display || r.unit_number_raw || '', r.driver_display || r.driver_name_raw || '',
        r.vendor_name || '', r.city || '', r.state || '',
        r.gallons, r.amount, r.price_per_gallon || '',
        r.odometer || '', r.product_type || '', r.category || '',
        r.matched_status, r.settlement_link_status, r.source_batch_id || 'manual'
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fuel-transactions-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  }

  matchClass(status: string): string {
    if (status === 'matched') return 'pill-green';
    if (status === 'partial') return 'pill-yellow';
    if (status === 'manual') return 'pill-blue';
    return 'pill-red';
  }

  settlementClass(status: string): string {
    if (status === 'linked') return 'pill-green';
    if (status === 'pending') return 'pill-yellow';
    if (status === 'excluded') return 'pill-red';
    return 'pill-neutral';
  }

  goToImport(): void { this.router.navigate(['/fuel/import']); }
}

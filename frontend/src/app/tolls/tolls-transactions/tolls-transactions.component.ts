import { Component, OnInit } from '@angular/core';
import { TollsService } from '../tolls.service';
import { TollTransaction } from '../tolls.model';

@Component({
  selector: 'app-tolls-transactions',
  templateUrl: './tolls-transactions.component.html',
  styleUrls: ['./tolls-transactions.component.css']
})
export class TollsTransactionsComponent implements OnInit {
  rows: TollTransaction[] = [];
  total = 0;
  loading = false;
  error = '';

  // Pagination
  page = 1;
  pageSize = 50;

  // Sorting
  sortBy = 'transaction_date';
  sortDir: 'asc' | 'desc' = 'desc';

  // Filters
  filterDateFrom = '';
  filterDateTo = '';
  filterDriver = '';
  filterTruck = '';
  filterStatus = '';

  matchedStatusOptions = [
    { value: '', label: 'All' },
    { value: 'matched', label: 'Matched' },
    { value: 'unmatched', label: 'Unmatched' },
    { value: 'partial', label: 'Partial' },
    { value: 'manual', label: 'Manual' }
  ];

  constructor(private tolls: TollsService) {}

  ngOnInit(): void {
    this.loadTransactions();
  }

  loadTransactions(): void {
    this.loading = true;
    this.error = '';
    this.tolls.getTransactions({
      limit: this.pageSize,
      offset: (this.page - 1) * this.pageSize,
      sort_by: this.sortBy,
      sort_dir: this.sortDir,
      date_from: this.filterDateFrom || undefined,
      date_to: this.filterDateTo || undefined,
      matched_status: this.filterStatus || undefined
    }).subscribe({
      next: (resp) => {
        this.rows = resp.rows || [];
        this.total = resp.total || 0;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load transactions';
        this.loading = false;
      }
    });
  }

  toggleSort(column: string): void {
    if (this.sortBy === column) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = column;
      this.sortDir = 'desc';
    }
    this.page = 1;
    this.loadTransactions();
  }

  sortIcon(column: string): string {
    if (this.sortBy !== column) return '';
    return this.sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  applyFilters(): void {
    this.page = 1;
    this.loadTransactions();
  }

  clearFilters(): void {
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.filterDriver = '';
    this.filterTruck = '';
    this.filterStatus = '';
    this.page = 1;
    this.loadTransactions();
  }

  get maxPage(): number {
    return Math.max(Math.ceil(this.total / this.pageSize), 1);
  }

  prevPage(): void {
    if (this.page > 1) { this.page--; this.loadTransactions(); }
  }

  nextPage(): void {
    if (this.page < this.maxPage) { this.page++; this.loadTransactions(); }
  }

  formatDate(val: string | null | undefined): string {
    if (!val) return '--';
    const d = new Date(val);
    return isNaN(d.getTime()) ? String(val) : d.toISOString().slice(0, 10);
  }

  formatCurrency(val: number | null | undefined): string {
    if (val == null) return '--';
    return '$' + Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

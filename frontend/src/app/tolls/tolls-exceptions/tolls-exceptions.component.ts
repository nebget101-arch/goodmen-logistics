import { Component, OnInit } from '@angular/core';
import { TollsService } from '../tolls.service';
import { TollException } from '../tolls.model';

@Component({
  selector: 'app-tolls-exceptions',
  templateUrl: './tolls-exceptions.component.html',
  styleUrls: ['./tolls-exceptions.component.css']
})
export class TollsExceptionsComponent implements OnInit {
  rows: TollException[] = [];
  total = 0;
  loading = false;
  error = '';

  page = 1;
  pageSize = 50;
  filterStatus = 'open';

  statusOptions = [
    { value: '', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'ignored', label: 'Ignored' }
  ];

  // Resolution dialog
  showResolveDialog = false;
  resolvingException: TollException | null = null;
  resolveNotes = '';
  saving = false;
  toast = '';
  toastType: 'success' | 'error' = 'success';

  constructor(private tolls: TollsService) {}

  ngOnInit(): void {
    this.loadExceptions();
  }

  loadExceptions(): void {
    this.loading = true;
    this.error = '';
    this.tolls.getExceptions({
      limit: this.pageSize,
      offset: (this.page - 1) * this.pageSize,
      status: this.filterStatus || undefined
    }).subscribe({
      next: (resp) => {
        this.rows = resp.rows || [];
        this.total = resp.total || 0;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load exceptions';
        this.loading = false;
      }
    });
  }

  applyFilter(): void {
    this.page = 1;
    this.loadExceptions();
  }

  get maxPage(): number {
    return Math.max(Math.ceil(this.total / this.pageSize), 1);
  }

  prevPage(): void {
    if (this.page > 1) { this.page--; this.loadExceptions(); }
  }

  nextPage(): void {
    if (this.page < this.maxPage) { this.page++; this.loadExceptions(); }
  }

  openResolve(exc: TollException): void {
    this.resolvingException = exc;
    this.resolveNotes = '';
    this.showResolveDialog = true;
  }

  closeResolveDialog(): void {
    this.showResolveDialog = false;
    this.resolvingException = null;
  }

  resolve(action: 'resolved' | 'ignored'): void {
    if (!this.resolvingException || this.saving) return;
    this.saving = true;
    this.tolls.resolveException(this.resolvingException.id, {
      resolution_status: action,
      resolution_notes: this.resolveNotes.trim() || undefined
    }).subscribe({
      next: () => {
        this.saving = false;
        this.showToast(action === 'resolved' ? 'Exception resolved' : 'Exception ignored', 'success');
        this.closeResolveDialog();
        this.loadExceptions();
      },
      error: (err) => {
        this.saving = false;
        this.showToast(err?.error?.error || 'Failed to resolve exception', 'error');
      }
    });
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

  private showToast(message: string, type: 'success' | 'error'): void {
    this.toast = message;
    this.toastType = type;
    setTimeout(() => { this.toast = ''; }, 4000);
  }
}

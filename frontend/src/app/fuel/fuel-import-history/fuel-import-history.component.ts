import { Component, OnInit } from '@angular/core';
import { FuelService } from '../fuel.service';
import { FuelImportBatch } from '../fuel.model';

@Component({
  selector: 'app-fuel-import-history',
  templateUrl: './fuel-import-history.component.html',
  styleUrls: ['./fuel-import-history.component.css']
})
export class FuelImportHistoryComponent implements OnInit {
  loading = false;
  error = '';
  batches: FuelImportBatch[] = [];

  detailBatch: FuelImportBatch | null = null;
  detailRows: any[] = [];
  detailLoading = false;
  detailPage = 0;
  detailPageSize = 30;
  detailFilter: 'all' | 'invalid' | 'warning' = 'all';

  constructor(private fuel: FuelService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    this.fuel.getBatches(100, 0).subscribe({
      next: (res) => { this.batches = res.rows || []; this.loading = false; },
      error: (err) => { this.error = err.error?.error || 'Failed to load import history'; this.loading = false; }
    });
  }

  openDetail(batch: FuelImportBatch): void {
    this.detailBatch = batch;
    this.detailRows = [];
    this.detailLoading = true;
    this.detailPage = 0;
    this.fuel.getBatch(batch.id).subscribe({
      next: (res) => { this.detailRows = res.rows || []; this.detailLoading = false; },
      error: () => { this.detailLoading = false; }
    });
  }

  closeDetail(): void { this.detailBatch = null; }

  get filteredDetailRows(): any[] {
    if (this.detailFilter === 'all') return this.detailRows;
    if (this.detailFilter === 'invalid') return this.detailRows.filter(r => r.row_status === 'error');
    if (this.detailFilter === 'warning') return this.detailRows.filter(r => r.row_status === 'warning');
    return this.detailRows;
  }

  get pagedDetailRows(): any[] {
    return this.filteredDetailRows.slice(this.detailPage * this.detailPageSize, (this.detailPage + 1) * this.detailPageSize);
  }

  get detailTotalPages(): number {
    return Math.ceil(this.filteredDetailRows.length / this.detailPageSize);
  }

  statusClass(status: string): string {
    if (status === 'completed') return 'pill-green';
    if (status === 'validating' || status === 'importing' || status === 'validated') return 'pill-yellow';
    if (status === 'pending') return 'pill-blue';
    if (status === 'failed') return 'pill-red';
    return 'pill-neutral';
  }

  rowStatusClass(status: string): string {
    if (status === 'valid') return 'pill-green';
    if (status === 'warning') return 'pill-yellow';
    if (status === 'error') return 'pill-red';
    if (status === 'duplicate') return 'pill-blue';
    return 'pill-neutral';
  }

  formatDate(ts?: string): string {
    if (!ts) return '—';
    return new Date(ts).toLocaleString();
  }

  get successRate(): string {
    if (!this.detailBatch) return '0%';
    const total = this.detailBatch.total_rows || 0;
    const success = this.detailBatch.success_rows || 0;
    if (total === 0) return '—';
    return ((success / total) * 100).toFixed(1) + '%';
  }
}

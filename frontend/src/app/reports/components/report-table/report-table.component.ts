import { Component, Input, OnChanges } from '@angular/core';

export interface ReportColumn {
  key: string;
  label: string;
  format?: (v: unknown) => string | number;
}

@Component({
  selector: 'app-report-table',
  templateUrl: './report-table.component.html',
  styleUrls: ['./report-table.component.css']
})
export class ReportTableComponent implements OnChanges {
  @Input() title = '';
  @Input() rows: Record<string, unknown>[] = [];
  @Input() columns: ReportColumn[] = [];
  @Input() exportFileName = 'export.csv';

  sortKey = '';
  sortDir: 'asc' | 'desc' = 'asc';
  page = 1;
  pageSize = 20;
  pagedRows: Record<string, unknown>[] = [];
  totalPages = 1;
  private sortedRows: Record<string, unknown>[] = [];

  ngOnChanges(): void {
    this.applySort();
    this.updatePaged();
  }

  sortBy(key: string): void {
    if (this.sortKey === key) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortKey = key; this.sortDir = 'asc'; }
    this.applySort();
    this.updatePaged();
  }

  private applySort(): void {
    const list = this.rows || [];
    if (!this.sortKey || !list.length) {
      this.sortedRows = [...list];
      return;
    }
    this.sortedRows = [...list].sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const va = a[this.sortKey] as number | string;
      const vb = b[this.sortKey] as number | string;
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return this.sortDir === 'asc' ? cmp : -cmp;
    });
  }

  private updatePaged(): void {
    const start = (this.page - 1) * this.pageSize;
    this.pagedRows = this.sortedRows.slice(start, start + this.pageSize);
    this.totalPages = Math.max(1, Math.ceil(this.sortedRows.length / this.pageSize));
  }

  prevPage(): void {
    if (this.page > 1) { this.page--; this.updatePaged(); }
  }

  nextPage(): void {
    if (this.page < this.totalPages) { this.page++; this.updatePaged(); }
  }

  exportCsv(): void {
    const cols = this.columns || [];
    const head = cols.map(c => c.label).join(',');
    const lines = this.sortedRows.map((row: Record<string, unknown>) =>
      cols.map(c => String(c.format ? c.format(row[c.key]) : (row[c.key] ?? '')).replace(/"/g, '""')).join(',')
    );
    const csv = [head, ...lines].map(l => `"${l}"`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = this.exportFileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

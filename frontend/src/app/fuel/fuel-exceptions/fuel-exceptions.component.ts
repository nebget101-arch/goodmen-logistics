import { Component, OnInit } from '@angular/core';
import { FuelService } from '../fuel.service';
import { FuelException } from '../fuel.model';

@Component({
  selector: 'app-fuel-exceptions',
  templateUrl: './fuel-exceptions.component.html',
  styleUrls: ['./fuel-exceptions.component.css']
})
export class FuelExceptionsComponent implements OnInit {
  loading = false;
  error = '';
  rows: FuelException[] = [];

  selected = new Set<string>();
  resolvingId: string | null = null;
  bulkLoading = false;
  reprocessLoading = false;

  constructor(private fuel: FuelService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    this.fuel.getExceptions('open', 200, 0).subscribe({
      next: (res) => {
        this.rows = res.rows || [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.error || 'Failed to load exceptions';
        this.loading = false;
      }
    });
  }

  toggleSelect(id: string): void {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
  }

  toggleSelectAll(ev: Event): void {
    const checked = (ev.target as HTMLInputElement).checked;
    this.selected.clear();
    if (checked) this.rows.forEach(r => this.selected.add(r.id));
  }

  get allSelected(): boolean { return this.rows.length > 0 && this.selected.size === this.rows.length; }

  resolveOne(row: FuelException, status: 'resolved' | 'ignored'): void {
    this.resolvingId = row.id;
    this.fuel.resolveException(row.id, status === 'ignored' ? { ignore: true } : {}).subscribe({
      next: () => { this.resolvingId = null; this.selected.delete(row.id); this.load(); },
      error: (err) => { this.error = err.error?.error || 'Failed to resolve exception'; this.resolvingId = null; }
    });
  }

  bulkResolve(status: 'resolved' | 'ignored'): void {
    if (!this.selected.size) return;
    this.bulkLoading = true;
    this.fuel.bulkResolveExceptions(Array.from(this.selected), status === 'resolved' ? 'resolve' : 'ignore').subscribe({
      next: () => { this.bulkLoading = false; this.selected.clear(); this.load(); },
      error: (err) => { this.error = err.error?.error || 'Bulk resolve failed'; this.bulkLoading = false; }
    });
  }

  reprocess(): void {
    this.reprocessLoading = true;
    this.fuel.reprocessUnmatched().subscribe({
      next: () => { this.reprocessLoading = false; this.load(); },
      error: (err) => { this.error = err.error?.error || 'Reprocess failed'; this.reprocessLoading = false; }
    });
  }

  statusClass(status: string): string {
    if (status === 'open') return 'pill-yellow';
    if (status === 'resolved') return 'pill-green';
    if (status === 'ignored') return 'pill-neutral';
    return 'pill-neutral';
  }

  typeClass(type: string): string {
    if (type.includes('driver')) return 'type-driver';
    if (type.includes('truck')) return 'type-truck';
    if (type.includes('card')) return 'type-card';
    return 'type-other';
  }
}

import { Component, OnInit } from '@angular/core';
import { FuelService } from '../fuel.service';
import { FuelOverview } from '../fuel.model';
import { Router } from '@angular/router';

@Component({
  selector: 'app-fuel-overview',
  templateUrl: './fuel-overview.component.html',
  styleUrls: ['./fuel-overview.component.css']
})
export class FuelOverviewComponent implements OnInit {
  loading = true;
  error = '';
  overview: FuelOverview | null = null;

  constructor(private fuel: FuelService, private router: Router) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    this.fuel.getOverview().subscribe({
      next: (data) => { this.overview = data; this.loading = false; },
      error: (err) => { this.error = err.error?.error || 'Failed to load overview'; this.loading = false; }
    });
  }

  goToImport(): void { this.router.navigate(['/fuel/import']); }
  goToExceptions(): void { this.router.navigate(['/fuel/exceptions']); }
  goToTransactions(): void { this.router.navigate(['/fuel/transactions']); }

  fmt(n: number | undefined, decimals = 2): string {
    return (n ?? 0).toFixed(decimals);
  }

  fmtCurrency(n: number | undefined): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0);
  }

  get importStatusClass(): string {
    const s = this.overview?.lastBatch?.import_status;
    if (s === 'completed') return 'status-ok';
    if (s === 'failed') return 'status-err';
    return 'status-neutral';
  }
}

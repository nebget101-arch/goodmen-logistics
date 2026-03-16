import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LeaseFinancingService } from '../../lease-financing.service';
import { LeaseAgreement } from '../../lease-financing.models';

@Component({
  selector: 'app-lease-agreements-list',
  template: `
    <section class="card">
      <header class="row">
        <h2>Lease to Own Agreements</h2>
        <div class="actions">
          <button type="button" (click)="goDashboard()">Financing Dashboard</button>
          <button type="button" (click)="create()">Create Agreement</button>
        </div>
      </header>

      <div class="filters">
        <input [(ngModel)]="filters.status" placeholder="status" />
        <input [(ngModel)]="filters.driver_id" placeholder="driver id" />
        <input [(ngModel)]="filters.truck_id" placeholder="truck id" />
        <button type="button" (click)="load()">Apply</button>
      </div>

      <p *ngIf="loading">Loading agreements…</p>
      <p *ngIf="error" class="error">{{ error }}</p>

      <table *ngIf="!loading && !error">
        <thead>
          <tr>
            <th>#</th><th>Driver</th><th>Truck</th><th>Start</th><th>Payment</th><th>Remaining</th><th>Next Due</th><th>Status</th><th>Risk</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let row of rows" (click)="open(row)">
            <td>{{ row.agreement_number }}</td>
            <td>{{ row.driver_name || row.driver_id }}</td>
            <td>{{ row.truck_label || row.truck_id }}</td>
            <td>{{ row.agreement_start_date }}</td>
            <td>{{ row.payment_amount | number:'1.2-2' }}</td>
            <td>{{ row.remaining_balance | number:'1.2-2' }}</td>
            <td>{{ row.next_due_date || '—' }}</td>
            <td>{{ row.status }}</td>
            <td>{{ row.risk_level || 'low' }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  `,
  styles: [`.card{padding:1rem}.row{display:flex;justify-content:space-between;align-items:center}.actions{display:flex;gap:.5rem}.filters{display:flex;gap:.5rem;flex-wrap:wrap;margin:.6rem 0}table{width:100%;border-collapse:collapse}th,td{padding:.45rem;border-bottom:1px solid #e6ebf5}tr{cursor:pointer}.error{color:#c33}`]
})
export class LeaseAgreementsListComponent implements OnInit {
  rows: LeaseAgreement[] = [];
  loading = false;
  error = '';
  filters: { status: string; driver_id: string; truck_id: string } = { status: '', driver_id: '', truck_id: '' };

  constructor(private lease: LeaseFinancingService, private router: Router) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    this.lease.listAgreements(this.filters).subscribe({
      next: (resp) => { this.rows = resp.rows || []; this.loading = false; },
      error: (err) => { this.error = err?.error?.error || 'Failed to load agreements'; this.loading = false; }
    });
  }

  create(): void { this.router.navigate(['/finance/lease-to-own/new']); }
  goDashboard(): void { this.router.navigate(['/finance/lease-to-own/dashboard']); }
  open(row: LeaseAgreement): void { this.router.navigate(['/finance/lease-to-own', row.id]); }
}

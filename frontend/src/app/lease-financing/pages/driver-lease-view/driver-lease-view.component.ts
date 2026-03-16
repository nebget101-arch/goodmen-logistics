import { Component, OnInit } from '@angular/core';
import { LeaseFinancingService } from '../../lease-financing.service';

@Component({
  selector: 'app-driver-lease-view',
  template: `
    <section class="card">
      <h2>My Lease-to-Own</h2>
      <p *ngIf="loading">Loading…</p>
      <p *ngIf="error" class="error">{{ error }}</p>
      <ng-container *ngIf="agreement">
        <p><strong>Agreement:</strong> {{ agreement.agreement_number }}</p>
        <p><strong>Truck:</strong> {{ agreement.truck_label || agreement.truck_id }}</p>
        <p><strong>Remaining Balance:</strong> {{ agreement.remaining_balance | number:'1.2-2' }}</p>
        <p><strong>Next Due:</strong> {{ agreement.next_due_date || '—' }}</p>
        <h3>Recent Payments</h3>
        <ul>
          <li *ngFor="let p of agreement.payments">{{ p.payment_date }} — {{ p.amount_paid | number:'1.2-2' }} ({{ p.payment_method }})</li>
        </ul>
      </ng-container>
    </section>
  `,
  styles: [`.card{padding:1rem}.error{color:#c33}`]
})
export class DriverLeaseViewComponent implements OnInit {
  loading = false;
  error = '';
  agreement: any;

  constructor(private lease: LeaseFinancingService) {}

  ngOnInit(): void {
    this.loading = true;
    this.lease.listAgreements({ active_only: 1, limit: 1 }).subscribe({
      next: (resp) => {
        const first = (resp.rows || [])[0];
        if (!first) {
          this.loading = false;
          return;
        }
        this.lease.getAgreement(first.id).subscribe({
          next: (full) => { this.agreement = full; this.loading = false; },
          error: (err) => { this.error = err?.error?.error || 'Failed to load agreement'; this.loading = false; }
        });
      },
      error: (err) => { this.error = err?.error?.error || 'Failed to load agreement'; this.loading = false; }
    });
  }
}

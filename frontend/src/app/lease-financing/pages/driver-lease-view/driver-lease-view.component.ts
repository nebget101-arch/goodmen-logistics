import { Component, OnInit } from '@angular/core';
import { LeaseFinancingService } from '../../lease-financing.service';

@Component({
  selector: 'app-driver-lease-view',
  template: `
    <section class="driver-lease-page">
      <div class="ambient-glow"></div>

      <header class="page-header">
        <p class="hero-pill">🤖 AI lease insights</p>
        <h2>My Lease-to-Own</h2>
      </header>

      <p *ngIf="loading" class="loading">Loading…</p>
      <p *ngIf="error" class="error">{{ error }}</p>

      <ng-container *ngIf="agreement">
        <div class="kpi-grid">
          <article class="glass-card kpi">
            <p class="kpi-label">Agreement</p>
            <p class="kpi-value">{{ agreement.agreement_number }}</p>
          </article>
          <article class="glass-card kpi">
            <p class="kpi-label">Truck</p>
            <p class="kpi-value">{{ agreement.truck_label || agreement.truck_id }}</p>
          </article>
          <article class="glass-card kpi">
            <p class="kpi-label">Remaining Balance</p>
            <p class="kpi-value">{{ agreement.remaining_balance | number:'1.2-2' }}</p>
          </article>
          <article class="glass-card kpi">
            <p class="kpi-label">Next Due</p>
            <p class="kpi-value">{{ agreement.next_due_date ? (agreement.next_due_date | date:'mediumDate') : '—' }}</p>
          </article>
        </div>

        <section class="glass-card payments-section">
          <h3>💳 Recent Payments</h3>
          <table class="ai-table" *ngIf="agreement.payments?.length; else noPayments">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let p of agreement.payments">
                <td>{{ p.payment_date ? (p.payment_date | date:'mediumDate') : '—' }}</td>
                <td>{{ p.amount_paid | number:'1.2-2' }}</td>
                <td>{{ p.payment_method || 'manual' }}</td>
                <td>
                  <span class="status-pill" [ngClass]="statusClass(p.status || 'paid')">{{ p.status || 'paid' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <ng-template #noPayments>
            <p class="muted">No payments posted yet.</p>
          </ng-template>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .driver-lease-page {
      position: relative;
      padding: 1.2rem;
      border-radius: 18px;
      background: radial-gradient(circle at top left, #112346 0%, #0a1531 48%, #050d21 100%);
      color: #e7ecff;
      border: 1px solid rgba(94, 145, 255, 0.2);
      overflow: hidden;
    }
    .ambient-glow {
      position: absolute;
      width: 420px;
      height: 420px;
      border-radius: 50%;
      right: -165px;
      top: -175px;
      background: radial-gradient(circle, rgba(47, 234, 255, .17), transparent 68%);
      pointer-events: none;
    }
    .page-header { position: relative; margin-bottom: .9rem; }
    .hero-pill {
      display: inline-flex;
      margin: 0 0 .5rem;
      padding: .33rem .75rem;
      border-radius: 999px;
      background: rgba(61, 112, 244, .18);
      border: 1px solid rgba(120, 157, 255, .35);
      font-size: .78rem;
      letter-spacing: .04em;
      text-transform: uppercase;
      color: #cfe3ff;
    }
    h2 { margin: 0; color: #f5f8ff; font-size: 1.6rem; }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: .75rem;
    }
    .glass-card {
      padding: .95rem;
      border-radius: 14px;
      background: rgba(9, 23, 53, .63);
      border: 1px solid rgba(111, 151, 255, .22);
      backdrop-filter: blur(6px);
    }
    .kpi-label {
      margin: 0 0 .25rem;
      color: #a8c1ef;
      font-size: .76rem;
      letter-spacing: .05em;
      text-transform: uppercase;
      font-weight: 700;
    }
    .kpi-value {
      margin: 0;
      color: #f0f5ff;
      font-size: 1.02rem;
      font-weight: 700;
    }

    .payments-section { margin-top: .95rem; }
    h3 { margin: 0 0 .75rem; color: #edf3ff; font-size: 1rem; }
    .ai-table {
      width: 100%;
      border-collapse: collapse;
      background: rgba(4, 12, 33, .55);
      border: 1px solid rgba(133, 160, 232, .2);
      border-radius: 12px;
      overflow: hidden;
    }
    .ai-table th, .ai-table td {
      padding: .55rem .6rem;
      border-bottom: 1px solid rgba(133, 160, 232, .18);
      text-align: left;
      font-size: .9rem;
    }
    .ai-table thead th {
      color: #bcd5ff;
      font-size: .76rem;
      letter-spacing: .05em;
      text-transform: uppercase;
    }
    .ai-table tbody tr:hover { background: rgba(51, 88, 189, .16); }

    .status-pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      font-size: .76rem;
      text-transform: uppercase;
      letter-spacing: .05em;
      padding: .2rem .52rem;
      border: 1px solid rgba(160, 186, 255, .34);
      background: rgba(78, 107, 190, .2);
      color: #dce9ff;
      font-weight: 700;
    }
    .status-pill.paid,
    .status-pill.active,
    .status-pill.completed {
      background: rgba(30, 194, 136, .2);
      border-color: rgba(39, 226, 156, .35);
      color: #8bffd4;
    }
    .status-pill.pending,
    .status-pill.partial {
      background: rgba(255, 187, 64, .18);
      border-color: rgba(255, 194, 73, .42);
      color: #ffe39f;
    }
    .status-pill.failed,
    .status-pill.overdue,
    .status-pill.terminated {
      background: rgba(255, 92, 137, .18);
      border-color: rgba(255, 116, 156, .46);
      color: #ffc0d3;
    }

    .loading { color: #9ec6ff; margin: 0 0 .7rem; }
    .muted { color: #a8c1ef; margin: 0; }
    .error { color: #ff9abc; margin: 0 0 .7rem; }

    @media (max-width: 900px) {
      .driver-lease-page { padding: 1rem; }
      .ai-table { display: block; overflow-x: auto; }
    }
  `]
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

  statusClass(status?: string): string {
    return (status || '').toLowerCase();
  }
}

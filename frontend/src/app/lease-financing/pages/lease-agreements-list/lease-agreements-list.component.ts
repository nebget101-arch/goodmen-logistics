import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LeaseFinancingService } from '../../lease-financing.service';
import { LeaseAgreement } from '../../lease-financing.models';

@Component({
  selector: 'app-lease-agreements-list',
  template: `
    <section class="lease-page">
      <div class="bg-glow bg-glow-red"></div>
      <div class="bg-glow bg-glow-blue"></div>

      <header class="hero card-glass">
        <div class="hero-pill">
          <span class="material-symbols-outlined">auto_awesome</span>
          FleetNeuron AI Finance
        </div>
        <h2>
          <span class="material-symbols-outlined title-icon">payments</span>
          Lease to Own Agreements
        </h2>
        <p>Track agreement health, payment exposure, and portfolio risk in one place.</p>
        <div class="actions">
          <button type="button" class="btn btn-ghost" (click)="goDashboard()">
            <span class="material-symbols-outlined">dashboard</span>
            Financing Dashboard
          </button>
          <button type="button" class="btn btn-danger" (click)="create()">
            <span class="material-symbols-outlined">add_circle</span>
            Create Agreement
          </button>
        </div>
      </header>

      <section class="filters-card card-glass">
        <div class="filters-grid">
          <label>
            <span>Status</span>
            <input [(ngModel)]="filters.status" placeholder="active / overdue / defaulted" />
          </label>
          <label>
            <span>Driver ID</span>
            <input [(ngModel)]="filters.driver_id" placeholder="Driver UUID" />
          </label>
          <label>
            <span>Truck ID</span>
            <input [(ngModel)]="filters.truck_id" placeholder="Truck UUID" />
          </label>
        </div>
        <div class="filter-actions">
          <button type="button" class="btn btn-primary" (click)="load()">
            <span class="material-symbols-outlined">tune</span>
            Apply Filters
          </button>
        </div>
      </section>

      <section class="table-card card-glass">
        <p *ngIf="loading" class="state muted">Loading agreements…</p>
        <p *ngIf="error" class="state error">{{ error }}</p>

        <table *ngIf="!loading && !error" class="data-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Driver</th>
              <th scope="col">Truck</th>
              <th scope="col">Start</th>
              <th scope="col">Payment</th>
              <th scope="col">Remaining</th>
              <th scope="col">Next Due</th>
              <th scope="col">Status</th>
              <th scope="col">Risk</th>
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
              <td>
                <span class="pill" [ngClass]="'pill-' + (row.status || 'draft')">{{ row.status }}</span>
              </td>
              <td>
                <span class="pill" [ngClass]="'pill-risk-' + (row.risk_level || 'low')">{{ row.risk_level || 'low' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer class="ai-footer">
        <span>Protected by FleetNeuron AI Financing Intelligence</span>
      </footer>
    </section>
  `,
  styles: [`
    .lease-page {
      position: relative;
      padding: 1rem;
      min-height: calc(100vh - 72px);
      color: #e2e8f0;
      background:
        radial-gradient(circle at 0 0, rgba(239, 68, 68, 0.14), transparent 55%),
        radial-gradient(circle at 100% 100%, rgba(59, 130, 246, 0.12), transparent 48%),
        rgba(2, 6, 23, 0.95);
      overflow: hidden;
    }

    .bg-glow {
      position: absolute;
      border-radius: 999px;
      filter: blur(60px);
      pointer-events: none;
      opacity: .45;
    }

    .bg-glow-red { width: 320px; height: 320px; left: -120px; top: -120px; background: rgba(239, 68, 68, .35); }
    .bg-glow-blue { width: 380px; height: 380px; right: -140px; bottom: -140px; background: rgba(59, 130, 246, .28); }

    .card-glass {
      position: relative;
      z-index: 1;
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.78);
      backdrop-filter: blur(8px);
    }

    .hero { padding: 1rem 1rem .9rem; margin-bottom: .9rem; }

    .hero-pill {
      display: inline-flex;
      align-items: center;
      gap: .35rem;
      padding: .24rem .62rem;
      border-radius: 999px;
      border: 1px solid rgba(59, 130, 246, .45);
      background: rgba(30, 58, 138, .25);
      font-size: .72rem;
      color: #bfdbfe;
      margin-bottom: .55rem;
    }

    h2 {
      margin: 0;
      display: flex;
      align-items: center;
      gap: .5rem;
      font-size: 1.3rem;
      color: #f8fafc;
    }

    .title-icon { color: #ef4444; font-size: 22px; }
    p { margin: .42rem 0 .8rem; color: #94a3b8; font-size: .92rem; }

    .actions { display: flex; gap: .55rem; flex-wrap: wrap; }
    .btn {
      border: 1px solid transparent;
      border-radius: 10px;
      padding: .5rem .78rem;
      display: inline-flex;
      align-items: center;
      gap: .35rem;
      font-size: .86rem;
      cursor: pointer;
      transition: transform .15s ease, opacity .15s ease;
    }
    .btn:hover { transform: translateY(-1px); opacity: .96; }
    .btn-primary { background: #2563eb; color: #eff6ff; }
    .btn-ghost { background: rgba(15, 23, 42, .45); border-color: rgba(148, 163, 184, .4); color: #cbd5e1; }
    .btn-danger { background: #ef4444; color: #fff; }

    .filters-card { padding: .85rem; margin-bottom: .9rem; }
    .filters-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: .68rem;
    }
    label { display: grid; gap: .28rem; }
    label span { font-size: .74rem; color: #94a3b8; }
    input {
      border: 1px solid rgba(148, 163, 184, .3);
      border-radius: 9px;
      background: rgba(15, 23, 42, .75);
      color: #e2e8f0;
      padding: .5rem .6rem;
      outline: none;
    }
    input:focus { border-color: rgba(239, 68, 68, .75); box-shadow: 0 0 0 2px rgba(239, 68, 68, .18); }
    .filter-actions { margin-top: .7rem; display: flex; justify-content: flex-end; }

    .table-card { padding: .35rem .5rem .5rem; }
    .state { padding: .5rem .35rem; margin: 0; }
    .muted { color: #94a3b8; }
    .error { color: #fca5a5; }

    .data-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: .86rem; }
    .data-table thead th {
      text-align: left;
      color: #94a3b8;
      padding: .6rem .48rem;
      border-bottom: 1px solid rgba(148, 163, 184, .28);
      font-weight: 600;
      position: sticky;
      top: 0;
      background: rgba(15, 23, 42, .85);
    }
    .data-table tbody td {
      padding: .58rem .48rem;
      border-bottom: 1px solid rgba(51, 65, 85, .55);
      color: #e2e8f0;
    }
    .data-table tbody tr { cursor: pointer; transition: background .15s ease; }
    .data-table tbody tr:hover { background: rgba(30, 41, 59, .55); }

    .pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: .14rem .52rem;
      border: 1px solid rgba(148, 163, 184, .35);
      background: rgba(30, 41, 59, .5);
      font-size: .72rem;
      text-transform: capitalize;
    }
    .pill-active, .pill-completed { border-color: rgba(34, 197, 94, .6); color: #86efac; }
    .pill-overdue, .pill-defaulted { border-color: rgba(239, 68, 68, .6); color: #fca5a5; }
    .pill-draft { border-color: rgba(59, 130, 246, .6); color: #93c5fd; }
    .pill-risk-low { border-color: rgba(34, 197, 94, .55); color: #86efac; }
    .pill-risk-medium { border-color: rgba(245, 158, 11, .55); color: #fcd34d; }
    .pill-risk-high { border-color: rgba(239, 68, 68, .55); color: #fca5a5; }

    .ai-footer {
      position: relative;
      z-index: 1;
      margin-top: .8rem;
      display: inline-flex;
      border: 1px solid rgba(34, 197, 94, .35);
      border-radius: 999px;
      padding: .22rem .62rem;
      font-size: .65rem;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: #86efac;
      background: rgba(22, 101, 52, .18);
    }
  `]
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

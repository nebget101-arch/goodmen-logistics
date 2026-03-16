import { Component, OnInit } from '@angular/core';
import { LeaseFinancingService } from '../../lease-financing.service';

@Component({
  selector: 'app-lease-financing-dashboard',
  template: `
    <section class="dashboard-page">
      <header class="hero card-glass">
        <div class="hero-pill">
          <span class="material-symbols-outlined">auto_awesome</span>
          FleetNeuron AI Finance
        </div>
        <h2>
          <span class="material-symbols-outlined title-icon">monitoring</span>
          Fleet Financing Dashboard
        </h2>
        <p>Real-time financing health across principal, collections, risk exposure, and delinquency.</p>
      </header>

      <div class="cards" *ngIf="summary">
        <article class="kpi-card"><h4><span class="material-symbols-outlined">account_balance_wallet</span>Total Financed</h4><p>{{ summary.total_financed_amount | number:'1.2-2' }}</p></article>
        <article class="kpi-card"><h4><span class="material-symbols-outlined">payments</span>Outstanding</h4><p>{{ summary.current_outstanding_principal | number:'1.2-2' }}</p></article>
        <article class="kpi-card"><h4><span class="material-symbols-outlined">savings</span>Collected</h4><p>{{ summary.payments_collected_to_date | number:'1.2-2' }}</p></article>
        <article class="kpi-card"><h4><span class="material-symbols-outlined">warning</span>Overdue</h4><p>{{ summary.overdue_amount | number:'1.2-2' }}</p></article>
        <article class="kpi-card"><h4><span class="material-symbols-outlined">playlist_add_check</span>Active</h4><p>{{ summary.active_agreements }}</p></article>
        <article class="kpi-card"><h4><span class="material-symbols-outlined">event_busy</span>Overdue Agmts</h4><p>{{ summary.overdue_agreements }}</p></article>
        <article class="kpi-card"><h4><span class="material-symbols-outlined">gpp_bad</span>Defaulted</h4><p>{{ summary.defaulted_agreements }}</p></article>
        <article class="kpi-card"><h4><span class="material-symbols-outlined">task_alt</span>Completed</h4><p>{{ summary.completed_agreements }}</p></article>
      </div>

      <section class="table-card card-glass">
        <h3><span class="material-symbols-outlined">bar_chart</span>Monthly Cashflow</h3>
        <table class="data-table">
          <thead><tr><th scope="col">Month</th><th scope="col">Scheduled</th><th scope="col">Collected</th><th scope="col">Overdue</th><th scope="col">Late Fees</th><th scope="col">Expected vs Actual</th><th scope="col">Net Inflow</th></tr></thead>
          <tbody>
            <tr *ngFor="let r of cashflow">
              <td>{{ r.month | date:'yyyy-MM' }}</td>
              <td>{{ r.scheduled_payments | number:'1.2-2' }}</td>
              <td>{{ r.collected_payments | number:'1.2-2' }}</td>
              <td>{{ r.overdue_unpaid_amount | number:'1.2-2' }}</td>
              <td>{{ r.late_fees_collected | number:'1.2-2' }}</td>
              <td>{{ r.expected_vs_actual | number:'1.2-2' }}</td>
              <td>{{ r.net_financing_inflow | number:'1.2-2' }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="table-card card-glass">
        <h3><span class="material-symbols-outlined">crisis_alert</span>High Risk Agreements</h3>
        <table class="data-table">
          <thead><tr><th scope="col">Agreement</th><th scope="col">Driver</th><th scope="col">Risk</th><th scope="col">Score</th><th scope="col">Action</th></tr></thead>
          <tbody>
            <tr *ngFor="let r of highRisk">
              <td>{{ r.agreement_number }}</td>
              <td>{{ r.driver_name }}</td>
              <td><span class="risk-pill" [ngClass]="'risk-' + (r.risk_level || 'low')">{{ r.risk_level }}</span></td>
              <td>{{ r.risk_score }}</td>
              <td>{{ r.recommended_action }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </section>
  `,
  styles: [`
    .dashboard-page {
      padding: 1rem;
      min-height: calc(100vh - 72px);
      color: #e2e8f0;
      background:
        radial-gradient(circle at 0 0, rgba(59, 130, 246, 0.12), transparent 55%),
        radial-gradient(circle at 100% 100%, rgba(239, 68, 68, 0.11), transparent 48%),
        rgba(2, 6, 23, 0.96);
    }

    .card-glass {
      border: 1px solid rgba(148, 163, 184, .24);
      border-radius: 14px;
      background: rgba(15, 23, 42, .78);
      backdrop-filter: blur(8px);
    }

    .hero { padding: 1rem; margin-bottom: .9rem; }
    .hero-pill {
      display: inline-flex;
      align-items: center;
      gap: .35rem;
      border: 1px solid rgba(59, 130, 246, .45);
      border-radius: 999px;
      padding: .24rem .62rem;
      font-size: .72rem;
      color: #bfdbfe;
      background: rgba(30, 58, 138, .25);
      margin-bottom: .55rem;
    }

    h2 {
      margin: 0;
      display: flex;
      align-items: center;
      gap: .46rem;
      color: #f8fafc;
      font-size: 1.28rem;
    }

    .title-icon { color: #ef4444; font-size: 22px; }
    p { margin: .42rem 0 0; color: #94a3b8; font-size: .92rem; }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: .65rem;
      margin-bottom: .95rem;
    }

    .kpi-card {
      border: 1px solid rgba(148, 163, 184, .24);
      border-radius: 12px;
      background: rgba(15, 23, 42, .78);
      padding: .7rem;
      transition: transform .15s ease, border-color .15s ease;
    }

    .kpi-card:hover {
      transform: translateY(-1px);
      border-color: rgba(239, 68, 68, .42);
    }

    .kpi-card h4 {
      margin: 0;
      display: flex;
      align-items: center;
      gap: .32rem;
      color: #94a3b8;
      font-size: .78rem;
      font-weight: 600;
      letter-spacing: .02em;
    }

    .kpi-card h4 .material-symbols-outlined { font-size: 17px; color: #60a5fa; }
    .kpi-card p { margin: .52rem 0 0; color: #f8fafc; font-size: 1.1rem; font-weight: 700; }

    .table-card { padding: .7rem; margin-bottom: .9rem; overflow-x: auto; }
    h3 {
      margin: 0 0 .52rem;
      display: flex;
      align-items: center;
      gap: .4rem;
      color: #e2e8f0;
      font-size: 1rem;
    }
    h3 .material-symbols-outlined { color: #ef4444; font-size: 19px; }

    .data-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: .86rem;
      min-width: 760px;
    }

    .data-table thead th {
      text-align: left;
      padding: .56rem .44rem;
      color: #94a3b8;
      border-bottom: 1px solid rgba(148, 163, 184, .28);
      font-weight: 600;
      background: rgba(15, 23, 42, .86);
      position: sticky;
      top: 0;
    }

    .data-table tbody td {
      padding: .56rem .44rem;
      color: #e2e8f0;
      border-bottom: 1px solid rgba(51, 65, 85, .55);
    }

    .data-table tbody tr:hover { background: rgba(30, 41, 59, .5); }

    .risk-pill {
      display: inline-flex;
      border: 1px solid rgba(148, 163, 184, .4);
      border-radius: 999px;
      padding: .13rem .5rem;
      font-size: .72rem;
      text-transform: capitalize;
      background: rgba(30, 41, 59, .55);
    }

    .risk-low { color: #86efac; border-color: rgba(34, 197, 94, .55); }
    .risk-medium { color: #fcd34d; border-color: rgba(245, 158, 11, .55); }
    .risk-high { color: #fca5a5; border-color: rgba(239, 68, 68, .55); }
  `]
})
export class LeaseFinancingDashboardComponent implements OnInit {
  summary: any;
  cashflow: any[] = [];
  highRisk: any[] = [];

  constructor(private lease: LeaseFinancingService) {}

  ngOnInit(): void {
    this.lease.getSummary().subscribe({ next: (r) => this.summary = r });
    this.lease.getCashflow({}).subscribe({ next: (r) => this.cashflow = r.rows || [] });
    this.lease.getRisk().subscribe({ next: (r) => this.highRisk = r.high_risk_agreements || [] });
  }
}

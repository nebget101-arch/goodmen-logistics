import { Component, OnInit } from '@angular/core';
import { LeaseFinancingService } from '../../lease-financing.service';

@Component({
  selector: 'app-lease-financing-dashboard',
  template: `
    <section class="card">
      <h2>Fleet Financing Dashboard</h2>
      <div class="cards" *ngIf="summary">
        <article><h4>Total Financed</h4><p>{{ summary.total_financed_amount | number:'1.2-2' }}</p></article>
        <article><h4>Outstanding</h4><p>{{ summary.current_outstanding_principal | number:'1.2-2' }}</p></article>
        <article><h4>Collected</h4><p>{{ summary.payments_collected_to_date | number:'1.2-2' }}</p></article>
        <article><h4>Overdue</h4><p>{{ summary.overdue_amount | number:'1.2-2' }}</p></article>
        <article><h4>Active</h4><p>{{ summary.active_agreements }}</p></article>
        <article><h4>Overdue Agmts</h4><p>{{ summary.overdue_agreements }}</p></article>
        <article><h4>Defaulted</h4><p>{{ summary.defaulted_agreements }}</p></article>
        <article><h4>Completed</h4><p>{{ summary.completed_agreements }}</p></article>
      </div>

      <h3>Monthly Cashflow</h3>
      <table>
        <thead><tr><th>Month</th><th>Scheduled</th><th>Collected</th><th>Overdue</th><th>Late Fees</th><th>Expected vs Actual</th><th>Net Inflow</th></tr></thead>
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

      <h3>High Risk Agreements</h3>
      <table>
        <thead><tr><th>Agreement</th><th>Driver</th><th>Risk</th><th>Score</th><th>Action</th></tr></thead>
        <tbody>
          <tr *ngFor="let r of highRisk">
            <td>{{ r.agreement_number }}</td>
            <td>{{ r.driver_name }}</td>
            <td>{{ r.risk_level }}</td>
            <td>{{ r.risk_score }}</td>
            <td>{{ r.recommended_action }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  `,
  styles: [`.card{padding:1rem}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.6rem;margin-bottom:1rem}.cards article{border:1px solid #e4e9f3;border-radius:10px;padding:.55rem;background:#f8faff}table{width:100%;border-collapse:collapse;margin:.5rem 0 1rem}th,td{border-bottom:1px solid #e9eef7;padding:.4rem;text-align:left}`]
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

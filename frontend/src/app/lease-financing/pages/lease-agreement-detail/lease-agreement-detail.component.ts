import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LeaseFinancingService } from '../../lease-financing.service';

@Component({
  selector: 'app-lease-agreement-detail',
  template: `
    <section class="agreement-page" *ngIf="agreement">
      <div class="ambient-glow"></div>

      <header class="page-header">
        <div>
          <p class="hero-pill">🤖 AI-optimized lease control</p>
          <h2>Agreement {{ agreement.agreement_number }}</h2>
          <p class="subtitle">
            <span class="status-pill" [ngClass]="statusClass(agreement.status)">{{ agreement.status }}</span>
            <span>Driver: {{ agreement.driver_name || agreement.driver_id }}</span>
            <span>Truck: {{ agreement.truck_label || agreement.truck_id }}</span>
          </p>
          <p class="balance">Remaining Balance: <strong>{{ agreement.remaining_balance | number:'1.2-2' }}</strong></p>
        </div>

        <div class="actions">
          <button
            type="button"
            class="btn btn-primary"
            (click)="activate()"
            [disabled]="agreement.status==='active' || agreement.status==='completed'"
          >⚡ Activate</button>
          <button
            type="button"
            class="btn btn-danger"
            (click)="terminate()"
            [disabled]="agreement.status==='terminated' || agreement.status==='completed'"
          >🛑 Terminate</button>
          <button type="button" class="btn btn-ghost" (click)="toEdit()">✏️ Edit</button>
        </div>
      </header>

      <div class="glass-card section">
        <h3>📄 Contract</h3>
        <div class="contract-row">
          <input type="file" (change)="onFile($event)" />
          <button type="button" class="btn btn-primary" (click)="uploadContract()" [disabled]="!selectedFile">Upload</button>
          <a *ngIf="agreement.document_download_url" class="btn btn-ghost link-btn" [href]="agreement.document_download_url" target="_blank" rel="noreferrer">Download</a>
        </div>
      </div>

      <div class="glass-card section">
        <h3>📆 Payment Schedule</h3>
        <table class="ai-table">
          <thead><tr><th>#</th><th>Due</th><th>Amount Due</th><th>Paid</th><th>Remaining</th><th>Status</th></tr></thead>
          <tbody>
            <tr *ngFor="let s of agreement.schedule">
              <td>{{ s.installment_number }}</td>
              <td>{{ s.due_date | date:'mediumDate' }}</td>
              <td>{{ s.amount_due | number:'1.2-2' }}</td>
              <td>{{ s.amount_paid | number:'1.2-2' }}</td>
              <td>{{ s.remaining_due | number:'1.2-2' }}</td>
              <td><span class="status-pill" [ngClass]="statusClass(s.status)">{{ s.status }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="glass-card section">
        <h3>💳 Manual Payment</h3>
        <div class="manual-row">
          <input type="number" [(ngModel)]="manual.amount_paid" placeholder="Amount" />
          <input type="text" [(ngModel)]="manual.reference_number" placeholder="Reference" />
          <button type="button" class="btn btn-primary" (click)="manualPayment()">Record Payment</button>
        </div>
      </div>

      <div class="glass-card section">
        <h3>🧠 Risk</h3>
        <p>
          Risk: <span class="status-pill" [ngClass]="statusClass(agreement.risk_snapshot?.risk_level)">{{ agreement.risk_snapshot?.risk_level || 'low' }}</span>
          <span class="risk-score">Score: {{ agreement.risk_snapshot?.risk_score || 0 }}</span>
        </p>
      </div>
    </section>

    <p *ngIf="loading" class="loading">Loading agreement…</p>
    <p *ngIf="error" class="error">{{ error }}</p>
  `,
  styles: [`
    :host { display: block; }
    .agreement-page {
      position: relative;
      padding: 1.2rem;
      border-radius: 18px;
      background: radial-gradient(circle at top left, #122347 0%, #0a1531 45%, #050d21 100%);
      color: #e7ecff;
      border: 1px solid rgba(94, 145, 255, 0.2);
      overflow: hidden;
    }
    .ambient-glow {
      position: absolute;
      width: 440px;
      height: 440px;
      border-radius: 50%;
      right: -160px;
      top: -180px;
      background: radial-gradient(circle, rgba(47, 234, 255, .18), transparent 68%);
      pointer-events: none;
    }
    .page-header {
      position: relative;
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }
    .hero-pill {
      display: inline-flex;
      align-items: center;
      gap: .45rem;
      margin: 0 0 .55rem;
      padding: .32rem .75rem;
      border-radius: 999px;
      background: rgba(61, 112, 244, .18);
      border: 1px solid rgba(120, 157, 255, .35);
      font-size: .78rem;
      letter-spacing: .04em;
      text-transform: uppercase;
      color: #cfe3ff;
    }
    h2 { margin: 0; font-size: 1.65rem; color: #f5f8ff; }
    .subtitle {
      margin: .5rem 0 .25rem;
      display: flex;
      flex-wrap: wrap;
      gap: .65rem;
      color: #c3d5ff;
      font-size: .93rem;
    }
    .balance { margin: 0; color: #96e6ff; font-weight: 600; }

    .actions { display: flex; flex-wrap: wrap; gap: .55rem; align-items: flex-start; }
    .btn {
      border: 1px solid transparent;
      border-radius: 10px;
      padding: .5rem .78rem;
      font-weight: 700;
      letter-spacing: .01em;
      cursor: pointer;
      transition: all .18s ease;
      color: #fff;
      background: #294181;
    }
    .btn:disabled { opacity: .6; cursor: not-allowed; }
    .btn-primary {
      background: linear-gradient(135deg, #3385ff 0%, #36d2ff 100%);
      box-shadow: 0 10px 18px rgba(31, 128, 255, .26);
    }
    .btn-danger {
      background: linear-gradient(135deg, #ff4f88 0%, #ff6b4b 100%);
      box-shadow: 0 10px 18px rgba(255, 98, 134, .24);
    }
    .btn-ghost {
      background: rgba(92, 122, 201, .24);
      border-color: rgba(133, 167, 255, .42);
      color: #d9e4ff;
    }
    .link-btn { text-decoration: none; display: inline-flex; align-items: center; }

    .section { margin-top: .95rem; position: relative; }
    .glass-card {
      padding: 1rem;
      border-radius: 14px;
      background: rgba(9, 23, 53, .63);
      border: 1px solid rgba(111, 151, 255, .22);
      backdrop-filter: blur(6px);
    }
    h3 { margin: 0 0 .75rem; color: #eef4ff; font-size: 1rem; }

    .contract-row,
    .manual-row {
      display: flex;
      flex-wrap: wrap;
      gap: .6rem;
      align-items: center;
    }
    input[type="number"],
    input[type="text"],
    input[type="file"] {
      background: rgba(10, 24, 54, .7);
      color: #e9efff;
      border: 1px solid rgba(132, 168, 255, .35);
      border-radius: 10px;
      padding: .5rem .65rem;
    }

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
    .status-pill.active,
    .status-pill.paid,
    .status-pill.low {
      background: rgba(30, 194, 136, .2);
      border-color: rgba(39, 226, 156, .35);
      color: #8bffd4;
    }
    .status-pill.pending,
    .status-pill.medium,
    .status-pill.partial {
      background: rgba(255, 187, 64, .18);
      border-color: rgba(255, 194, 73, .42);
      color: #ffe39f;
    }
    .status-pill.terminated,
    .status-pill.overdue,
    .status-pill.high {
      background: rgba(255, 92, 137, .18);
      border-color: rgba(255, 116, 156, .46);
      color: #ffc0d3;
    }
    .risk-score { margin-left: .5rem; color: #bfd1ff; }

    .loading, .error { margin-top: 1rem; }
    .loading { color: #9ec6ff; }
    .error { color: #ff8bb0; }

    @media (max-width: 900px) {
      .agreement-page { padding: 1rem; }
      .ai-table { display: block; overflow-x: auto; }
    }
  `]
})
export class LeaseAgreementDetailComponent implements OnInit {
  agreement: any;
  loading = false;
  error = '';
  selectedFile: File | null = null;
  manual: { amount_paid: number | null; reference_number: string } = { amount_paid: null, reference_number: '' };

  constructor(private route: ActivatedRoute, private router: Router, private lease: LeaseFinancingService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.loading = true;
    this.lease.getAgreement(id).subscribe({
      next: (res) => { this.agreement = res; this.loading = false; },
      error: (err) => { this.error = err?.error?.error || 'Failed to load agreement'; this.loading = false; }
    });
  }

  toEdit(): void { this.router.navigate(['/finance/lease-to-own', this.agreement.id, 'edit']); }

  activate(): void { this.lease.activateAgreement(this.agreement.id).subscribe({ next: () => this.load() }); }
  terminate(): void { this.lease.terminateAgreement(this.agreement.id, { reason: 'manual' }).subscribe({ next: () => this.load() }); }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files && input.files.length ? input.files[0] : null;
  }

  uploadContract(): void {
    if (!this.selectedFile) return;
    this.lease.uploadContract(this.agreement.id, this.selectedFile).subscribe({ next: () => this.load() });
  }

  manualPayment(): void {
    this.lease.recordManualPayment(this.agreement.id, this.manual).subscribe({ next: () => {
      this.manual = { amount_paid: null, reference_number: '' };
      this.load();
    } });
  }

  statusClass(status?: string): string {
    return (status || '').toLowerCase();
  }
}

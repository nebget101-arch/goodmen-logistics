import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LeaseFinancingService } from '../../lease-financing.service';

@Component({
  selector: 'app-lease-agreement-detail',
  template: `
    <section class="card" *ngIf="agreement">
      <header class="row">
        <h2>Agreement {{ agreement.agreement_number }}</h2>
        <div class="actions">
          <button type="button" (click)="activate()" [disabled]="agreement.status==='active' || agreement.status==='completed'">Activate</button>
          <button type="button" (click)="terminate()" [disabled]="agreement.status==='terminated' || agreement.status==='completed'">Terminate</button>
          <button type="button" (click)="toEdit()">Edit</button>
        </div>
      </header>

      <p><strong>Status:</strong> {{ agreement.status }} | <strong>Driver:</strong> {{ agreement.driver_name || agreement.driver_id }} | <strong>Truck:</strong> {{ agreement.truck_label || agreement.truck_id }}</p>
      <p><strong>Remaining Balance:</strong> {{ agreement.remaining_balance | number:'1.2-2' }}</p>

      <div class="section">
        <h3>Contract</h3>
        <input type="file" (change)="onFile($event)" />
        <button type="button" (click)="uploadContract()" [disabled]="!selectedFile">Upload</button>
        <a *ngIf="agreement.document_download_url" [href]="agreement.document_download_url" target="_blank" rel="noreferrer">Download Contract</a>
      </div>

      <div class="section">
        <h3>Payment Schedule</h3>
        <table>
          <thead><tr><th>#</th><th>Due</th><th>Amount Due</th><th>Paid</th><th>Remaining</th><th>Status</th></tr></thead>
          <tbody>
            <tr *ngFor="let s of agreement.schedule">
              <td>{{ s.installment_number }}</td><td>{{ s.due_date }}</td><td>{{ s.amount_due | number:'1.2-2' }}</td><td>{{ s.amount_paid | number:'1.2-2' }}</td><td>{{ s.remaining_due | number:'1.2-2' }}</td><td>{{ s.status }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="section">
        <h3>Manual Payment</h3>
        <input type="number" [(ngModel)]="manual.amount_paid" placeholder="Amount" />
        <input type="text" [(ngModel)]="manual.reference_number" placeholder="Reference" />
        <button type="button" (click)="manualPayment()">Record Payment</button>
      </div>

      <div class="section">
        <h3>Risk</h3>
        <p>Risk: {{ agreement.risk_snapshot?.risk_level || 'low' }} ({{ agreement.risk_snapshot?.risk_score || 0 }})</p>
      </div>
    </section>

    <p *ngIf="loading">Loading agreement…</p>
    <p *ngIf="error" class="error">{{ error }}</p>
  `,
  styles: [`.card{padding:1rem}.row{display:flex;justify-content:space-between;align-items:center}.actions{display:flex;gap:.5rem}.section{margin-top:1rem}table{width:100%;border-collapse:collapse}th,td{padding:.4rem;border-bottom:1px solid #e8eef8}.error{color:#c33}`]
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
}

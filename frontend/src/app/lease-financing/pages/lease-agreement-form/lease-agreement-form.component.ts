import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LeaseFinancingService } from '../../lease-financing.service';

@Component({
  selector: 'app-lease-agreement-form',
  template: `
    <section class="card">
      <h2>{{ isEdit ? 'Edit' : 'Create' }} Lease Agreement</h2>
      <div class="grid">
        <label>Driver ID <input [(ngModel)]="model.driver_id" /></label>
        <label>Truck ID <input [(ngModel)]="model.truck_id" /></label>
        <label>Start Date <input type="date" [(ngModel)]="model.agreement_start_date" /></label>
        <label>Purchase Price <input type="number" [(ngModel)]="model.purchase_price" /></label>
        <label>Down Payment <input type="number" [(ngModel)]="model.down_payment" /></label>
        <label>Interest Rate (%) <input type="number" [(ngModel)]="model.interest_rate" /></label>
        <label>Term Months <input type="number" [(ngModel)]="model.term_months" /></label>
        <label>Frequency
          <select [(ngModel)]="model.payment_frequency">
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label>Payment Amount Override <input type="number" [(ngModel)]="model.payment_amount" /></label>
        <label>Balloon Payment <input type="number" [(ngModel)]="model.balloon_payment" /></label>
        <label>Grace Period Days <input type="number" [(ngModel)]="model.grace_period_days" /></label>
        <label>Auto Deduction <input type="checkbox" [(ngModel)]="model.auto_deduction_enabled" /></label>
      </div>
      <label>Notes <textarea rows="3" [(ngModel)]="model.notes"></textarea></label>
      <div class="actions">
        <button type="button" (click)="save()">Save</button>
        <button type="button" (click)="cancel()">Cancel</button>
      </div>
      <p *ngIf="error" class="error">{{ error }}</p>
    </section>
  `,
  styles: [`.card{padding:1rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.6rem}label{display:grid;gap:.2rem}.actions{display:flex;gap:.5rem;margin-top:.8rem}.error{color:#c33}`]
})
export class LeaseAgreementFormComponent implements OnInit {
  isEdit = false;
  id = '';
  error = '';
  model: any = {
    driver_id: '',
    truck_id: '',
    agreement_start_date: '',
    purchase_price: 0,
    down_payment: 0,
    interest_rate: 0,
    term_months: 36,
    payment_frequency: 'weekly',
    payment_amount: null,
    balloon_payment: 0,
    grace_period_days: 3,
    auto_deduction_enabled: true,
    notes: '',
    allow_payment_override: true,
  };

  constructor(private lease: LeaseFinancingService, private route: ActivatedRoute, private router: Router) {}

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') || '';
    this.isEdit = !!this.id;
    if (this.isEdit) {
      this.lease.getAgreement(this.id).subscribe({ next: (res) => this.model = { ...this.model, ...res } });
    }
  }

  save(): void {
    const req = this.isEdit ? this.lease.updateAgreement(this.id, this.model) : this.lease.createAgreement(this.model);
    req.subscribe({
      next: (res: any) => this.router.navigate(['/finance/lease-to-own', res.id || this.id]),
      error: (err) => this.error = err?.error?.error || 'Failed to save agreement'
    });
  }

  cancel(): void { this.router.navigate(['/finance/lease-to-own']); }
}

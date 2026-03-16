import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LeaseFinancingService } from '../../lease-financing.service';

@Component({
  selector: 'app-lease-agreement-form',
  template: `
    <section class="agreement-form-page">
      <div class="ambient-glow"></div>

      <header class="page-header">
        <p class="hero-pill">🤖 AI-guided financing workflow</p>
        <h2>{{ isEdit ? 'Edit' : 'Create' }} Lease Agreement</h2>
        <p class="subtitle">Configure structure, schedule, and payment controls for this agreement.</p>
      </header>

      <div class="glass-card">
        <h3>📋 Agreement Profile</h3>
        <div class="grid">
          <label class="field">
            <span>Driver ID</span>
            <input [(ngModel)]="model.driver_id" />
          </label>
          <label class="field">
            <span>Truck ID</span>
            <input [(ngModel)]="model.truck_id" />
          </label>
          <label class="field">
            <span>Start Date</span>
            <input type="date" [(ngModel)]="model.agreement_start_date" />
          </label>
          <label class="field">
            <span>Purchase Price</span>
            <input type="number" [(ngModel)]="model.purchase_price" />
          </label>
          <label class="field">
            <span>Down Payment</span>
            <input type="number" [(ngModel)]="model.down_payment" />
          </label>
          <label class="field">
            <span>Interest Rate (%)</span>
            <input type="number" [(ngModel)]="model.interest_rate" />
          </label>
          <label class="field">
            <span>Term Months</span>
            <input type="number" [(ngModel)]="model.term_months" />
          </label>
          <label class="field">
            <span>Frequency</span>
            <select [(ngModel)]="model.payment_frequency">
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label class="field">
            <span>Payment Amount Override</span>
            <input type="number" [(ngModel)]="model.payment_amount" />
          </label>
          <label class="field">
            <span>Balloon Payment</span>
            <input type="number" [(ngModel)]="model.balloon_payment" />
          </label>
          <label class="field">
            <span>Grace Period Days</span>
            <input type="number" [(ngModel)]="model.grace_period_days" />
          </label>
          <label class="field toggle-field">
            <span>Auto Deduction</span>
            <input type="checkbox" [(ngModel)]="model.auto_deduction_enabled" />
          </label>
        </div>
      </div>

      <div class="glass-card notes-block">
        <h3>📝 Notes</h3>
        <label class="field">
          <span>Internal notes</span>
          <textarea rows="4" [(ngModel)]="model.notes"></textarea>
        </label>
      </div>

      <div class="actions">
        <button type="button" class="btn btn-primary" (click)="save()">💾 Save</button>
        <button type="button" class="btn btn-ghost" (click)="cancel()">↩ Cancel</button>
      </div>

      <p *ngIf="error" class="error">{{ error }}</p>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .agreement-form-page {
      position: relative;
      padding: 1.2rem;
      border-radius: 18px;
      background: radial-gradient(circle at top left, #112345 0%, #0a1633 48%, #060d1f 100%);
      border: 1px solid rgba(93, 144, 255, 0.2);
      color: #e6edff;
      overflow: hidden;
    }
    .ambient-glow {
      position: absolute;
      right: -170px;
      top: -170px;
      width: 430px;
      height: 430px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(45, 229, 255, .18), transparent 68%);
      pointer-events: none;
    }
    .page-header { position: relative; margin-bottom: .95rem; }
    .hero-pill {
      display: inline-flex;
      margin: 0 0 .55rem;
      padding: .33rem .75rem;
      border-radius: 999px;
      background: rgba(61, 112, 244, .18);
      border: 1px solid rgba(120, 157, 255, .35);
      font-size: .78rem;
      letter-spacing: .04em;
      text-transform: uppercase;
      color: #d0e4ff;
    }
    h2 { margin: 0; font-size: 1.65rem; color: #f4f8ff; }
    .subtitle { margin: .45rem 0 0; color: #bcd1ff; }

    .glass-card {
      position: relative;
      margin-top: .95rem;
      padding: 1rem;
      border-radius: 14px;
      background: rgba(9, 23, 53, .62);
      border: 1px solid rgba(111, 151, 255, .22);
      backdrop-filter: blur(6px);
    }
    h3 { margin: 0 0 .75rem; color: #edf3ff; font-size: 1rem; }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: .7rem;
    }
    .field {
      display: grid;
      gap: .28rem;
      color: #d5e3ff;
      font-size: .9rem;
    }
    .field > span {
      font-size: .78rem;
      letter-spacing: .04em;
      text-transform: uppercase;
      color: #a8c1ef;
      font-weight: 700;
    }
    input,
    select,
    textarea {
      width: 100%;
      background: rgba(10, 24, 54, .76);
      color: #e9f0ff;
      border: 1px solid rgba(132, 168, 255, .36);
      border-radius: 10px;
      padding: .58rem .68rem;
      outline: none;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    input:focus,
    select:focus,
    textarea:focus {
      border-color: rgba(81, 190, 255, .78);
      box-shadow: 0 0 0 3px rgba(63, 170, 255, .18);
    }
    input[type="checkbox"] {
      width: 18px;
      height: 18px;
      margin-top: .35rem;
      accent-color: #3ebeff;
    }
    .toggle-field {
      align-content: start;
      justify-items: start;
    }
    .notes-block textarea { min-height: 92px; resize: vertical; }

    .actions {
      display: flex;
      gap: .55rem;
      margin-top: 1rem;
      flex-wrap: wrap;
    }
    .btn {
      border: 1px solid transparent;
      border-radius: 10px;
      padding: .56rem .82rem;
      font-weight: 700;
      letter-spacing: .01em;
      cursor: pointer;
      transition: all .18s ease;
      color: #fff;
      background: #294181;
    }
    .btn-primary {
      background: linear-gradient(135deg, #3385ff 0%, #36d2ff 100%);
      box-shadow: 0 10px 18px rgba(31, 128, 255, .26);
    }
    .btn-ghost {
      background: rgba(92, 122, 201, .24);
      border-color: rgba(133, 167, 255, .42);
      color: #d9e4ff;
    }

    .error {
      margin-top: .75rem;
      color: #ff9abc;
      font-weight: 600;
    }

    @media (max-width: 900px) {
      .agreement-form-page { padding: 1rem; }
    }
  `]
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

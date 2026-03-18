import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { TrialStateService, TrialState } from '../shared/services/trial-state.service';
import { PaymentMethodFormComponent } from './payment-method-form/payment-method-form.component';
import { ApiService } from '../services/api.service';

@Component({
  selector: 'app-billing',
  templateUrl: './billing.component.html',
  styleUrls: ['./billing.component.scss']
})
export class BillingComponent implements OnInit, OnDestroy {
  state: TrialState | null = null;
  loading = true;
  removing = false;
  removeError = '';
  removeSuccess = '';

  private sub?: Subscription;

  constructor(
    private readonly trialState: TrialStateService,
    private readonly api: ApiService,
    private readonly dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.sub = this.trialState.state$.subscribe(s => {
      this.state = s;
      this.loading = false;
    });
    // Always force a fresh fetch when opening the billing page
    this.trialState.refresh();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  get isInTrial(): boolean {
    return this.state?.trialStatus === 'trial';
  }

  get isExpired(): boolean {
    return this.state?.trialStatus === 'expired';
  }

  get isConverted(): boolean {
    return this.state?.trialStatus === 'converted';
  }

  openPaymentDialog(): void {
    const dialogRef = this.dialog.open(PaymentMethodFormComponent, {
      width: '540px',
      maxWidth: '96vw',
      disableClose: false,
      panelClass: 'payment-method-dialog'
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      if (result?.cardSaved) {
        this.trialState.refresh();
      }
    });
  }

  async removeCard(): Promise<void> {
    this.removeError = '';
    this.removeSuccess = '';
    this.removing = true;

    try {
      await firstValueFrom(this.api.removeBillingPaymentMethod());
      this.removeSuccess = 'Payment method removed.';
      this.trialState.refresh();
    } catch (err: any) {
      this.removeError = err?.error?.error || err?.message || 'Failed to remove payment method.';
    } finally {
      this.removing = false;
    }
  }
}

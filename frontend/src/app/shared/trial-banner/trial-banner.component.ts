import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { TrialStateService, TrialState } from '../services/trial-state.service';
import { PaymentMethodFormComponent } from '../../billing/payment-method-form/payment-method-form.component';

@Component({
  selector: 'app-trial-banner',
  templateUrl: './trial-banner.component.html',
  styleUrls: ['./trial-banner.component.scss']
})
export class TrialBannerComponent implements OnInit, OnDestroy {
  state: TrialState | null = null;
  private sub?: Subscription;

  constructor(
    private readonly trialState: TrialStateService,
    private readonly dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.sub = this.trialState.state$.subscribe(s => { this.state = s; });
    this.trialState.load();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** Returns the display variant for the banner, or 'hidden' if it should not render. */
  get bannerVariant(): 'state-a' | 'state-b' | 'state-c' | 'hidden' {
    const s = this.state;
    if (!s || !s.trialStatus) return 'hidden';
    if (s.trialStatus === 'converted') return 'hidden';
    if (s.trialStatus === 'expired') return 'state-c';
    if (s.trialStatus === 'trial') {
      return s.hasPaymentMethod ? 'state-b' : 'state-a';
    }
    return 'hidden';
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
}

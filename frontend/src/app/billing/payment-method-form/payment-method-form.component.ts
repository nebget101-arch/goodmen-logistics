import { Component, ElementRef, EventEmitter, OnDestroy, OnInit, Optional, Output, ViewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { loadStripe, Stripe, StripeCardElement, StripeElements } from '@stripe/stripe-js';
import { MatDialogRef } from '@angular/material/dialog';
import { ApiService } from '../../services/api.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-payment-method-form',
  templateUrl: './payment-method-form.component.html',
  styleUrls: ['./payment-method-form.component.scss']
})
export class PaymentMethodFormComponent implements OnInit, OnDestroy {
  @Output() cardSaved = new EventEmitter<void>();

  @ViewChild('cardElementRef', { static: false }) cardElementRef?: ElementRef<HTMLDivElement>;

  loading = true;
  saving = false;
  removing = false;
  error = '';
  success = '';

  trialStatus: any = null;
  planAmount: number | null = null;

  hasCard = false;
  cardBrand = '';
  cardLast4 = '';
  cardExpMonth: number | null = null;
  cardExpYear: number | null = null;

  private stripe: Stripe | null = null;
  private elements: StripeElements | null = null;
  private cardElement: StripeCardElement | null = null;
  private clientSecret = '';

  constructor(
    private readonly api: ApiService,
    @Optional() private readonly dialogRef?: MatDialogRef<PaymentMethodFormComponent>
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadState();
  }

  ngOnDestroy(): void {
    if (this.cardElement) {
      this.cardElement.destroy();
      this.cardElement = null;
    }
  }

  async saveCard(): Promise<void> {
    this.error = '';
    this.success = '';

    if (!this.stripe || !this.cardElement || !this.clientSecret) {
      this.error = 'Card form is not ready yet. Please refresh and try again.';
      return;
    }

    this.saving = true;

    try {
      const result = await this.stripe.confirmCardSetup(this.clientSecret, {
        payment_method: {
          card: this.cardElement
        }
      });

      if (result.error) {
        this.error = result.error.message || 'Unable to save card details.';
        this.saving = false;
        return;
      }

      const paymentMethodId = String(result.setupIntent?.payment_method || '').trim();
      if (!paymentMethodId) {
        this.error = 'Stripe did not return a payment method ID.';
        this.saving = false;
        return;
      }

      await firstValueFrom(this.api.confirmBillingPaymentMethod(paymentMethodId));
      await this.loadPaymentMethod();
      await this.createSetupIntent();

      this.success = 'Payment method saved successfully.';
      this.cardSaved.emit();
      if (this.dialogRef) {
        this.dialogRef.close({ cardSaved: true });
      }
    } catch (err: any) {
      this.error = err?.error?.error || err?.message || 'Failed to save payment method.';
    } finally {
      this.saving = false;
    }
  }

  async removeCard(): Promise<void> {
    this.error = '';
    this.success = '';
    this.removing = true;

    try {
      await firstValueFrom(this.api.removeBillingPaymentMethod());
      this.hasCard = false;
      this.cardBrand = '';
      this.cardLast4 = '';
      this.cardExpMonth = null;
      this.cardExpYear = null;
      this.success = 'Saved card removed.';
    } catch (err: any) {
      this.error = err?.error?.error || err?.message || 'Failed to remove payment method.';
    } finally {
      this.removing = false;
    }
  }

  private async loadState(): Promise<void> {
    this.loading = true;
    this.error = '';

    try {
      const statusRes = await firstValueFrom(this.api.getBillingTrialStatus());
      this.trialStatus = statusRes?.data || null;
      this.planAmount = Number.isFinite(Number(this.trialStatus?.planAmount))
        ? Number(this.trialStatus.planAmount)
        : null;

      await this.loadPaymentMethod();
      await this.initStripe();
      await this.createSetupIntent();
      this.mountCardElement();
    } catch (err: any) {
      this.error = err?.error?.error || err?.message || 'Failed to initialize billing setup.';
    } finally {
      this.loading = false;
    }
  }

  private async loadPaymentMethod(): Promise<void> {
    const res = await firstValueFrom(this.api.getBillingPaymentMethod());
    const data = res?.data || {};

    this.hasCard = Boolean(data?.hasCard);
    this.cardBrand = String(data?.brand || '').trim();
    this.cardLast4 = String(data?.last4 || '').trim();
    this.cardExpMonth = Number.isFinite(Number(data?.expMonth)) ? Number(data.expMonth) : null;
    this.cardExpYear = Number.isFinite(Number(data?.expYear)) ? Number(data.expYear) : null;
  }

  private async initStripe(): Promise<void> {
    const key = String((environment as any).STRIPE_PUBLISHABLE_KEY || (environment as any).stripePublishableKey || '').trim();
    if (!key) {
      throw new Error('Missing Stripe publishable key in environment settings.');
    }

    this.stripe = await loadStripe(key);
    if (!this.stripe) {
      throw new Error('Failed to initialize Stripe.');
    }

    this.elements = this.stripe.elements();
  }

  private async createSetupIntent(): Promise<void> {
    const res = await firstValueFrom(this.api.createBillingSetupIntent());
    this.clientSecret = String(res?.data?.clientSecret || '').trim();

    if (!this.clientSecret) {
      throw new Error('Failed to create setup intent.');
    }
  }

  private mountCardElement(): void {
    if (!this.elements) {
      throw new Error('Stripe Elements was not initialized.');
    }

    const mountNode = this.cardElementRef?.nativeElement;
    if (!mountNode) return;

    if (this.cardElement) {
      this.cardElement.unmount();
      this.cardElement.destroy();
      this.cardElement = null;
    }

    this.cardElement = this.elements.create('card', {
      hidePostalCode: true,
      style: {
        base: {
          fontSize: '16px',
          color: '#111827',
          fontFamily: 'Inter, Roboto, Arial, sans-serif'
        }
      }
    });

    this.cardElement.mount(mountNode);
  }
}

import { Component, Input, Output, EventEmitter, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { ConsentService, ConsentTemplate } from '../../../services/consent.service';

@Component({
  selector: 'app-consent-form',
  templateUrl: './consent-form.component.html',
  styleUrls: ['./consent-form.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConsentFormComponent implements OnInit {
  @Input() consentKey = '';
  @Input() packetId = '';
  @Input() token = '';

  @Output() signed = new EventEmitter<string>();

  loading = true;
  errorMessage: string | null = null;
  consent: ConsentTemplate | null = null;

  signerName = '';
  agreed = false;
  signing = false;
  signedSuccess = false;

  constructor(private consentService: ConsentService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadConsentTemplate();
  }

  loadConsentTemplate(): void {
    if (!this.packetId || !this.consentKey || !this.token) {
      this.loading = false;
      this.errorMessage = 'Missing consent parameters.';
      return;
    }
    this.consentService.loadConsent(this.packetId, this.consentKey, this.token).subscribe({
      next: (template) => {
        this.loading = false;
        this.consent = template ?? null;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err?.error?.message || 'Failed to load consent form.';
        this.cdr.markForCheck();
      }
    });
  }

  get canSign(): boolean {
    return !!(this.signerName.trim() && this.agreed && !this.signing && !this.signedSuccess);
  }

  submitSignature(): void {
    if (!this.canSign || !this.packetId || !this.token) return;
    this.signing = true;
    this.errorMessage = null;

    this.consentService
      .signConsent(this.packetId, this.consentKey, this.token, {
        signerName: this.signerName.trim(),
        agreed: true,
        signedAt: new Date().toISOString()
      })
      .subscribe({
        next: () => {
          this.signing = false;
          this.signedSuccess = true;
          this.signed.emit(this.consentKey);
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.signing = false;
          this.errorMessage = err?.error?.message || 'Failed to submit signature. Please try again.';
          this.cdr.markForCheck();
        }
      });
  }
}

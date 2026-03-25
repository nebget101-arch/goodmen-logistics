import { Component, Input, Output, EventEmitter, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { ConsentService, ConsentTemplate, ConsentCapturedFields } from '../../../services/consent.service';

export interface UsState {
  code: string;
  name: string;
}

export const US_STATES: UsState[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  { code: 'DC', name: 'District of Columbia' }
];

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
  @Input() requiresSignature = true;
  @Input() captureFields: string[] = [];

  @Output() signed = new EventEmitter<string>();

  loading = true;
  errorMessage: string | null = null;
  consent: ConsentTemplate | null = null;

  // Signature fields
  signerName = '';
  agreed = false;
  signing = false;
  signedSuccess = false;
  signedDate: string | null = null;

  // Capture fields
  capturedFullName = '';
  capturedDateOfBirth = '';
  capturedSsnLast4 = '';
  capturedDriversLicenseNumber = '';
  capturedStateOfIssue = '';

  usStates = US_STATES;

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

  hasCaptureField(field: string): boolean {
    return this.captureFields.includes(field);
  }

  get hasCaptureFields(): boolean {
    return this.captureFields.length > 0;
  }

  get canSign(): boolean {
    if (this.signing || this.signedSuccess) return false;
    if (!this.requiresSignature) return true;
    if (!this.signerName.trim() || !this.agreed) return false;
    // Validate required capture fields
    if (this.hasCaptureField('fullName') && !this.capturedFullName.trim()) return false;
    if (this.hasCaptureField('dateOfBirth') && !this.capturedDateOfBirth) return false;
    if (this.hasCaptureField('ssnLast4') && this.capturedSsnLast4.length !== 4) return false;
    if (this.hasCaptureField('driversLicenseNumber') && !this.capturedDriversLicenseNumber.trim()) return false;
    if (this.hasCaptureField('stateOfIssue') && !this.capturedStateOfIssue) return false;
    return true;
  }

  get todayDisplay(): string {
    return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  onSsnLast4Input(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.capturedSsnLast4 = input.value.replace(/\D/g, '').slice(0, 4);
    input.value = this.capturedSsnLast4;
  }

  private buildCapturedFields(): ConsentCapturedFields | undefined {
    if (!this.hasCaptureFields) return undefined;
    const fields: ConsentCapturedFields = {};
    if (this.hasCaptureField('fullName')) fields.fullName = this.capturedFullName.trim();
    if (this.hasCaptureField('dateOfBirth')) fields.dateOfBirth = this.capturedDateOfBirth;
    if (this.hasCaptureField('ssnLast4')) fields.ssnLast4 = this.capturedSsnLast4;
    if (this.hasCaptureField('driversLicenseNumber')) fields.driversLicenseNumber = this.capturedDriversLicenseNumber.trim();
    if (this.hasCaptureField('stateOfIssue')) fields.stateOfIssue = this.capturedStateOfIssue;
    return fields;
  }

  submitSignature(): void {
    if (!this.canSign || !this.packetId || !this.token) return;
    this.signing = true;
    this.errorMessage = null;

    const signedAt = new Date().toISOString();

    this.consentService
      .signConsent(this.packetId, this.consentKey, this.token, {
        signerName: this.requiresSignature ? this.signerName.trim() : 'ACKNOWLEDGED',
        agreed: true,
        signedAt,
        capturedFields: this.buildCapturedFields()
      })
      .subscribe({
        next: () => {
          this.signing = false;
          this.signedSuccess = true;
          this.signedDate = new Date().toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
          });
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

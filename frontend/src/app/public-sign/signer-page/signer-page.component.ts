import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PublicSignService } from '../public-sign.service';
import { AgreementField } from '../../agreements/agreement.model';
import {
  SignerView,
  SignerField,
  SignSubmission,
  SignatureType,
  SignatureRequestStatus,
  DEFAULT_CONSENT_TEXT,
  isComplete,
  isSignable,
} from '../../agreements/signature-request.model';
import { SignatureValue } from '../signature-capture/signature-capture.component';

/**
 * FN-1798 — public, unauthenticated signer interface (`/sign/:token`).
 *
 * Loads the agreement for the tokenized request, renders the document details
 * and internal (read-only) values, lets the signer complete their assigned
 * fields, apply an e-signature (typed or drawn), consent, and submit. Handles
 * expired / voided / already-signed tokens gracefully and is idempotent on a
 * link that has already been signed.
 */
@Component({
  selector: 'app-signer-page',
  templateUrl: './signer-page.component.html',
  styleUrls: ['./signer-page.component.css'],
})
export class SignerPageComponent implements OnInit {
  token = '';
  view: SignerView | null = null;

  internalFields: SignerField[] = [];
  signerFields: SignerField[] = [];

  /** Signer field values keyed by `fieldKey`. */
  values: Record<string, string | boolean> = {};

  signerName = '';
  signature: SignatureValue | null = null;
  consent = false;

  loading = true;
  submitting = false;
  loadError = '';
  submitError = '';

  /** Set after a successful submit (or when re-opening an already-signed link). */
  done = false;
  signedPdfUrl: string | null = null;

  readonly consentTextFallback = DEFAULT_CONSENT_TEXT;
  readonly isComplete = isComplete;

  constructor(
    private route: ActivatedRoute,
    private publicSign: PublicSignService
  ) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    if (!this.token) {
      this.loading = false;
      this.loadError = 'This signing link is missing or invalid. Please use the link sent to you.';
      return;
    }
    this.load();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.publicSign.getSignerView(this.token).subscribe({
      next: (res) => {
        this.view = res;
        const fields = (res.fields || []).slice();
        this.internalFields = fields.filter((f) => f.role === 'internal');
        // Signature/initials blocks are fulfilled by the signature-capture
        // component, not a text input — exclude them from the editable list.
        this.signerFields = fields.filter(
          (f) => f.role === 'signer' && !this.isSignatureField(f)
        );
        for (const f of this.signerFields) {
          this.values[f.fieldKey] = f.fieldType === 'checkbox' ? false : '';
        }
        this.signerName = res.signerName || '';
        // Idempotent: a link that's already signed shows the confirmation.
        if (isComplete(res.status)) {
          this.done = true;
          this.signedPdfUrl = res.signedPdfUrl || null;
        }
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.loadError =
          err?.error?.message ||
          err?.error?.error ||
          'We could not load this agreement. The link may be invalid or expired.';
      },
    });
  }

  // ── Token state helpers (drive which screen shows) ──────────────────────
  get status(): SignatureRequestStatus | null {
    return this.view?.status ?? null;
  }
  get isExpired(): boolean {
    return this.status === 'expired';
  }
  get isVoided(): boolean {
    return this.status === 'voided';
  }
  /** The signer can fill + sign only in `sent`/`viewed` states. */
  get canSign(): boolean {
    return !!this.status && isSignable(this.status);
  }

  get consentText(): string {
    return this.view?.consentText || this.consentTextFallback;
  }

  onSignatureChange(sig: SignatureValue | null): void {
    this.signature = sig;
  }

  private hasValue(f: AgreementField): boolean {
    const v = this.values[f.fieldKey];
    if (f.fieldType === 'checkbox') return v === true;
    return typeof v === 'string' ? v.trim().length > 0 : v != null;
  }

  /** Signature blocks are captured separately, not as form fields. */
  isSignatureField(f: AgreementField): boolean {
    return f.fieldType === 'signature' || f.fieldType === 'initials';
  }

  /** The field map has no per-field `required` flag — every placed field except
   *  a checkbox (whose unchecked state is a valid answer) must be completed. */
  isRequired(f: AgreementField): boolean {
    return f.fieldType !== 'checkbox';
  }

  get canSubmit(): boolean {
    if (this.submitting || !this.canSign) return false;
    if (!this.signerName.trim()) return false;
    if (!this.signature || !this.signature.value) return false;
    if (!this.consent) return false;
    return this.signerFields.filter((f) => this.isRequired(f)).every((f) => this.hasValue(f));
  }

  submit(): void {
    if (!this.canSubmit || !this.signature) return;
    this.submitting = true;
    this.submitError = '';

    const fieldValues: Record<string, string | boolean> = {};
    for (const f of this.signerFields) {
      fieldValues[f.fieldKey] = this.values[f.fieldKey];
    }

    const payload: SignSubmission = {
      fieldValues,
      signerName: this.signerName.trim(),
      signatureValue: this.signature.value,
      signatureType: this.signature.type as SignatureType,
      consent: this.consent,
    };

    this.publicSign.submit(this.token, payload).subscribe({
      next: (res) => {
        this.submitting = false;
        this.done = true;
        this.signedPdfUrl = res.signedPdfUrl;
      },
      error: (err) => {
        this.submitting = false;
        this.submitError =
          err?.error?.message ||
          err?.error?.error ||
          'We could not submit your signature. Please try again.';
      },
    });
  }

  // ── Display helpers ─────────────────────────────────────────────────────
  /** Internal value to display read-only (checkbox → Yes/No). */
  displayValue(f: SignerField): string {
    if (f.fieldType === 'checkbox') {
      return String(f.value) === 'true' ? 'Yes' : 'No';
    }
    return (f.value as string) || '—';
  }

  inputType(type: AgreementField['fieldType']): string {
    if (type === 'date') return 'date';
    if (type === 'number') return 'number';
    return 'text';
  }

  typeIcon(type: AgreementField['fieldType']): string {
    switch (type) {
      case 'date': return 'calendar_today';
      case 'number': return 'tag';
      case 'checkbox': return 'check_box';
      case 'signature': return 'draw';
      case 'initials': return 'edit';
      case 'text':
      default: return 'text_fields';
    }
  }

  trackByField(_index: number, field: AgreementField): string {
    return field.id || field.fieldKey;
  }
}

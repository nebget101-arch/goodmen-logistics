import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AgreementService } from '../agreement.service';
import { AgreementField, AgreementTemplateDetail } from '../agreement.model';
import {
  CreateSignatureRequestPayload,
  SignatureRequest,
  SignerContact,
  statusLabel,
  isComplete,
} from '../signature-request.model';
import { EquipmentLeaseSubjectType } from '../equipment-lease-signing.model';

/**
 * FN-1798 — internal "fill & send for signature" screen.
 *
 * For a finalized (`ready`) template the carrier fills the `internal`-role
 * fields, enters the signer's contact details, then sends the request. The
 * backend (FN-1797) generates a tokenized signer link and dispatches it; we
 * surface the link + live status, and the signed-PDF download once the signer
 * completes it.
 *
 * FN-1801 — when this screen is reached with equipment-subject context
 * (`subjectType`/`subjectId` query params, set by the vehicle / equipment-owner
 * entry point), the send is routed through the equipment-lease adapter (FN-1800)
 * so the resulting signature request is linked back to that subject. No new
 * signing UI — the only change is which endpoint the send call hits.
 */
@Component({
  selector: 'app-agreement-send',
  templateUrl: './agreement-send.component.html',
  styleUrls: ['./agreement-send.component.css'],
})
export class AgreementSendComponent implements OnInit {
  templateId = '';
  template: AgreementTemplateDetail | null = null;

  /** Fields the carrier fills, keyed render order. */
  internalFields: AgreementField[] = [];
  /** Fields the signer will complete — shown read-only here for context. */
  signerFields: AgreementField[] = [];

  /** Field values keyed by `fieldKey`. */
  values: Record<string, string | boolean> = {};

  signer: SignerContact = { name: '', email: '', phone: '', role: '' };

  /** FN-1801 — equipment-subject context (optional); routes the send via FN-1800. */
  subjectType = '';
  subjectId = '';
  subjectLabel = '';

  loading = false;
  sending = false;
  refreshing = false;
  loadError = '';
  sendError = '';

  /** Populated once the request is created. */
  result: SignatureRequest | null = null;
  linkCopied = false;

  readonly statusLabel = statusLabel;
  readonly isComplete = isComplete;

  constructor(
    private agreements: AgreementService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.templateId = this.route.snapshot.paramMap.get('id') || '';
    const qp = this.route.snapshot.queryParamMap;
    this.subjectType = qp.get('subjectType') || '';
    this.subjectId = qp.get('subjectId') || '';
    this.subjectLabel = qp.get('subjectLabel') || '';
    if (this.templateId) this.load();
  }

  /** FN-1801 — true when the send should link to an equipment subject (FN-1800). */
  get hasSubjectContext(): boolean {
    return !!this.subjectType && !!this.subjectId;
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.agreements.getTemplate(this.templateId).subscribe({
      next: (res) => {
        this.template = res;
        const fields = (res.fields || [])
          .slice()
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        // Signature/initials blocks are applied by the signer, not filled here.
        this.internalFields = fields.filter(
          (f) => f.role === 'internal' && !this.isSignatureField(f)
        );
        this.signerFields = fields.filter((f) => f.role === 'signer');
        // Seed values from any AI-suggested defaults.
        for (const f of this.internalFields) {
          this.values[f.fieldKey] =
            f.fieldType === 'checkbox'
              ? f.suggestedValue === 'true'
              : f.suggestedValue ?? '';
        }
        this.loading = false;
      },
      error: (err) => {
        this.loadError = err?.error?.error || 'Could not load the template.';
        this.loading = false;
      },
    });
  }

  get isReady(): boolean {
    return this.template?.status === 'ready';
  }

  /** All `required` internal fields filled and the signer reachable. */
  get canSend(): boolean {
    if (!this.isReady || this.sending) return false;
    if (!this.signer.name.trim()) return false;
    // Need at least one delivery channel for the tokenized link.
    if (!this.signer.email?.trim() && !this.signer.phone?.trim()) return false;
    return this.internalFields
      .filter((f) => this.isRequired(f))
      .every((f) => this.hasValue(f));
  }

  private hasValue(f: AgreementField): boolean {
    const v = this.values[f.fieldKey];
    if (f.fieldType === 'checkbox') return v === true;
    return typeof v === 'string' ? v.trim().length > 0 : v != null;
  }

  /** Signature blocks are applied by the signer, not the internal user. */
  isSignatureField(f: AgreementField): boolean {
    return f.fieldType === 'signature' || f.fieldType === 'initials';
  }

  /** The field map carries no `required` flag — treat every placed field except
   *  a checkbox (unchecked is a valid answer) as required. */
  isRequired(f: AgreementField): boolean {
    return f.fieldType !== 'checkbox';
  }

  send(): void {
    if (!this.canSend) return;
    this.sending = true;
    this.sendError = '';

    // Only send the internal field values; signer fills the rest.
    const fieldValues: Record<string, string | boolean> = {};
    for (const f of this.internalFields) {
      fieldValues[f.fieldKey] = this.values[f.fieldKey];
    }

    const signer = {
      name: this.signer.name.trim(),
      email: this.signer.email?.trim() || undefined,
      phone: this.signer.phone?.trim() || undefined,
      role: this.signer.role?.trim() || undefined,
    };

    const onError = (err: any) => {
      this.sending = false;
      this.sendError = err?.error?.error || 'Could not send the request. Please try again.';
    };

    // FN-1801 — equipment-lease subject: route through the FN-1800 adapter so the
    // signing is linked back to the vehicle / equipment-owner. The response is a
    // superset of the generic create result (requestId + signerLink + status).
    if (this.hasSubjectContext) {
      this.agreements
        .startEquipmentLeaseSigning({
          subjectType: this.subjectType as EquipmentLeaseSubjectType,
          subjectId: this.subjectId,
          templateId: this.templateId,
          fieldValues,
          signer,
        })
        .subscribe({
          next: (res) => {
            this.sending = false;
            this.result = {
              requestId: res.requestId,
              status: res.status,
              signerLink: res.signerLink,
            };
          },
          error: onError,
        });
      return;
    }

    const payload: CreateSignatureRequestPayload = { fieldValues, signer };

    this.agreements.createRequest(this.templateId, payload).subscribe({
      next: (res) => {
        this.sending = false;
        this.result = res;
      },
      error: onError,
    });
  }

  /** Re-fetch status to reflect viewed/signed transitions + signed-PDF URL. */
  refreshStatus(): void {
    if (!this.result || this.refreshing) return;
    this.refreshing = true;
    this.agreements.getRequest(this.result.requestId).subscribe({
      next: (res) => {
        this.refreshing = false;
        this.result = { ...this.result, ...res };
      },
      error: () => {
        this.refreshing = false;
      },
    });
  }

  copyLink(): void {
    const link = this.result?.signerLink;
    if (!link) return;
    const done = () => {
      this.linkCopied = true;
      setTimeout(() => (this.linkCopied = false), 2000);
    };
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(done).catch(() => done());
    } else {
      done();
    }
  }

  /** Material icon for a field type (mirrors the review screen). */
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

  /** Native input type for a text-like field. */
  inputType(type: AgreementField['fieldType']): string {
    if (type === 'date') return 'date';
    if (type === 'number') return 'number';
    return 'text';
  }

  trackByField(_index: number, field: AgreementField): string {
    return field.id || field.fieldKey;
  }
}

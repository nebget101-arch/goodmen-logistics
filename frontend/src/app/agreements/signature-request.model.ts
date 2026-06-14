// FN-1798 — signature-request DTOs for the fill → send → sign flow (FN-1788).
// Mirrors the public-signing contract fixed up front in `docs/stories/FN-1788.md`
// so the frontend can build against a mock until the backend (FN-1797) lands.

import { AgreementField } from './agreement.model';

/** Lifecycle of a signature request (see FN-1788 contract). */
export type SignatureRequestStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'signed'
  | 'completed'
  | 'expired'
  | 'voided';

/** Whether the signer typed their name or drew the signature. */
export type SignatureType = 'typed' | 'drawn';

/** Contact details for the person who will sign the agreement. */
export interface SignerContact {
  name: string;
  email?: string;
  phone?: string;
  /** Human label for the signer's role on this agreement, e.g. "Lessee". */
  role?: string;
}

/**
 * Body for `POST /api/agreements/:templateId/requests`.
 * `fieldValues` is keyed by `fieldKey` and carries only the `internal`-role
 * values the carrier filled in.
 */
export interface CreateSignatureRequestPayload {
  fieldValues: Record<string, string | boolean>;
  signer: SignerContact;
}

/**
 * A signature request as returned by create (`POST .../requests`) and by
 * `GET /api/agreements/requests/:id`. `signerLink` is present on create; the
 * signed-PDF URL appears once the signer completes the request.
 */
export interface SignatureRequest {
  requestId: string;
  templateId?: string;
  status: SignatureRequestStatus;
  /** Public signing URL — present on create so the carrier can share it. */
  signerLink?: string;
  signerName?: string;
  signerEmail?: string;
  signerPhone?: string;
  signedPdfUrl?: string | null;
  sentAt?: string | null;
  viewedAt?: string | null;
  signedAt?: string | null;
  expiresAt?: string | null;
}

/**
 * A field as shown to the public signer. Extends the template field with the
 * carrier-filled `value` (read-only for `internal` fields).
 */
export interface SignerField extends AgreementField {
  value?: string | null;
}

/** Document metadata shown on the public signer page. */
export interface SignerDocument {
  name: string;
  documentType: string;
  /** Signed, time-limited URL to preview the source PDF. */
  sourceDownloadUrl?: string | null;
}

/**
 * Response of `GET /public/agreements/sign/:token`. Renders the agreement for
 * the signer: document details, the full field map (internal values read-only),
 * and the current status. When already `signed`/`completed`, `signedPdfUrl` is
 * populated so the signer can re-download their copy (idempotent open).
 */
export interface SignerView {
  document: SignerDocument;
  fields: SignerField[];
  status: SignatureRequestStatus;
  signerName?: string;
  /** Consent statement the signer must agree to before submitting. */
  consentText?: string;
  signedPdfUrl?: string | null;
  expiresAt?: string | null;
}

/** Body for `POST /public/agreements/sign/:token`. */
export interface SignSubmission {
  fieldValues: Record<string, string | boolean>;
  signerName: string;
  /** Typed name, or a data-URL PNG of the drawn signature. */
  signatureValue: string;
  signatureType: SignatureType;
  consent: boolean;
}

/** Response of a successful `POST /public/agreements/sign/:token`. */
export interface SignResult {
  status: 'signed' | 'completed';
  signedPdfUrl: string;
}

/** Default consent statement shown when the backend doesn't supply one. */
export const DEFAULT_CONSENT_TEXT =
  'By checking this box and submitting, I agree that my typed or drawn ' +
  'signature is the legal equivalent of my handwritten signature, and I ' +
  'consent to sign this agreement electronically.';

/** True for token states where the signer can still act on the request. */
export function isSignable(status: SignatureRequestStatus): boolean {
  return status === 'sent' || status === 'viewed';
}

/** True once the request has been signed (idempotent / confirmation states). */
export function isComplete(status: SignatureRequestStatus): boolean {
  return status === 'signed' || status === 'completed';
}

/** Human-readable label for a request status. */
export function statusLabel(status: SignatureRequestStatus): string {
  switch (status) {
    case 'draft': return 'Draft';
    case 'sent': return 'Sent — awaiting signature';
    case 'viewed': return 'Opened by signer';
    case 'signed': return 'Signed';
    case 'completed': return 'Completed';
    case 'expired': return 'Link expired';
    case 'voided': return 'Voided';
    default: return status;
  }
}

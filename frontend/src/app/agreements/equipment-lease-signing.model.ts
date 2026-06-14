// FN-1801 (story FN-1789) — Equipment / Motor-Carrier Lease Agreement adapter
// DTOs for the frontend. Mirrors the FN-1800 backend contract:
//
//   POST /api/agreements/equipment-lease/requests
//     body { subjectType, subjectId, templateId, fieldValues?, signer, expiresInDays? }
//     → 201 { requestId, signerLink, status, link }
//
//   GET  /api/agreements/equipment-lease/requests?subjectType=&subjectId=
//     → 200 { data: EquipmentLeaseSigning[] }  (newest first)
//
// No signing logic lives here — the adapter delegates to the generic engine
// (FN-1787/FN-1788); these types only describe the equipment linkage shape.

import { SignatureRequestStatus } from './signature-request.model';

/** Equipment subject a lease agreement can be sent for (mirrors FN-1800). */
export type EquipmentLeaseSubjectType = 'vehicle' | 'equipment_owner';

/** Body for `POST /api/agreements/equipment-lease/requests`. */
export interface StartEquipmentLeaseSigningPayload {
  subjectType: EquipmentLeaseSubjectType;
  subjectId: string;
  templateId: string;
  /** `internal`-role field values the carrier filled (keyed by `fieldKey`). */
  fieldValues?: Record<string, string | boolean>;
  signer: {
    name: string;
    email?: string;
    phone?: string;
    /** Human label for the signer's role, e.g. "Lessor". */
    role?: string;
  };
  expiresInDays?: number;
}

/**
 * The live signature request enriched onto each linkage row by FN-1800
 * (`mergeRequestIntoLink`). Carries the status the equipment record renders and
 * the signed-PDF download URL once signed.
 */
export interface EquipmentLeaseSigningRequest {
  id: string;
  status: SignatureRequestStatus;
  signerName?: string | null;
  signerEmail?: string | null;
  signerRole?: string | null;
  sentAt?: string | null;
  viewedAt?: string | null;
  signedAt?: string | null;
  expiresAt?: string | null;
  /** Signed, time-limited URL to the completed PDF; null until signed. */
  signedPdfUrl?: string | null;
}

/** One equipment-lease linkage row from the list endpoint (newest first). */
export interface EquipmentLeaseSigning {
  id: string;
  subjectType: EquipmentLeaseSubjectType;
  subjectId: string;
  signatureRequestId: string;
  documentType: string;
  createdAt: string;
  /** Null when the underlying request could not be loaded (logged server-side). */
  request: EquipmentLeaseSigningRequest | null;
}

/** Response of `POST .../equipment-lease/requests` (engine result + linkage). */
export interface StartEquipmentLeaseSigningResult {
  requestId: string;
  /** Public signing URL — present on create so the carrier can share it. */
  signerLink?: string;
  status: SignatureRequestStatus;
  /** The persisted `equipment_lease_signings` linkage DTO. */
  link?: unknown;
}

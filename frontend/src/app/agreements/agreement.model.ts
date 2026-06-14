// FN-1794 — Agreement upload + AI field-mapping review.
// These types mirror the BACKEND DTOs served by FN-1793
// (`agreement-service.js` → `mapTemplateRow` / `mapFieldRow`), which is what the
// frontend actually consumes. The raw AI detection contract (FN-1791) uses
// `key`/`type`/`bbox[]`; the backend persists and re-serializes it as the
// camelCase `fieldKey`/`fieldType` DTO below.

/** Field roles the reviewer can assign. A field is filled by the carrier
 *  (`internal`) or by the person signing the agreement (`signer`). */
export type AgreementFieldRole = 'internal' | 'signer';

/** Input control type the AI detected for a field. */
export type AgreementFieldType =
  | 'text'
  | 'date'
  | 'number'
  | 'checkbox'
  | 'signature'
  | 'initials';

/** Template lifecycle. `draft` = AI-detected, awaiting review; `ready` = finalized. */
export type AgreementTemplateStatus = 'draft' | 'ready';

/** Normalized bounding box `[x, y, width, height]` (per the AI/DB contract). */
export type AgreementFieldBBox = [number, number, number, number];

/** A single field on an agreement template, as returned by the backend. */
export interface AgreementField {
  id: string;
  templateId?: string;
  sortOrder?: number;
  /** Stable key for the field (e.g. `carrier_name`). */
  fieldKey: string;
  label: string;
  fieldType: AgreementFieldType;
  /** 1-based page the field was detected on. */
  page: number;
  bbox?: AgreementFieldBBox | null;
  /** Reviewer-assigned role. Defaults to `suggestedRole` until changed. */
  role: AgreementFieldRole;
  /** Role the AI suggested — retained so we can show "AI suggested X". */
  suggestedRole: AgreementFieldRole;
  /** Optional default/extracted value the AI proposed. */
  suggestedValue?: string | null;
  /** AI confidence as a 0–1 fraction (null when unknown). */
  confidence: number | null;
  /** Backend-computed low-confidence flag (its threshold; FN-1793). */
  lowConfidence?: boolean;
}

/** Template DTO (`mapTemplateRow`), optionally with its field map + signed URL. */
export interface AgreementTemplate {
  id: string;
  name: string;
  documentType: string;
  pageCount: number;
  status: AgreementTemplateStatus;
  sourceStorageKey?: string;
  /** Signed, time-limited URL to view the source PDF (from GET response). */
  sourceDownloadUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** A template with its ordered field map — the POST/GET/PATCH response shape. */
export interface AgreementTemplateDetail extends AgreementTemplate {
  fields: AgreementField[];
}

/** Per-field patch sent to PATCH .../fields. Backend honors only `role` + `label`. */
export interface AgreementFieldPatch {
  id: string;
  role: AgreementFieldRole;
  label: string;
}

/**
 * Below this confidence (0–1) an AI-detected field is flagged for manual review.
 * Client-side flag; the backend also emits a per-field `lowConfidence` (FN-1793).
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

export const AGREEMENT_FIELD_ROLES: AgreementFieldRole[] = ['internal', 'signer'];

/** Flip a role to the opposite of its two valid values. */
export function toggleRole(role: AgreementFieldRole): AgreementFieldRole {
  return role === 'internal' ? 'signer' : 'internal';
}

/**
 * True when a field should be flagged for review. Prefers the backend's
 * `lowConfidence` flag when present; otherwise compares `confidence` against the
 * threshold. Defensive against missing/NaN confidence — unknown counts as low.
 */
export function isLowConfidence(
  field: Pick<AgreementField, 'confidence' | 'lowConfidence'>,
  threshold: number = LOW_CONFIDENCE_THRESHOLD
): boolean {
  if (field?.lowConfidence === true) return true;
  const c = field?.confidence;
  if (c == null || !Number.isFinite(c)) return true;
  return c < threshold;
}

/** Count of fields flagged for review in a field map. */
export function countLowConfidence(
  fields: AgreementField[],
  threshold: number = LOW_CONFIDENCE_THRESHOLD
): number {
  return (fields || []).filter(f => isLowConfidence(f, threshold)).length;
}

/** Human-readable label for a role. */
export function roleLabel(role: AgreementFieldRole): string {
  return role === 'signer' ? 'Signer' : 'Internal';
}

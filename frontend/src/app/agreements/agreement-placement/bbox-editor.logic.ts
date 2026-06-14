// FN-1807 — pure coordinate-math + drag/resize/add/delete reducers for the
// visual bbox field-placement editor (story FN-1806).
//
// This module is DELIBERATELY free of Angular, the DOM, and pdf.js so the
// geometry and the edit reducers are unit-testable in isolation (the component
// is the thin, untestable-locally shell; this is where the logic lives).
//
// ── Canonical coordinate convention (shared with FN-1808 backend + FN-1797
//    signed-PDF overlay) ─────────────────────────────────────────────────────
//
//   A field `bbox` is `[x, y, width, height]` expressed in **PDF points**
//   (1 pt = 1/72 inch), with the origin at the **TOP-LEFT** of the page:
//   x grows rightward, y grows DOWNWARD. Width/height are positive.
//
//   This matches how the AI detector reports boxes and how pdf.js' default
//   viewport addresses the canvas (top-left origin), so the editor maps
//   points→pixels with a single scalar `pxPerPoint` and no axis flip.
//
//   The FN-1797 signed-PDF overlay uses pdf-lib, whose origin is BOTTOM-LEFT.
//   The agreed conversion it must apply, per page of height `H` points, is:
//
//       pdfLibX = x
//       pdfLibY = H - (y + height)      // flip the y axis
//       width/height unchanged
//
//   Keeping that flip in ONE documented place is what guarantees "a box drawn in
//   the editor lands in the same spot on the signed PDF" (FN-1806 AC). The
//   authoritative spec (owned by FN-1808) is
//   docs/design/agreements-bbox-coordinates.md.

import {
  AgreementField,
  AgreementFieldRole,
  AgreementFieldType,
  isLowConfidence,
} from '../agreement.model';

/** `[x, y, width, height]` in PDF points, top-left origin. */
export type Bbox = [number, number, number, number];

/** A page's intrinsic size in PDF points (from pdf.js `getViewport({scale:1})`). */
export interface PageGeometry {
  widthPts: number;
  heightPts: number;
}

/** A rectangle in rendered canvas pixels (CSS absolute positioning). */
export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The eight drag handles around a box. */
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * Smallest box the user can draw or shrink to, in points. Prevents zero/inverted
 * rectangles and keeps a grabbable target. ~14pt ≈ a line of small text.
 */
export const MIN_BBOX_SIZE_PTS = 14;

/** Default size (points) for a freshly added box before the user resizes it. */
export const DEFAULT_NEW_BBOX_SIZE_PTS: { width: number; height: number } = {
  width: 160,
  height: 24,
};

// ───────────────────────────────────────────────────────────────────────────
// Editor field model
// ───────────────────────────────────────────────────────────────────────────

/**
 * A field as the placement editor holds it. Extends the persisted shape with
 * client-only bookkeeping (`localId`, `op` flags) so we can serialize the right
 * updates / additions / deletions on save. Unlike the persisted `AgreementField`,
 * `bbox` is always concrete here — a field with no detected box is seeded with a
 * default so it is visible and movable.
 */
export interface PlacementField {
  /** Server id; `undefined` for a not-yet-saved, user-added box. */
  id?: string;
  /** Stable client id — survives across re-render and is the trackBy key. */
  localId: string;
  fieldKey: string;
  label: string;
  fieldType: AgreementFieldType;
  role: AgreementFieldRole;
  suggestedRole: AgreementFieldRole;
  /** 1-based page. */
  page: number;
  bbox: Bbox;
  confidence: number | null;
  lowConfidence?: boolean;
  /** User added this box in the editor (no server id yet). */
  isNew?: boolean;
  /** Tombstoned for deletion on save (kept around so it can be undone). */
  deleted?: boolean;
  /** Geometry/label/role/type changed vs. what the server returned. */
  dirty?: boolean;
}

/**
 * The save payload partitioned by operation — matches the FN-1808 PATCH body
 * `{ fields, adds, deletes, finalize }` (see
 * docs/design/agreements-bbox-coordinates.md).
 */
export interface FieldMapSavePayload {
  /** Existing fields with edited geometry/label/role. (Backend honors role/label/page/bbox.) */
  fields: Array<{
    id: string;
    role: AgreementFieldRole;
    label: string;
    fieldType: AgreementFieldType;
    page: number;
    bbox: Bbox;
  }>;
  /** User-drawn boxes (no id; manual → `confidence: null`). */
  adds: Array<{
    fieldKey: string;
    label: string;
    fieldType: AgreementFieldType;
    role: AgreementFieldRole;
    page: number;
    bbox: Bbox;
    confidence: null;
  }>;
  /** Server ids of fields the user removed. */
  deletes: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// Geometry: points ↔ pixels
// ───────────────────────────────────────────────────────────────────────────

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Map a points-space bbox to a pixel rect at the given pixels-per-point scale. */
export function bboxToPixels(bbox: Bbox, pxPerPoint: number): PixelRect {
  const [x, y, w, h] = bbox;
  return {
    left: x * pxPerPoint,
    top: y * pxPerPoint,
    width: w * pxPerPoint,
    height: h * pxPerPoint,
  };
}

/** Inverse of {@link bboxToPixels}: pixel rect → points-space bbox. */
export function pixelsToBbox(rect: PixelRect, pxPerPoint: number): Bbox {
  if (!pxPerPoint) return [0, 0, 0, 0];
  return [
    round2(rect.left / pxPerPoint),
    round2(rect.top / pxPerPoint),
    round2(rect.width / pxPerPoint),
    round2(rect.height / pxPerPoint),
  ];
}

/** Convert a pixel delta to a points delta. */
export function pxToPts(px: number, pxPerPoint: number): number {
  return pxPerPoint ? px / pxPerPoint : 0;
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(Math.max(n, lo), hi);

/**
 * Clamp a bbox to lie fully within the page and to satisfy the minimum size.
 * Position is clamped first, then the box is shrunk if it would overflow.
 */
export function clampBboxToPage(bbox: Bbox, page: PageGeometry): Bbox {
  const { widthPts: W, heightPts: H } = page;
  let [x, y, w, h] = bbox;

  w = clamp(w, MIN_BBOX_SIZE_PTS, Math.max(MIN_BBOX_SIZE_PTS, W));
  h = clamp(h, MIN_BBOX_SIZE_PTS, Math.max(MIN_BBOX_SIZE_PTS, H));
  x = clamp(x, 0, Math.max(0, W - w));
  y = clamp(y, 0, Math.max(0, H - h));

  return [round2(x), round2(y), round2(w), round2(h)];
}

/** Translate a bbox by a points delta, kept fully inside the page. */
export function moveBbox(
  bbox: Bbox,
  dxPts: number,
  dyPts: number,
  page: PageGeometry
): Bbox {
  const [x, y, w, h] = bbox;
  return clampBboxToPage([x + dxPts, y + dyPts, w, h], page);
}

/**
 * Resize a bbox by dragging `handle` by (dxPts, dyPts). Edges move
 * independently; the box is normalized to keep a positive ≥ MIN size and is
 * clamped to the page bounds.
 */
export function resizeBbox(
  bbox: Bbox,
  handle: ResizeHandle,
  dxPts: number,
  dyPts: number,
  page: PageGeometry
): Bbox {
  const [x, y, w, h] = bbox;
  let left = x;
  let top = y;
  let right = x + w;
  let bottom = y + h;

  if (handle.includes('w')) left += dxPts;
  if (handle.includes('e')) right += dxPts;
  if (handle.includes('n')) top += dyPts;
  if (handle.includes('s')) bottom += dyPts;

  // Keep the *anchored* (un-dragged) edge fixed when enforcing the min size.
  if (right - left < MIN_BBOX_SIZE_PTS) {
    if (handle.includes('w')) left = right - MIN_BBOX_SIZE_PTS;
    else right = left + MIN_BBOX_SIZE_PTS;
  }
  if (bottom - top < MIN_BBOX_SIZE_PTS) {
    if (handle.includes('n')) top = bottom - MIN_BBOX_SIZE_PTS;
    else bottom = top + MIN_BBOX_SIZE_PTS;
  }

  // Clamp edges into the page.
  left = clamp(left, 0, page.widthPts - MIN_BBOX_SIZE_PTS);
  top = clamp(top, 0, page.heightPts - MIN_BBOX_SIZE_PTS);
  right = clamp(right, left + MIN_BBOX_SIZE_PTS, page.widthPts);
  bottom = clamp(bottom, top + MIN_BBOX_SIZE_PTS, page.heightPts);

  return [round2(left), round2(top), round2(right - left), round2(bottom - top)];
}

// ───────────────────────────────────────────────────────────────────────────
// Field-collection reducers (immutable — return a new array)
// ───────────────────────────────────────────────────────────────────────────

/** Seed a missing bbox with a sensible default so every field is editable. */
function ensureBbox(bbox: AgreementField['bbox'], page: PageGeometry | null): Bbox {
  if (Array.isArray(bbox) && bbox.length === 4 && bbox.every((n) => Number.isFinite(n))) {
    return [bbox[0], bbox[1], bbox[2], bbox[3]];
  }
  const w = DEFAULT_NEW_BBOX_SIZE_PTS.width;
  const h = DEFAULT_NEW_BBOX_SIZE_PTS.height;
  // Default near the top-left margin (72pt ≈ 1in) of the page.
  const base: Bbox = [72, 72, w, h];
  return page ? clampBboxToPage(base, page) : base;
}

/**
 * Build the editor model from the server's field map. `pages` provides per-page
 * geometry (1-based index) so a field missing a bbox can be defaulted within
 * its page; pass an empty array before pages are measured.
 */
export function toPlacementFields(
  fields: AgreementField[],
  pages: PageGeometry[] = [],
  idgen: () => string = makeLocalIdGen()
): PlacementField[] {
  return (fields || []).map((f) => {
    const pageGeom = pages[(f.page || 1) - 1] || null;
    return {
      id: f.id,
      localId: idgen(),
      fieldKey: f.fieldKey,
      label: f.label,
      fieldType: f.fieldType,
      role: f.role,
      suggestedRole: f.suggestedRole,
      page: f.page || 1,
      bbox: ensureBbox(f.bbox, pageGeom),
      confidence: f.confidence,
      lowConfidence: isLowConfidence(f),
    };
  });
}

function replace(
  fields: PlacementField[],
  localId: string,
  patch: (f: PlacementField) => PlacementField
): PlacementField[] {
  return fields.map((f) => (f.localId === localId ? patch(f) : f));
}

/** Move one field's box by a points delta. Marks it dirty. */
export function moveField(
  fields: PlacementField[],
  localId: string,
  dxPts: number,
  dyPts: number,
  page: PageGeometry
): PlacementField[] {
  return replace(fields, localId, (f) => ({
    ...f,
    bbox: moveBbox(f.bbox, dxPts, dyPts, page),
    dirty: true,
  }));
}

/** Resize one field's box via a handle drag. Marks it dirty. */
export function resizeField(
  fields: PlacementField[],
  localId: string,
  handle: ResizeHandle,
  dxPts: number,
  dyPts: number,
  page: PageGeometry
): PlacementField[] {
  return replace(fields, localId, (f) => ({
    ...f,
    bbox: resizeBbox(f.bbox, handle, dxPts, dyPts, page),
    dirty: true,
  }));
}

/** Update a field's editable metadata (label / role / type). Marks it dirty. */
export function updateFieldMeta(
  fields: PlacementField[],
  localId: string,
  patch: Partial<Pick<PlacementField, 'label' | 'role' | 'fieldType' | 'fieldKey'>>
): PlacementField[] {
  return replace(fields, localId, (f) => ({ ...f, ...patch, dirty: true }));
}

/**
 * Add a user-drawn box on `page`. `bbox` is whatever the user dragged out (in
 * points); it is clamped to the page. A new field gets a generated `fieldKey`
 * and a default label/type/role the user can edit.
 */
export function addField(
  fields: PlacementField[],
  opts: {
    localId: string;
    page: number;
    bbox: Bbox;
    pageGeom: PageGeometry;
    label?: string;
    fieldType?: AgreementFieldType;
    role?: AgreementFieldRole;
    fieldKey?: string;
  }
): PlacementField[] {
  const seq = fields.length + 1;
  const field: PlacementField = {
    localId: opts.localId,
    fieldKey: opts.fieldKey || `field_${seq}`,
    label: opts.label || `Field ${seq}`,
    fieldType: opts.fieldType || 'text',
    role: opts.role || 'signer',
    suggestedRole: opts.role || 'signer',
    page: opts.page,
    bbox: clampBboxToPage(opts.bbox, opts.pageGeom),
    confidence: null,
    lowConfidence: false,
    isNew: true,
    dirty: true,
  };
  return [...fields, field];
}

/**
 * Delete a field. A user-added (unsaved) field is dropped outright; an existing
 * field is tombstoned (`deleted: true`) so the save can issue a deletion.
 */
export function deleteField(
  fields: PlacementField[],
  localId: string
): PlacementField[] {
  const target = fields.find((f) => f.localId === localId);
  if (!target) return fields;
  if (target.isNew) return fields.filter((f) => f.localId !== localId);
  return replace(fields, localId, (f) => ({ ...f, deleted: true, dirty: true }));
}

/** Restore a tombstoned field. */
export function restoreField(
  fields: PlacementField[],
  localId: string
): PlacementField[] {
  return replace(fields, localId, (f) => ({ ...f, deleted: false }));
}

/** Live fields for a given page (tombstoned ones hidden). */
export function fieldsOnPage(
  fields: PlacementField[],
  page: number
): PlacementField[] {
  return fields.filter((f) => !f.deleted && f.page === page);
}

// ───────────────────────────────────────────────────────────────────────────
// Serialization
// ───────────────────────────────────────────────────────────────────────────

/**
 * Partition the editor model into the PATCH payload: dirty existing fields →
 * `fields`, new fields → `adds`, tombstoned existing fields → `deletes`.
 * Clean, unchanged fields are omitted entirely.
 */
export function toSavePayload(fields: PlacementField[]): FieldMapSavePayload {
  const payload: FieldMapSavePayload = { fields: [], adds: [], deletes: [] };

  for (const f of fields) {
    if (f.deleted) {
      if (f.id) payload.deletes.push(f.id);
      continue; // a never-saved field that was deleted is simply forgotten
    }
    if (f.isNew) {
      payload.adds.push({
        fieldKey: f.fieldKey,
        label: f.label,
        fieldType: f.fieldType,
        role: f.role,
        page: f.page,
        bbox: f.bbox,
        confidence: null,
      });
      continue;
    }
    if (f.dirty && f.id) {
      payload.fields.push({
        id: f.id,
        role: f.role,
        label: f.label,
        fieldType: f.fieldType,
        page: f.page,
        bbox: f.bbox,
      });
    }
  }

  return payload;
}

/** True when there is anything to persist. */
export function hasPendingChanges(fields: PlacementField[]): boolean {
  return fields.some((f) => f.dirty || f.isNew || f.deleted);
}

// ───────────────────────────────────────────────────────────────────────────
// Local id generation (monotonic, deterministic per generator instance)
// ───────────────────────────────────────────────────────────────────────────

/** A monotonic local-id generator — avoids Date.now/random for testability. */
export function makeLocalIdGen(prefix = 'lf'): () => string {
  let n = 0;
  return () => `${prefix}_${++n}`;
}

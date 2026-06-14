// FN-1807 — specs for the pure coordinate-math + edit reducers.
import {
  Bbox,
  PageGeometry,
  PlacementField,
  MIN_BBOX_SIZE_PTS,
  bboxToPixels,
  pixelsToBbox,
  pxToPts,
  clampBboxToPage,
  moveBbox,
  resizeBbox,
  toPlacementFields,
  moveField,
  resizeField,
  updateFieldMeta,
  addField,
  deleteField,
  restoreField,
  fieldsOnPage,
  toSavePayload,
  hasPendingChanges,
  makeLocalIdGen,
} from './bbox-editor.logic';
import { AgreementField } from '../agreement.model';

// US Letter in points.
const PAGE: PageGeometry = { widthPts: 612, heightPts: 792 };

function mkField(over: Partial<AgreementField> = {}): AgreementField {
  return {
    id: 'srv-1',
    fieldKey: 'party_name',
    label: 'Party Name',
    fieldType: 'text',
    page: 1,
    bbox: [72, 120, 240, 24],
    role: 'internal',
    suggestedRole: 'internal',
    confidence: 0.9,
    ...over,
  };
}

describe('bbox-editor.logic — geometry', () => {
  it('maps points → pixels at a given scale', () => {
    const rect = bboxToPixels([72, 120, 240, 24], 2);
    expect(rect).toEqual({ left: 144, top: 240, width: 480, height: 48 });
  });

  it('round-trips points → pixels → points', () => {
    const bbox: Bbox = [72, 120, 240, 24];
    const px = bboxToPixels(bbox, 1.5);
    expect(pixelsToBbox(px, 1.5)).toEqual(bbox);
  });

  it('pixelsToBbox is safe at zero scale', () => {
    expect(pixelsToBbox({ left: 10, top: 10, width: 10, height: 10 }, 0)).toEqual([0, 0, 0, 0]);
  });

  it('pxToPts converts a pixel delta to points', () => {
    expect(pxToPts(30, 1.5)).toBe(20);
    expect(pxToPts(30, 0)).toBe(0);
  });

  it('clamps a box fully inside the page', () => {
    // Pushed past the right/bottom edges → slid back in, size preserved.
    expect(clampBboxToPage([600, 780, 100, 100], PAGE)).toEqual([512, 692, 100, 100]);
  });

  it('clamps a negative origin to 0', () => {
    expect(clampBboxToPage([-50, -10, 100, 50], PAGE)).toEqual([0, 0, 100, 50]);
  });

  it('enforces the minimum box size', () => {
    const [, , w, h] = clampBboxToPage([10, 10, 2, 2], PAGE);
    expect(w).toBe(MIN_BBOX_SIZE_PTS);
    expect(h).toBe(MIN_BBOX_SIZE_PTS);
  });
});

describe('bbox-editor.logic — move', () => {
  it('translates by a points delta', () => {
    expect(moveBbox([72, 120, 240, 24], 10, -20, PAGE)).toEqual([82, 100, 240, 24]);
  });

  it('cannot move a box off the top-left', () => {
    expect(moveBbox([5, 5, 100, 50], -100, -100, PAGE)).toEqual([0, 0, 100, 50]);
  });

  it('cannot move a box off the bottom-right', () => {
    expect(moveBbox([500, 700, 100, 50], 1000, 1000, PAGE)).toEqual([512, 742, 100, 50]);
  });
});

describe('bbox-editor.logic — resize', () => {
  it('grows the east edge only', () => {
    expect(resizeBbox([100, 100, 200, 50], 'e', 40, 0, PAGE)).toEqual([100, 100, 240, 50]);
  });

  it('moves the west edge and keeps the right edge anchored', () => {
    expect(resizeBbox([100, 100, 200, 50], 'w', 30, 0, PAGE)).toEqual([130, 100, 170, 50]);
  });

  it('resizes a corner in both axes', () => {
    expect(resizeBbox([100, 100, 200, 50], 'se', 20, 30, PAGE)).toEqual([100, 100, 220, 80]);
  });

  it('never inverts below the minimum size when over-dragging west', () => {
    const [x, , w] = resizeBbox([100, 100, 200, 50], 'w', 1000, 0, PAGE);
    expect(w).toBe(MIN_BBOX_SIZE_PTS);
    expect(x).toBe(300 - MIN_BBOX_SIZE_PTS); // right edge (300) stays anchored
  });

  it('clamps a resized edge to the page bounds', () => {
    const [, , w] = resizeBbox([500, 100, 100, 50], 'e', 1000, 0, PAGE);
    expect(500 + w).toBe(PAGE.widthPts); // right edge pinned at page width
  });
});

describe('bbox-editor.logic — reducers', () => {
  it('builds placement fields and defaults a missing bbox into the page', () => {
    const fields = toPlacementFields(
      [mkField({ bbox: null })],
      [PAGE],
      makeLocalIdGen('t')
    );
    expect(fields[0].localId).toBe('t_1');
    expect(fields[0].bbox).toEqual([72, 72, 160, 24]);
    expect(fields[0].id).toBe('srv-1');
  });

  it('flags low-confidence fields', () => {
    const [hi, lo] = toPlacementFields(
      [mkField({ confidence: 0.95 }), mkField({ id: 'srv-2', confidence: 0.2 })],
      [PAGE]
    );
    expect(hi.lowConfidence).toBe(false);
    expect(lo.lowConfidence).toBe(true);
  });

  it('moveField marks the field dirty and shifts its bbox', () => {
    const fields = toPlacementFields([mkField()], [PAGE]);
    const out = moveField(fields, fields[0].localId, 10, 10, PAGE);
    expect(out[0].bbox).toEqual([82, 130, 240, 24]);
    expect(out[0].dirty).toBe(true);
    expect(fields[0].dirty).toBeUndefined(); // input untouched (immutable)
  });

  it('resizeField marks the field dirty', () => {
    const fields = toPlacementFields([mkField()], [PAGE]);
    const out = resizeField(fields, fields[0].localId, 'e', 10, 0, PAGE);
    expect(out[0].bbox[2]).toBe(250);
    expect(out[0].dirty).toBe(true);
  });

  it('updateFieldMeta changes label/role/type and marks dirty', () => {
    const fields = toPlacementFields([mkField()], [PAGE]);
    const out = updateFieldMeta(fields, fields[0].localId, { role: 'signer', label: 'X' });
    expect(out[0].role).toBe('signer');
    expect(out[0].label).toBe('X');
    expect(out[0].dirty).toBe(true);
  });

  it('addField appends a clamped, new, dirty box', () => {
    const out = addField([], {
      localId: 'new_1',
      page: 2,
      bbox: [600, 780, 200, 200],
      pageGeom: PAGE,
    });
    expect(out.length).toBe(1);
    expect(out[0].isNew).toBe(true);
    expect(out[0].dirty).toBe(true);
    expect(out[0].id).toBeUndefined();
    expect(out[0].page).toBe(2);
    expect(out[0].bbox).toEqual(clampBboxToPage([600, 780, 200, 200], PAGE));
  });

  it('deleteField drops an unsaved box but tombstones an existing one', () => {
    let fields = toPlacementFields([mkField()], [PAGE]);
    fields = addField(fields, { localId: 'new_1', page: 1, bbox: [10, 10, 50, 20], pageGeom: PAGE });

    const afterDeleteNew = deleteField(fields, 'new_1');
    expect(afterDeleteNew.find((f) => f.localId === 'new_1')).toBeUndefined();

    const afterDeleteExisting = deleteField(fields, fields[0].localId);
    const existing = afterDeleteExisting.find((f) => f.localId === fields[0].localId)!;
    expect(existing.deleted).toBe(true);
  });

  it('restoreField clears a tombstone', () => {
    const fields = toPlacementFields([mkField()], [PAGE]);
    const deleted = deleteField(fields, fields[0].localId);
    const restored = restoreField(deleted, fields[0].localId);
    expect(restored[0].deleted).toBe(false);
  });

  it('fieldsOnPage filters by page and hides tombstones', () => {
    let fields = toPlacementFields(
      [mkField({ page: 1 }), mkField({ id: 'srv-2', page: 2 })],
      [PAGE, PAGE]
    );
    fields = deleteField(fields, fields[1].localId);
    expect(fieldsOnPage(fields, 1).length).toBe(1);
    expect(fieldsOnPage(fields, 2).length).toBe(0);
  });
});

describe('bbox-editor.logic — serialization', () => {
  function buildScenario(): PlacementField[] {
    // Start with two server fields, edit one, leave one clean.
    let fields = toPlacementFields(
      [mkField({ id: 'srv-1' }), mkField({ id: 'srv-2', fieldKey: 'b', label: 'B' })],
      [PAGE, PAGE],
      makeLocalIdGen('s')
    );
    fields = moveField(fields, fields[0].localId, 5, 5, PAGE); // srv-1 dirty
    fields = addField(fields, { localId: 'n1', page: 1, bbox: [50, 50, 100, 20], pageGeom: PAGE });
    // Add then delete an existing field (srv-2).
    fields = deleteField(fields, fields[1].localId);
    return fields;
  }

  it('partitions updates / additions / deletions', () => {
    const payload = toSavePayload(buildScenario());
    expect(payload.fields.map((f) => f.id)).toEqual(['srv-1']);
    expect(payload.fields[0].bbox).toEqual([77, 125, 240, 24]);
    expect(payload.fields[0].fieldType).toBe('text');
    expect(payload.adds.length).toBe(1);
    expect(payload.adds[0].confidence).toBeNull();
    expect(payload.adds[0].bbox).toEqual([50, 50, 100, 20]);
    expect(payload.deletes).toEqual(['srv-2']);
  });

  it('omits clean fields entirely', () => {
    const fields = toPlacementFields([mkField()], [PAGE]);
    const payload = toSavePayload(fields);
    expect(payload.fields).toEqual([]);
    expect(payload.adds).toEqual([]);
    expect(payload.deletes).toEqual([]);
  });

  it('forgets a never-saved field that was added then deleted', () => {
    let fields = addField([], { localId: 'n1', page: 1, bbox: [10, 10, 50, 20], pageGeom: PAGE });
    fields = deleteField(fields, 'n1');
    const payload = toSavePayload(fields);
    expect(payload).toEqual({ fields: [], adds: [], deletes: [] });
  });

  it('hasPendingChanges reflects edit state', () => {
    const clean = toPlacementFields([mkField()], [PAGE]);
    expect(hasPendingChanges(clean)).toBe(false);
    expect(hasPendingChanges(moveField(clean, clean[0].localId, 1, 0, PAGE))).toBe(true);
  });
});

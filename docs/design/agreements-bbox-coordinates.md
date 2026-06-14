# Agreements — canonical bbox / coordinate convention

**Status:** authoritative · **Owner:** FN-1808 (backend) · **Consumers:** FN-1807 (visual editor), FN-1797 (signed-PDF overlay)

Agreement templates store a field map. Every field has a placement: a `page`
and a `bbox`. Three subsystems read and write that placement — the AI detector,
the visual placement editor, and the signed-PDF overlay — so they **must** agree
on one convention. This document is that convention. If a box is drawn in the
editor, it has to land in the same place on the generated PDF; that only works
if everyone interprets `bbox` identically.

## The convention

A field placement is `{ page, bbox }`:

| Field  | Type        | Meaning |
|--------|-------------|---------|
| `page` | integer     | 1-based page index. Valid range: `[1, template.page_count]`. |
| `bbox` | `[x, y, w, h]` | Rectangle in **PDF points** (1 pt = 1/72 inch). |

`bbox` semantics:

- **Origin:** top-left corner of the page.
- **Axes:** `+x` → right, `+y` → **down**.
- `x` = left edge, `y` = top edge, `w` = width, `h` = height.
- Bounds: `x ≥ 0`, `y ≥ 0`, `w > 0`, `h > 0`.

This "top-left points" space is what the AI field detector emits, so detected
boxes are stored as-is with no transform. (Example from the detector stub:
`[72, 120, 240, 24]` ≈ a 240×24 pt box one inch from the left edge, 120 pt down
from the top.)

## How each subsystem uses it

### Backend (FN-1808 — this story)

`agreement-service.js` validates every write against this convention:

- `validatePage(page, pageCount)` enforces `1 ≤ page ≤ page_count`.
- `validateBbox(bbox)` enforces the 4-number non-negative shape above.

The `PATCH /api/agreements/templates/:id/fields` endpoint accepts geometry edits
(`fields[].page`, `fields[].bbox`), user-drawn additions (`adds[]`, stored with
`confidence: null`), and deletions (`deletes[]`). `bbox` is persisted as a JSONB
`[x, y, w, h]` array. Invalid page/bbox values are rejected, never stored.

### Frontend visual editor (FN-1807)

The editor renders each page at a scale `s` (rendered pixels per PDF point;
`s = renderedPageWidthPx / pageWidthPt`). Because the page is drawn from its
top-left and `bbox` is already top-left, the mapping is a pure scale — no axis
flip:

```
pixelRect = { left: x * s, top: y * s, width: w * s, height: h * s }
```

and the inverse when the user drags/resizes/draws a box:

```
bbox = [ left / s, top / s, width / s, height / s ]
```

### Signed-PDF overlay (FN-1797)

PDF native user space has its origin at the **bottom-left** with `+y` going up,
so the overlay flips the y-axis using the page height `H` (in points) at fill
time. For a value/signature placed at `bbox = [x, y, w, h]` on a page of height
`H`:

```
pdfX      = x
pdfY      = H - y - h      // top-left y → bottom-left y of the box's lower edge
pdfWidth  = w
pdfHeight = h
```

Both the editor and the PDF overlay derive from the **same** stored `bbox`, so a
box positioned in the editor reproduces exactly on the signed PDF. The only
place the y-axis flips is inside the PDF overlay (FN-1797); nothing else flips.

## Invariants (don't break these)

1. `bbox` is always stored in top-left PDF points — never pixels, never
   bottom-left, never normalized 0–1.
2. The y-axis flip lives **only** in the PDF overlay. The editor and backend
   never flip.
3. `page` is 1-based and bounded by `page_count`.
4. A field may have a `null` bbox (detected but unplaced); such a field is not
   overlaid until it gets geometry.

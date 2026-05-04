// FN-1057 — Shared PDF selection helper for the "Upload Rate Confirmation"
// entry points (hero CTA, Auto-Create modal, empty-state import).
//
// Why: hero CTA and Auto-Create modal both need to (1) filter to PDFs,
// (2) cap at N files, (3) flag whether we capped so the caller can surface
// a non-blocking message. Centralizing here keeps the rule single-source.

export interface SelectPdfsResult {
  /** PDFs in input order, capped to `max`. */
  pdfs: File[];
  /** True when the caller passed more PDFs than `max` (extras were dropped). */
  capped: boolean;
}

export function selectPdfs(
  files: FileList | File[] | null | undefined,
  max = 10,
): SelectPdfsResult {
  if (!files) return { pdfs: [], capped: false };
  const pdfs = Array.from(files).filter((f) => f.type === 'application/pdf');
  const capped = pdfs.length > max;
  return {
    pdfs: capped ? pdfs.slice(0, max) : pdfs,
    capped,
  };
}

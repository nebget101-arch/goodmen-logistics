import { selectPdfs } from './pdf-upload.util';

function pdfFile(name: string): File {
  return new File([new Blob(['%PDF-1.4'])], name, { type: 'application/pdf' });
}
function nonPdfFile(name: string, mime = 'image/png'): File {
  return new File([new Blob([''])], name, { type: mime });
}

describe('selectPdfs', () => {
  it('returns empty result when files is null/undefined', () => {
    expect(selectPdfs(null)).toEqual({ pdfs: [], capped: false });
    expect(selectPdfs(undefined)).toEqual({ pdfs: [], capped: false });
  });

  it('returns empty result when no files match application/pdf', () => {
    const out = selectPdfs([nonPdfFile('a.png'), nonPdfFile('b.jpg', 'image/jpeg')]);
    expect(out.pdfs.length).toBe(0);
    expect(out.capped).toBe(false);
  });

  it('keeps order and filters out non-PDFs', () => {
    const a = pdfFile('a.pdf');
    const b = nonPdfFile('b.png');
    const c = pdfFile('c.pdf');
    const out = selectPdfs([a, b, c]);
    expect(out.pdfs).toEqual([a, c]);
    expect(out.capped).toBe(false);
  });

  it('does not flag capped when count equals max', () => {
    const arr = Array.from({ length: 10 }, (_, i) => pdfFile(`f${i}.pdf`));
    const out = selectPdfs(arr);
    expect(out.pdfs.length).toBe(10);
    expect(out.capped).toBe(false);
  });

  it('caps to max and flags capped when count exceeds max', () => {
    const arr = Array.from({ length: 12 }, (_, i) => pdfFile(`f${i}.pdf`));
    const out = selectPdfs(arr);
    expect(out.pdfs.length).toBe(10);
    expect(out.capped).toBe(true);
    expect(out.pdfs[0].name).toBe('f0.pdf');
    expect(out.pdfs[9].name).toBe('f9.pdf');
  });

  it('respects custom max', () => {
    const arr = Array.from({ length: 4 }, (_, i) => pdfFile(`f${i}.pdf`));
    const out = selectPdfs(arr, 3);
    expect(out.pdfs.length).toBe(3);
    expect(out.capped).toBe(true);
  });

  it('treats single-PDF input as not capped', () => {
    const out = selectPdfs([pdfFile('only.pdf')]);
    expect(out.pdfs.length).toBe(1);
    expect(out.capped).toBe(false);
  });
});

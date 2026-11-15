import { describe, expect, it } from 'vitest';
import { buildTextPdf, pdfRupees } from './simple-pdf';

describe('buildTextPdf', () => {
  it('writes a PDF whose xref offsets point at each object', () => {
    const pdf = buildTextPdf([
      { text: 'AWB DMO000000000001', size: 16 },
      { text: 'Ship to: Asha (Pune) ₹', size: 10 },
    ]).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    const xrefStart = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(xrefStart, xrefStart + 4)).toBe('xref');
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    offsets.forEach((offset, index) => {
      expect(pdf.slice(offset).startsWith(`${String(index + 1)} 0 obj`)).toBe(true);
    });
    expect(pdf).toContain('(Ship to: Asha \\(Pune\\) ?)');
  });
});

describe('buildTextPdf pagination', () => {
  it('spreads long documents over several A4 pages with valid offsets', () => {
    const lines = Array.from({ length: 120 }, (_value, index) => ({
      text: `Line ${String(index)}`,
      size: 10,
    }));
    const pdf = buildTextPdf(lines, 'a4').toString('latin1');
    const pageCount = Number(/\/Count (\d+)/.exec(pdf)?.[1]);
    expect(pageCount).toBeGreaterThan(1);
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    offsets.forEach((offset, index) => {
      expect(pdf.slice(offset).startsWith(`${String(index + 1)} 0 obj`)).toBe(true);
    });
    expect(pdf).toContain('(Line 119)');
  });

  it('formats amounts without the rupee sign', () => {
    expect(pdfRupees(12345678)).toBe('Rs. 1,23,456.78');
  });
});

// Plain-text PDFs (shipping labels, invoices, packing slips, manifests), written by hand so no PDF library
// is needed. Text is limited to printable ASCII; anything else becomes "?" (so amounts use "Rs.").
function escapePdfText(text: string): string {
  return text
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

export type PdfLine = Readonly<{ text: string; size: number }>;

const pageSizes = { a6: { width: 298, height: 420 }, a4: { width: 595, height: 842 } } as const;
const margin = 36;

function paginate(lines: readonly PdfLine[], height: number): PdfLine[][] {
  const pages: PdfLine[][] = [[]];
  let used = 0;
  for (const line of lines) {
    const lineHeight = line.size + 8;
    if (used + lineHeight > height - margin * 2 && (pages.at(-1)?.length ?? 0) > 0) {
      pages.push([]);
      used = 0;
    }
    pages.at(-1)?.push(line);
    used += lineHeight;
  }
  return pages;
}

function pageContent(lines: readonly PdfLine[], height: number): string {
  let cursor = height - margin;
  return lines
    .map((line) => {
      const command = `BT /F1 ${String(line.size)} Tf ${String(margin - 12)} ${String(cursor)} Td (${escapePdfText(line.text)}) Tj ET`;
      cursor -= line.size + 8;
      return command;
    })
    .join('\n');
}

export function buildTextPdf(
  lines: readonly PdfLine[],
  pageSize: keyof typeof pageSizes = 'a6',
): Buffer {
  const { width, height } = pageSizes[pageSize];
  const pages = paginate(lines, height);
  // Objects: 1 catalog, 2 pages, 3 font, then per page a page object and its content stream.
  const pageObjectNumber = (index: number) => 4 + index * 2;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_page, index) => `${String(pageObjectNumber(index))} 0 R`).join(' ')}] /Count ${String(pages.length)} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...pages.flatMap((page, index) => {
      const content = pageContent(page, height);
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(width)} ${String(height)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(pageObjectNumber(index) + 1)} 0 R >>`,
        `<< /Length ${String(Buffer.byteLength(content, 'latin1'))} >>\nstream\n${content}\nendstream`,
      ];
    }),
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

// Amounts in documents: the PDF font has no rupee sign.
export function pdfRupees(amountPaise: number): string {
  const rupees = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountPaise / 100);
  return `Rs. ${rupees}`;
}

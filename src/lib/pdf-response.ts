export function pdfResponse(pdf: Buffer, filename: string): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '-')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

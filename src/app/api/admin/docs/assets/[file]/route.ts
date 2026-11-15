import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { apiHandler } from '@/lib/api-handler';
import { DomainError } from '@/lib/errors';
import { requireStaff } from '@/modules/identity/access-control';

// D49: Swagger UI's script is served from this origin (no CDN, so the CSP stays 'self'); its stylesheet
// is bundled by Next from the component's import.
// A Map, so names such as `constructor` or `__proto__` are not found through the object prototype.
const assets: ReadonlyMap<string, string> = new Map([
  ['swagger-ui-bundle.js', 'text/javascript; charset=utf-8'],
]);

export const GET = apiHandler(
  async (request, { params }: { params: Promise<{ file: string }> }) => {
    await requireStaff(request);
    const { file } = await params;
    const contentType = assets.get(file);
    if (contentType === undefined) {
      throw new DomainError({ kind: 'NOT_FOUND', code: 'NOT_FOUND', message: 'Not found' });
    }
    const body = await readFile(path.join(process.cwd(), 'node_modules/swagger-ui-dist', file));
    return new Response(new Uint8Array(body), {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=86400' },
    });
  },
);

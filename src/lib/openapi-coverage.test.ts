import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// D49: docs/openapi.json is generated from the route handlers (`npm run docs:openapi`). This fails when
// a route or handler is added, removed or renamed without regenerating it.
const root = process.cwd();

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === 'route.ts' ? [full] : [];
  });
}

function routeOperations(): string[] {
  return routeFiles(path.join(root, 'src/app/api')).flatMap((file) => {
    const routePath = `/${path
      .relative(path.join(root, 'src/app'), path.dirname(file))
      .split(path.sep)
      .join('/')}`.replace(/\[([^\]]+)\]/g, '{$1}');
    return [
      ...readFileSync(file, 'utf8').matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g),
    ].map(([, method = '']) => `${method.toLowerCase()} ${routePath}`);
  });
}

const documentSchema = z.object({
  openapi: z.string(),
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
});

describe('docs/openapi.json', () => {
  it('documents exactly the API route handlers that exist', () => {
    const document = documentSchema.parse(
      JSON.parse(readFileSync(path.join(root, 'docs/openapi.json'), 'utf8')),
    );
    const documented = Object.entries(document.paths).flatMap(([routePath, operations]) =>
      Object.keys(operations).map((method) => `${method} ${routePath}`),
    );
    expect(document.openapi).toBe('3.1.0');
    expect(documented.sort()).toEqual(routeOperations().sort());
  });
});

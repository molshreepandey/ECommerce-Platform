// `npm run docs:openapi`: writes docs/openapi.json from the route handlers themselves (plan D49, Wave 15).
// Paths and methods come from src/app/api/**/route.ts; request bodies and query strings from the Zod
// schema each handler parses (z.toJSONSchema); auth from requirePermission / requireCustomer; the
// description from the comment above the handler. A unit test fails when a route is missing.
import 'dotenv/config';

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

const root = process.cwd();
// Routes whose rate limit is applied inside the service they call (plan §10B; config rateLimits).
const rateLimitedRoutes: ReadonlySet<string> = new Set([
  '/api/store/auth/login',
  '/api/store/auth/register',
  '/api/store/auth/otp/request',
  '/api/store/auth/otp/verify',
  '/api/admin/auth/login',
  '/api/store/checkout',
  '/api/store/orders/{orderId}/payments',
  '/api/store/cart/items',
  '/api/store/cart/items/{variantId}',
  '/api/store/cart/coupon',
  '/api/admin/staff',
]);
const apiRoot = path.join(root, 'src/app/api');
const methodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const propertiesSchema = z.object({ properties: z.record(z.string(), z.unknown()) });

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === 'route.ts' ? [full] : [];
  });
}

export function openApiPath(file: string): string {
  const relative = path.relative(path.join(root, 'src/app'), path.dirname(file));
  return `/${relative.split(path.sep).join('/')}`.replace(/\[([^\]]+)\]/g, '{$1}');
}

function importsOf(source: string): Map<string, string> {
  const imports = new Map<string, string>();
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
    const [, names = '', specifier = ''] = match;
    for (const name of names.split(',')) {
      const local =
        name
          .replace(/^\s*type\s+/, '')
          .split(' as ')
          .at(-1)
          ?.trim() ?? '';
      if (local !== '') imports.set(local, specifier);
    }
  }
  return imports;
}

function resolveSpecifier(specifier: string, routeFile: string): string {
  if (specifier.startsWith('@/')) return path.join(root, 'src', specifier.slice(2));
  return path.resolve(path.dirname(routeFile), specifier);
}

async function jsonSchemaFor(
  schemaName: string,
  imports: Map<string, string>,
  routeFile: string,
): Promise<unknown> {
  const specifier = imports.get(schemaName);
  if (specifier === undefined) return { type: 'object' };
  const loaded: unknown = await import(resolveSpecifier(specifier, routeFile));
  const schema = z.record(z.string(), z.unknown()).parse(loaded)[schemaName];
  if (!(schema instanceof z.ZodType)) return { type: 'object' };
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
}

function handlerSegments(
  source: string,
): { method: z.infer<typeof methodSchema>; body: string; comment: string }[] {
  const starts = [...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)];
  return starts.map((match, index) => {
    const start = match.index;
    const end = starts[index + 1]?.index ?? source.length;
    const before = source.slice(0, start).trimEnd();
    const commentLines: string[] = [];
    for (const line of before.split('\n').reverse()) {
      if (!line.trim().startsWith('//')) break;
      commentLines.unshift(line.trim().replace(/^\/\/\s?/, ''));
    }
    return {
      method: methodSchema.parse(match[1]),
      body: source.slice(start, end),
      comment: commentLines.join(' '),
    };
  });
}

function firstSentence(comment: string): string {
  const sentence = /^(.*?[.:;])(\s|$)/.exec(comment)?.[1] ?? comment;
  return sentence.length > 100 ? `${sentence.slice(0, 97)}...` : sentence;
}

// The top-level keys of the object a handler passes to Response.json({ ... }); `open` when it spreads
// another object in, so more keys may appear.
export function responseKeys(body: string): { keys: string[]; open: boolean } | null {
  const start = body.indexOf('Response.json(');
  if (start === -1) return null;
  let index = start + 'Response.json('.length;
  while (/\s/.test(body.charAt(index))) index += 1;
  if (body.charAt(index) !== '{') return null;
  const keys: string[] = [];
  let open = false;
  let depth = 0;
  let expectingKey = true;
  for (; index < body.length; index += 1) {
    const character = body.charAt(index);
    if ('{[('.includes(character)) {
      depth += 1;
      if (depth === 1) expectingKey = true;
      continue;
    }
    if ('}])'.includes(character)) {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }
    if (depth !== 1) continue;
    if (character === ',') {
      expectingKey = true;
      continue;
    }
    if (!expectingKey || /\s/.test(character)) continue;
    if (body.startsWith('...', index)) {
      open = true;
      expectingKey = false;
      continue;
    }
    const key = /^[A-Za-z_][A-Za-z0-9_]*/.exec(body.slice(index))?.[0];
    if (key !== undefined) keys.push(key);
    expectingKey = false;
  }
  return { keys, open };
}

function successSchema(body: string): Record<string, unknown> {
  const found = responseKeys(body);
  if (found === null) return { type: 'object' };
  return {
    type: 'object',
    required: found.keys,
    properties: Object.fromEntries(found.keys.map((key) => [key, {}])),
    additionalProperties: found.open,
  };
}

function successStatus(body: string): string {
  if (/status:\s*204|new Response\(null/.test(body)) return '204';
  if (/status:\s*[\w.]+\s*\?\s*200\s*:\s*201/.test(body)) return '201';
  if (/status:\s*201|CartResponse\([^)]*,\s*201\)/.test(body)) return '201';
  return '200';
}

// Idempotent creates answer 201 the first time and 200 when the same request is replayed.
function isCreatedOrReplayed(body: string): boolean {
  return /status:\s*[\w.]+\s*\?\s*200\s*:\s*201/.test(body);
}

function contentTypeOf(body: string): string {
  if (/pdfResponse\(/.test(body)) return 'application/pdf';
  if (/csvResponse\(/.test(body)) return 'text/csv';
  return 'application/json';
}

const errorEnvelope = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'details'],
      properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} },
    },
  },
};

async function main(): Promise<void> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const file of routeFiles(apiRoot).sort()) {
    const source = readFileSync(file, 'utf8');
    const imports = importsOf(source);
    const routePath = openApiPath(file);
    const pathParameters = [...routePath.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    const operations: Record<string, unknown> = {};
    for (const handler of handlerSegments(source)) {
      const permission = /requirePermission\(\s*request,\s*'([^']+)'/.exec(handler.body)?.[1];
      const isCustomer = /requireCustomer\(/.test(handler.body);
      const isStaff = permission !== undefined || /requireStaff\(/.test(handler.body);
      const bodySchemaName = /parseJsonBody\(\s*request,\s*([A-Za-z0-9_]+)\s*\)/.exec(
        handler.body,
      )?.[1];
      const querySchemaName =
        /([A-Za-z0-9_]+)\.parse\(\s*Object\.fromEntries\(\s*request\.nextUrl\.searchParams/.exec(
          handler.body,
        )?.[1];
      const parameters: unknown[] = [...pathParameters];
      if (querySchemaName !== undefined) {
        const querySchema = await jsonSchemaFor(querySchemaName, imports, file);
        const parsedProperties = propertiesSchema.safeParse(querySchema);
        const properties = parsedProperties.success ? parsedProperties.data.properties : {};
        for (const [name, schema] of Object.entries(properties)) {
          parameters.push({ name, in: 'query', required: false, schema });
        }
      }
      if (/idempotencyKeyFrom|'Idempotency-Key'/.test(handler.body)) {
        parameters.push({
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,100}$' },
        });
      }
      const status = successStatus(handler.body);
      const contentType = contentTypeOf(handler.body);
      const surface = routePath.startsWith('/api/store') ? 'store' : 'admin';
      operations[handler.method.toLowerCase()] = {
        tags: [routePath.split('/').slice(2, 4).join('/')],
        ...(handler.comment === ''
          ? {}
          : { summary: firstSentence(handler.comment), description: handler.comment }),
        ...(!isStaff && !isCustomer
          ? {}
          : {
              security: [{ [isCustomer ? 'storeSession' : 'adminSession']: [] }],
              ...(permission === undefined ? {} : { 'x-required-permission': permission }),
            }),
        'x-surface': routePath.startsWith('/api/health') ? 'store and admin' : surface,
        parameters,
        ...(bodySchemaName === undefined
          ? {}
          : {
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: await jsonSchemaFor(bodySchemaName, imports, file),
                  },
                },
              },
            }),
        responses: {
          [status]:
            status === '204'
              ? { description: 'Done (no content)' }
              : {
                  description: 'Success',
                  content: {
                    [contentType]:
                      contentType === 'application/json'
                        ? { schema: successSchema(handler.body) }
                        : {},
                  },
                },
          ...(isCreatedOrReplayed(handler.body)
            ? {
                '200': {
                  description: 'Replay: this Idempotency-Key was already used for the same request',
                  content: { [contentType]: { schema: successSchema(handler.body) } },
                },
              }
            : {}),
          ...(bodySchemaName === undefined && querySchemaName === undefined
            ? {}
            : { '400': { $ref: '#/components/responses/ValidationFailed' } }),
          ...(isStaff || isCustomer
            ? { '401': { $ref: '#/components/responses/Unauthenticated' } }
            : {}),
          ...(permission === undefined
            ? {}
            : { '403': { $ref: '#/components/responses/PermissionDenied' } }),
          ...(/enforceRateLimit|limitInventoryWrites|limit[A-Z][A-Za-z]*\(/.test(handler.body) ||
          rateLimitedRoutes.has(routePath)
            ? { '429': { $ref: '#/components/responses/RateLimited' } }
            : {}),
          default: {
            description: 'Other errors (404, 409, 422, 503) in the error envelope',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
            },
          },
        },
      };
    }
    paths[routePath] = operations;
  }
  const document = {
    openapi: '3.1.0',
    info: {
      title: 'E-Commerce Platform API',
      version: '1.0.0',
      description:
        'Store APIs are served on the store host and admin APIs on the admin host (`*.localhost` locally). ' +
        'Mutating requests need a same-origin `Origin` header. Sessions are httpOnly cookies set by the ' +
        'sign-in endpoints. Generated by `npm run docs:openapi` from the route handlers.',
    },
    servers: [
      {
        url: '/',
        description: 'This host: admin APIs on the admin host, store APIs on the store host',
      },
    ],
    components: {
      schemas: { ErrorEnvelope: errorEnvelope },
      responses: Object.fromEntries(
        (
          [
            ['ValidationFailed', 'The request did not pass validation (fieldErrors in details)'],
            ['Unauthenticated', 'No valid session cookie'],
            ['PermissionDenied', 'Signed in, but the role lacks the required permission'],
            ['RateLimited', 'Too many requests; retry after the Retry-After header'],
          ] as const
        ).map(([name, description]) => [
          name,
          {
            description,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
            },
          },
        ]),
      ),
      securitySchemes: {
        storeSession: { type: 'apiKey', in: 'cookie', name: 'store_session' },
        adminSession: { type: 'apiKey', in: 'cookie', name: 'admin_session' },
      },
    },
    paths,
  };
  writeFileSync(path.join(root, 'docs/openapi.json'), `${JSON.stringify(document, null, 2)}\n`);
  console.log(`Wrote docs/openapi.json: ${String(Object.keys(paths).length)} paths.`);
}

await main();
process.exit(0);

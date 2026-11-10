import { randomInt } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { demoPassword } from '../../prisma/seed/demo-credentials';
import { callApi, sessionCookieFrom } from './app-server';
import {
  catalogueApi,
  errorCode,
  errorEnvelope,
  idSchema,
  staffCookie,
} from './support/catalogue-api';

const runId = `${Date.now().toString(36)}${randomInt(1_000_000).toString(36)}`;
const unknownId = '0195f2a0-0000-7000-8000-000000000999';

let manager = '';
let support = '';
const { createProduct } = catalogueApi(() => manager);

beforeAll(async () => {
  manager = await staffCookie('catalogue.manager@demo-store.test');
  support = await staffCookie('support@demo-store.test');
});

const measurements = {
  mrpPaise: 99_900,
  pricePaise: 79_900,
  weightGrams: 300,
  lengthMm: 300,
  breadthMm: 250,
  heightMm: 30,
};

describe('who may use the catalogue API', () => {
  it('answers 401 without a session, for reads and writes', async () => {
    expect((await callApi('get', 'admin', '/api/admin/products')).status).toBe(401);
    const write = await callApi('post', 'admin', '/api/admin/product-types', {
      body: { code: `anon_${runId}`, name: 'Anonymous' },
    });
    expect(write.status).toBe(401);
    expect(errorCode(write.body)).toBe('UNAUTHENTICATED');
  });

  it('answers 403 for a customer session used on the admin API', async () => {
    const customer = await callApi('post', 'store', '/api/store/auth/login', {
      body: { email: 'asha.verma@demo-store.test', password: demoPassword },
    });
    expect(customer.status).toBe(200);
    const token =
      sessionCookieFrom(customer.headers['set-cookie'], 'store_session').split('=')[1] ?? '';
    const response = await callApi('get', 'admin', '/api/admin/products', {
      cookie: `admin_session=${token}`,
    });
    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('WRONG_ACCOUNT_TYPE');
  });

  it('lets read-only staff read but answers 403 PERMISSION_DENIED for every kind of write', async () => {
    const productId = await createProduct(`read-only-${runId}`);
    expect((await callApi('get', 'admin', '/api/admin/products', { cookie: support })).status).toBe(
      200,
    );
    expect(
      (await callApi('get', 'admin', `/api/admin/products/${productId}`, { cookie: support }))
        .status,
    ).toBe(200);
    for (const [method, path, body] of [
      ['post', '/api/admin/product-types', { code: `ro_${runId}`, name: 'Nope' }],
      ['patch', `/api/admin/products/${productId}`, { expectedVersion: 0, name: 'Nope' }],
      [
        'post',
        `/api/admin/products/${productId}/status`,
        { expectedVersion: 0, status: 'ARCHIVED' },
      ],
      [
        'post',
        `/api/admin/products/${productId}/variants`,
        { sku: `RO-${runId}`, optionValues: { size: 'M' }, ...measurements },
      ],
      [
        'post',
        `/api/admin/products/${productId}/media`,
        { url: 'https://picsum.photos/x', altText: 'x' },
      ],
    ] as const) {
      const response = await callApi(method, 'admin', path, { cookie: support, body });
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(errorCode(response.body)).toBe('PERMISSION_DENIED');
    }
  });

  it('refuses a write from another origin, and keeps the catalogue API off the store host', async () => {
    const crossSite = await callApi('post', 'admin', '/api/admin/brands', {
      cookie: manager,
      origin: 'https://evil.example',
      body: { name: 'Cross site' },
    });
    expect(crossSite.status).toBe(403);
    expect(errorCode(crossSite.body)).toBe('ORIGIN_NOT_ALLOWED');
    expect((await callApi('get', 'store', '/api/admin/products', { cookie: manager })).status).toBe(
      404,
    );
  });
});

describe('input validation', () => {
  it('answers 400 for malformed JSON, unknown fields, bad ids and bad query parameters', async () => {
    const malformed = await callApi('post', 'admin', '/api/admin/brands', { cookie: manager })
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(malformed.status).toBe(400);
    expect(errorCode(malformed.body)).toBe('INVALID_JSON');

    const unknownField = await callApi('post', 'admin', '/api/admin/brands', {
      cookie: manager,
      body: { name: 'Extra field', isActive: false, owner: 'me' },
    });
    expect(unknownField.status).toBe(400);
    expect(errorCode(unknownField.body)).toBe('VALIDATION_FAILED');

    const badId = await callApi('get', 'admin', '/api/admin/products/not-a-uuid', {
      cookie: manager,
    });
    expect(badId.status).toBe(400);

    for (const query of [
      'limit=500',
      'sort=PRICE',
      'status=DELETED',
      'cursor=tampered',
      'colour=red',
    ]) {
      const response = await callApi('get', 'admin', `/api/admin/products?${query}`, {
        cookie: manager,
      });
      expect(response.status, query).toBe(400);
      expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
    }
  });

  it('returns field errors that point at the bad attribute', async () => {
    const productId = await createProduct(`fields-${runId}`);
    const response = await callApi('patch', 'admin', `/api/admin/products/${productId}`, {
      cookie: manager,
      body: { expectedVersion: 0, attributes: { fabric: 'Wool' } },
    });
    expect(response.status).toBe(400);
    const details = z
      .object({ fieldErrors: z.record(z.string(), z.array(z.string())) })
      .parse(errorEnvelope.parse(response.body).error.details);
    expect(details.fieldErrors['attributes.fabric']?.[0]).toMatch(/Cotton, Silk/);
  });

  it('answers 404 for a product that does not exist', async () => {
    const response = await callApi('get', 'admin', `/api/admin/products/${unknownId}`, {
      cookie: manager,
    });
    expect(response.status).toBe(404);
    expect(errorCode(response.body)).toBe('PRODUCT_NOT_FOUND');
  });
});

describe('a complete catalogue workflow over HTTP', () => {
  it('creates, fills, activates, lists, edits and archives a product', async () => {
    const slug = `workflow-${runId}`;
    const productId = await createProduct(slug);

    const notReady = await callApi('post', 'admin', `/api/admin/products/${productId}/status`, {
      cookie: manager,
      body: { expectedVersion: 0, status: 'ACTIVE' },
    });
    expect(notReady.status).toBe(422);
    expect(errorCode(notReady.body)).toBe('PRODUCT_NOT_READY');

    const generated = await callApi(
      'post',
      'admin',
      `/api/admin/products/${productId}/variants/generate`,
      {
        cookie: manager,
        body: { options: { size: ['S', 'M'] }, skuPrefix: `WF-${runId}`, ...measurements },
      },
    );
    expect(generated.status).toBe(200);
    const generatedBody = z
      .object({
        created: z.array(idSchema.extend({ sku: z.string() })),
        productVersion: z.number(),
      })
      .parse(generated.body);
    expect(generatedBody.created).toHaveLength(2);

    const image = await callApi('post', 'admin', `/api/admin/products/${productId}/media`, {
      cookie: manager,
      body: { url: 'https://picsum.photos/seed/workflow/600/800', altText: 'Front view' },
    });
    expect(image.status).toBe(201);
    const { productVersion } = z.object({ productVersion: z.number() }).parse(image.body);

    const active = await callApi('post', 'admin', `/api/admin/products/${productId}/status`, {
      cookie: manager,
      body: { expectedVersion: productVersion, status: 'ACTIVE' },
    });
    expect(active.status).toBe(200);

    const detail = await callApi('get', 'admin', `/api/admin/products/${productId}`, {
      cookie: manager,
    });
    expect(detail.body).toMatchObject({
      product: {
        status: 'ACTIVE',
        slug,
        variants: [{}, {}],
        media: [{ altText: 'Front view', position: 0 }],
      },
    });

    const listed = await callApi(
      'get',
      'admin',
      `/api/admin/products?search=${slug}&status=ACTIVE&limit=10`,
      {
        cookie: manager,
      },
    );
    expect(listed.status).toBe(200);
    expect(
      z
        .object({ totalCount: z.number(), items: z.array(z.object({ slug: z.string() })) })
        .parse(listed.body),
    ).toMatchObject({
      totalCount: 1,
      items: [{ slug }],
    });

    const firstVariant = generatedBody.created[0];
    if (firstVariant === undefined) throw new Error('no variant generated');
    const secondVariant = generatedBody.created[1];
    if (secondVariant === undefined) throw new Error('no second variant');
    expect(
      (
        await callApi('post', 'admin', `/api/admin/variants/${firstVariant.id}/status`, {
          cookie: manager,
          body: { status: 'ARCHIVED' },
        })
      ).status,
    ).toBe(200);
    const lastActive = await callApi(
      'post',
      'admin',
      `/api/admin/variants/${secondVariant.id}/status`,
      {
        cookie: manager,
        body: { status: 'ARCHIVED' },
      },
    );
    expect(lastActive.status).toBe(409);
    expect(errorCode(lastActive.body)).toBe('LAST_ACTIVE_VARIANT');

    const current = z
      .object({ product: z.object({ version: z.number() }) })
      .parse(
        (await callApi('get', 'admin', `/api/admin/products/${productId}`, { cookie: manager }))
          .body,
      );
    const archived = await callApi('post', 'admin', `/api/admin/products/${productId}/status`, {
      cookie: manager,
      body: { expectedVersion: current.product.version, status: 'ARCHIVED' },
    });
    expect(archived.status).toBe(200);
    const hidden = await callApi('get', 'admin', `/api/admin/products?search=${slug}`, {
      cookie: manager,
    });
    expect(z.object({ totalCount: z.number() }).parse(hidden.body).totalCount).toBe(0);
  });
});

describe('conflicts over HTTP', () => {
  it('answers 409 for a duplicate type code, slug and SKU', async () => {
    const code = `dup_${runId}`;
    expect(
      (
        await callApi('post', 'admin', '/api/admin/product-types', {
          cookie: manager,
          body: { code, name: 'One' },
        })
      ).status,
    ).toBe(201);
    const duplicateType = await callApi('post', 'admin', '/api/admin/product-types', {
      cookie: manager,
      body: { code, name: 'Two' },
    });
    expect(duplicateType.status).toBe(409);
    expect(errorCode(duplicateType.body)).toBe('PRODUCT_TYPE_CODE_TAKEN');

    const productId = await createProduct(`sku-${runId}`);
    const sku = `DUP-${runId}`.toUpperCase();
    const variant = { sku, optionValues: { size: 'M' }, ...measurements };
    expect(
      (
        await callApi('post', 'admin', `/api/admin/products/${productId}/variants`, {
          cookie: manager,
          body: variant,
        })
      ).status,
    ).toBe(201);
    const duplicateSku = await callApi(
      'post',
      'admin',
      `/api/admin/products/${productId}/variants`,
      {
        cookie: manager,
        body: { ...variant, optionValues: { size: 'L' } },
      },
    );
    expect(duplicateSku.status).toBe(409);
    expect(errorEnvelope.parse(duplicateSku.body).error).toMatchObject({
      code: 'SKU_TAKEN',
      details: { sku },
    });
  });

  it('lets exactly one of five concurrent edits from the same version win', async () => {
    const productId = await createProduct(`concurrent-${runId}`);
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, attempt) =>
        callApi('patch', 'admin', `/api/admin/products/${productId}`, {
          cookie: manager,
          body: { expectedVersion: 0, name: `Concurrent edit ${attempt}` },
        }),
      ),
    );
    const statuses = responses.map(({ status }) => status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409]);
    for (const response of responses.filter(({ status }) => status === 409)) {
      expect(errorCode(response.body)).toBe('STALE_PRODUCT');
    }
  });

  it('reorders images with PUT and refuses a stale order', async () => {
    const productId = await createProduct(`media-${runId}`);
    const ids: string[] = [];
    for (const seed of ['a', 'b']) {
      const response = await callApi('post', 'admin', `/api/admin/products/${productId}/media`, {
        cookie: manager,
        body: { url: `https://picsum.photos/seed/${seed}/600/800`, altText: `Photo ${seed}` },
      });
      ids.push(z.object({ media: idSchema }).parse(response.body).media.id);
    }
    const reordered = await callApi(
      'put',
      'admin',
      `/api/admin/products/${productId}/media/order`,
      {
        cookie: manager,
        body: { mediaIds: [...ids].reverse() },
      },
    );
    expect(reordered.status).toBe(200);
    const stale = await callApi('put', 'admin', `/api/admin/products/${productId}/media/order`, {
      cookie: manager,
      body: { mediaIds: [ids[0]] },
    });
    expect(stale.status).toBe(409);
    expect(errorCode(stale.body)).toBe('STALE_MEDIA_ORDER');
    const removed = await callApi('delete', 'admin', `/api/admin/media/${ids[0] ?? unknownId}`, {
      cookie: manager,
    });
    expect(removed.status).toBe(200);
  });
});

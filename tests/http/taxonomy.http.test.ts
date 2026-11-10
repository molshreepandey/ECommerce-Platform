import { randomInt } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { callApi } from './app-server';
import { catalogueApi, errorCode, idSchema, staffCookie } from './support/catalogue-api';

const runId = `${Date.now().toString(36)}${randomInt(1_000_000).toString(36)}`;

let manager = '';
let support = '';
let inventory = '';
const { createProduct } = catalogueApi(() => manager);

beforeAll(async () => {
  manager = await staffCookie('catalogue.manager@demo-store.test');
  support = await staffCookie('support@demo-store.test');
  inventory = await staffCookie('inventory.manager@demo-store.test');
});

const categoryBody = z.object({
  category: idSchema.extend({ path: z.string(), level: z.number() }),
});
const groupBody = z.object({
  productGroup: idSchema.extend({
    memberCount: z.number(),
    members: z.array(idSchema.extend({ groupDisplayOrder: z.number().nullable() })).optional(),
  }),
});

async function createCategory(name: string, parentId: string | null): Promise<string> {
  const response = await callApi('post', 'admin', '/api/admin/categories', {
    cookie: manager,
    body: { name, slug: `${name.toLowerCase().replaceAll(' ', '-')}-${runId}`, parentId },
  });
  expect(response.status, name).toBe(201);
  return categoryBody.parse(response.body).category.id;
}

async function createGroup(name: string): Promise<string> {
  const response = await callApi('post', 'admin', '/api/admin/product-groups', {
    cookie: manager,
    body: { name: `${name} ${runId}` },
  });
  expect(response.status).toBe(201);
  return groupBody.parse(response.body).productGroup.id;
}

describe('who may change categories, tagging and groups', () => {
  it('answers 401 without a session and 403 for staff without taxonomy.write', async () => {
    expect((await callApi('get', 'admin', '/api/admin/categories')).status).toBe(401);
    for (const cookie of [support, inventory]) {
      expect((await callApi('get', 'admin', '/api/admin/categories', { cookie })).status).toBe(200);
      expect((await callApi('get', 'admin', '/api/admin/product-groups', { cookie })).status).toBe(
        200,
      );
      // Every write handler: the permission is checked before the id is looked up or the body validated.
      const someId = '0195f2a0-0000-7000-8000-000000000999';
      for (const [method, path, body] of [
        ['post', '/api/admin/categories', { name: 'Nope' }],
        ['patch', `/api/admin/categories/${someId}`, { name: 'Nope' }],
        ['delete', `/api/admin/categories/${someId}`, undefined],
        ['post', `/api/admin/categories/${someId}/move`, { parentId: null }],
        ['post', `/api/admin/categories/${someId}/status`, { isActive: false }],
        ['post', '/api/admin/tagging', { productIds: [someId], categoryId: null }],
        ['post', '/api/admin/product-groups', { name: 'Nope' }],
        ['patch', `/api/admin/product-groups/${someId}`, { name: 'Nope' }],
        ['delete', `/api/admin/product-groups/${someId}`, undefined],
        ['post', `/api/admin/product-groups/${someId}/members`, { productIds: [someId] }],
        ['put', `/api/admin/product-groups/${someId}/members`, { members: [] }],
        ['delete', `/api/admin/product-groups/${someId}/members/${someId}`, undefined],
      ] as const) {
        const response = await callApi(method, 'admin', path, {
          cookie,
          ...(body === undefined ? {} : { body }),
        });
        expect(response.status, `${method} ${path}`).toBe(403);
        expect(errorCode(response.body)).toBe('PERMISSION_DENIED');
      }
    }
  });

  it('refuses a cross-site delete and invalid input', async () => {
    const categoryId = await createCategory('Crosssite', null);
    const crossSite = await callApi('delete', 'admin', `/api/admin/categories/${categoryId}`, {
      cookie: manager,
      origin: 'https://evil.example',
    });
    expect(crossSite.status).toBe(403);
    expect(errorCode(crossSite.body)).toBe('ORIGIN_NOT_ALLOWED');
    for (const [method, path, body] of [
      ['post', '/api/admin/categories', { name: 'X' }],
      ['post', '/api/admin/categories', { name: 'Bad slug', slug: 'Bad Slug' }],
      ['post', `/api/admin/categories/${categoryId}/move`, { parentId: 'not-a-uuid' }],
      ['post', '/api/admin/tagging', { productIds: [], categoryId: null }],
      ['put', '/api/admin/product-groups/not-a-uuid/members', { members: [] }],
    ] as const) {
      const response = await callApi(method, 'admin', path, { cookie: manager, body });
      expect(response.status, `${method} ${path}`).toBe(400);
    }
  });
});

describe('category tree and tagging over HTTP', () => {
  it('enforces depth, cycles and leaf-only tagging, and only deletes an empty leaf', async () => {
    const root = await createCategory('Apparel', null);
    const level2 = await createCategory('Men', root);
    const level3 = await createCategory('Topwear', level2);
    const level4 = await createCategory('Shirts', level3);

    const tooDeep = await callApi('post', 'admin', '/api/admin/categories', {
      cookie: manager,
      body: { name: 'Formal', parentId: level4 },
    });
    expect(tooDeep.status).toBe(422);
    expect(errorCode(tooDeep.body)).toBe('CATEGORY_TOO_DEEP');

    const cycle = await callApi('post', 'admin', `/api/admin/categories/${root}/move`, {
      cookie: manager,
      body: { parentId: level3 },
    });
    expect(cycle.status).toBe(409);
    expect(errorCode(cycle.body)).toBe('CATEGORY_MOVE_CYCLE');

    const productId = await createProduct(`tagged-${runId}`);
    const nonLeaf = await callApi('post', 'admin', '/api/admin/tagging', {
      cookie: manager,
      body: { productIds: [productId], categoryId: level3 },
    });
    expect(nonLeaf.status).toBe(422);
    expect(errorCode(nonLeaf.body)).toBe('CATEGORY_NOT_LEAF');

    const tagged = await callApi('post', 'admin', '/api/admin/tagging', {
      cookie: manager,
      body: { productIds: [productId], categoryId: level4 },
    });
    expect(tagged.status).toBe(200);
    expect(tagged.body).toMatchObject({ changedProductIds: [productId] });

    const tree = await callApi('get', 'admin', '/api/admin/categories', { cookie: support });
    const nodes = z
      .object({ categories: z.array(idSchema.extend({ productCount: z.number() })) })
      .parse(tree.body).categories;
    expect(nodes.find(({ id }) => id === root)?.productCount).toBe(1);

    const blocked = await callApi('delete', 'admin', `/api/admin/categories/${level4}`, {
      cookie: manager,
    });
    expect(blocked.status).toBe(409);
    expect(errorCode(blocked.body)).toBe('CATEGORY_HAS_PRODUCTS');

    await callApi('post', 'admin', '/api/admin/tagging', {
      cookie: manager,
      body: { productIds: [productId], categoryId: null },
    });
    const deleted = await callApi('delete', 'admin', `/api/admin/categories/${level4}`, {
      cookie: manager,
    });
    expect(deleted.status).toBe(204);
  });
});

describe('product groups over HTTP', () => {
  it('adds, reorders with swatches, removes and deletes, refusing stale orders and second groups', async () => {
    const [first, second] = [
      await createProduct(`group-a-${runId}`),
      await createProduct(`group-b-${runId}`),
    ];
    const groupId = await createGroup('Prints');
    const added = await callApi('post', 'admin', `/api/admin/product-groups/${groupId}/members`, {
      cookie: manager,
      body: { productIds: [first, second] },
    });
    expect(added.status).toBe(200);
    expect(groupBody.parse(added.body).productGroup.memberCount).toBe(2);

    const otherGroup = await createGroup('Colours');
    const elsewhere = await callApi(
      'post',
      'admin',
      `/api/admin/product-groups/${otherGroup}/members`,
      {
        cookie: manager,
        body: { productIds: [first] },
      },
    );
    expect(elsewhere.status).toBe(409);
    expect(errorCode(elsewhere.body)).toBe('PRODUCT_IN_ANOTHER_GROUP');

    const reordered = await callApi(
      'put',
      'admin',
      `/api/admin/product-groups/${groupId}/members`,
      {
        cookie: manager,
        body: {
          members: [
            { productId: second, swatchLabel: 'Indigo' },
            { productId: first, swatchLabel: 'Rust' },
          ],
        },
      },
    );
    expect(reordered.status).toBe(200);
    const stale = await callApi('put', 'admin', `/api/admin/product-groups/${groupId}/members`, {
      cookie: manager,
      body: { members: [{ productId: first, swatchLabel: null }] },
    });
    expect(stale.status).toBe(409);
    expect(errorCode(stale.body)).toBe('STALE_GROUP_MEMBERS');

    const removed = await callApi(
      'delete',
      'admin',
      `/api/admin/product-groups/${groupId}/members/${second}`,
      { cookie: manager },
    );
    expect(removed.status).toBe(200);
    expect(groupBody.parse(removed.body).productGroup.memberCount).toBe(1);
    expect(
      (
        await callApi('delete', 'admin', `/api/admin/product-groups/${groupId}`, {
          cookie: manager,
        })
      ).status,
    ).toBe(204);
    expect(
      (await callApi('get', 'admin', `/api/admin/product-groups/${groupId}`, { cookie: manager }))
        .status,
    ).toBe(404);
  });

  it('gives a product to only one group when two groups claim it at the same time', async () => {
    const productId = await createProduct(`claimed-${runId}`);
    const [left, right] = [await createGroup('Left'), await createGroup('Right')];
    const responses = await Promise.all(
      [left, right].map((groupId) =>
        callApi('post', 'admin', `/api/admin/product-groups/${groupId}/members`, {
          cookie: manager,
          body: { productIds: [productId] },
        }),
      ),
    );
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
  });
});

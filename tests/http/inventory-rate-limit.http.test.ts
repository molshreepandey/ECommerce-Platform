import { randomInt, randomUUID } from 'node:crypto';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadConfigFile } from '../../src/lib/config/load-config';
import { waitForFreshRateLimitWindow } from '../integration/support/rate-limit-window';
import { callApi } from './app-server';
import {
  catalogueApi,
  errorCode,
  errorEnvelope,
  idSchema,
  staffCookie,
} from './support/catalogue-api';
import { runOnTestDatabase } from './support/test-database-writer';

// The per-staff write budget on the admin inventory API (policy `inventory-write`, TD-020). Each test
// uses its own staff members, created for this run, so no other test file shares their budget.

const runId = `${Date.now().toString(36)}${randomInt(1_000_000).toString(36)}`.toUpperCase();
const policy = loadConfigFile(path.resolve(process.cwd(), 'config', 'config.test.json')).rateLimits[
  'inventory-write'
];
// Small bursts keep the database pool (20 connections in config.test.json) free for the other HTTP test
// files that run at the same time.
const batchSize = 10;

const writeRoutes = (): ['post' | 'put' | 'patch', string][] => [
  ['post', '/api/admin/inventory/adjustments'],
  ['post', '/api/admin/inventory/receipts'],
  ['put', '/api/admin/inventory/thresholds'],
  ['post', '/api/admin/warehouses'],
  ['patch', `/api/admin/warehouses/${warehouseId}`],
  ['post', `/api/admin/warehouses/${warehouseId}/status`],
];

// The budget is counted in clock-aligned windows. Each test starts in a fresh window with enough time
// left and then checks it is still in that window, so a slow run fails with a clear message instead of
// silently counting in two windows.
function windowIndex(): number {
  return Math.floor(Date.now() / (policy.windowSeconds * 1_000));
}

async function startInFreshWindow(): Promise<number> {
  await waitForFreshRateLimitWindow(policy.windowSeconds, 12_000);
  return windowIndex();
}

// Called right after a response arrives and before its status is checked: if the window is unchanged
// now, the server counted that request (and the whole burst before it) in the starting window.
function expectSameWindow(started: number): void {
  expect(windowIndex(), 'the requests crossed a rate-limit window boundary').toBe(started);
}

let inventoryManager = '';
let support = '';
let warehouseId = '';
let variantId = '';

const stockRequestBody = z.object({
  stockRequest: z.object({ changeRequestId: z.uuid(), replayed: z.boolean() }),
});

function roleCode(label: string): string {
  return `RATE_${label.toUpperCase()}_${runId}`;
}

// A staff member whose one role has exactly `permissionCodes`, created on the guarded test database with
// the demo password hash copied from an existing demo account.
async function newStaff(label: string, permissionCodes: readonly string[]): Promise<string> {
  const email = `rate.${label}.${runId.toLowerCase()}@demo-store.test`;
  await runOnTestDatabase(
    `WITH new_role AS (
       INSERT INTO roles (code, name, description) VALUES ($1, 'Rate-limit test', 'HTTP test role')
       RETURNING id),
     granted AS (
       INSERT INTO role_permissions (role_id, permission_id)
       SELECT new_role.id, permissions.id FROM new_role, permissions
       WHERE permissions.code = ANY($3::text[])),
     new_staff AS (
       INSERT INTO staff_users (full_name, email, password_hash)
       SELECT 'Rate Limit Test', $2, password_hash FROM staff_users WHERE email = 'support@demo-store.test'
       RETURNING id)
     INSERT INTO staff_user_roles (staff_user_id, role_id)
     SELECT new_staff.id, new_role.id FROM new_staff, new_role`,
    [roleCode(label), email, [...permissionCodes]],
  );
  return staffCookie(email);
}

// A staff member with inventory write access.
function newInventoryStaff(label: string): Promise<string> {
  return newStaff(label, ['inventory.read', 'inventory.write', 'warehouses.write']);
}

// Adds a permission to the test role of `label`. Permissions are read from the database on every
// request (access-control.ts), so the change applies to the next request of an existing session.
async function grantPermission(label: string, permissionCode: string): Promise<void> {
  const added = await runOnTestDatabase(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT roles.id, permissions.id FROM roles, permissions WHERE roles.code = $1 AND permissions.code = $2`,
    [roleCode(label), permissionCode],
  );
  expect(added).toBe(1);
}

// A write that passes the session, permission and rate-limit checks and then stops at the missing
// Idempotency-Key (400), so it uses budget without changing anything.
function countedWrite(cookie: string) {
  return callApi('post', 'admin', '/api/admin/inventory/adjustments', {
    cookie,
    body: { operation: 'ADD', variantId, warehouseId, quantity: 1, reason: 'Budget' },
  });
}

async function useWholeBudget(cookie: string): Promise<void> {
  let sent = 0;
  while (sent < policy.maxRequests) {
    const batch = Math.min(batchSize, policy.maxRequests - sent);
    const responses = await Promise.all(Array.from({ length: batch }, () => countedWrite(cookie)));
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(errorCode(response.body)).toBe('IDEMPOTENCY_KEY_REQUIRED');
    }
    sent += batch;
  }
}

async function onHand(): Promise<number> {
  const response = await callApi(
    'get',
    'admin',
    `/api/admin/inventory/movements?warehouseId=${warehouseId}&variantId=${variantId}`,
    { cookie: support },
  );
  expect(response.status).toBe(200);
  const movements = z
    .object({ movements: z.array(z.object({ onHandAfter: z.number() })) })
    .parse(response.body).movements;
  return movements[0]?.onHandAfter ?? 0;
}

function retryAfterSeconds(response: { headers: Record<string, unknown> }): number {
  return Number(response.headers['retry-after']);
}

beforeAll(async () => {
  [inventoryManager, support] = await Promise.all([
    staffCookie('inventory.manager@demo-store.test'),
    staffCookie('support@demo-store.test'),
  ]);
  const catalogueManager = await staffCookie('catalogue.manager@demo-store.test');
  const productId = await catalogueApi(() => catalogueManager).createProduct(
    `rate-${runId.toLowerCase()}`,
  );
  const variant = await callApi('post', 'admin', `/api/admin/products/${productId}/variants`, {
    cookie: catalogueManager,
    body: {
      sku: `RATE-${runId}-M`,
      optionValues: { size: 'M' },
      mrpPaise: 99_900,
      pricePaise: 79_900,
      weightGrams: 300,
      lengthMm: 300,
      breadthMm: 250,
      heightMm: 30,
    },
  });
  expect(variant.status).toBe(201);
  variantId = z.object({ variant: idSchema }).parse(variant.body).variant.id;
  const warehouse = await callApi('post', 'admin', '/api/admin/warehouses', {
    cookie: inventoryManager,
    body: {
      code: `RL${runId}`,
      name: 'Rate-limit warehouse',
      addressLine1: '14, Industrial Area Phase 2',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560058',
      contactName: 'Store Keeper',
      contactPhone: '9876543210',
      priority: 90,
    },
  });
  expect(warehouse.status).toBe(201);
  warehouseId = z.object({ warehouse: idSchema }).parse(warehouse.body).warehouse.id;
  // Warm every write route without a session (401, before the budget): on `next dev` the first request
  // compiles the route, which must not happen inside a timed burst.
  for (const [method, routePath] of writeRoutes()) {
    expect((await callApi(method, 'admin', routePath, { body: {} })).status).toBe(401);
  }
  expect((await callApi('get', 'admin', '/api/admin/inventory/movements')).status).toBe(401);
});

describe('inventory write rate limit', () => {
  it('stops one staff member after the budget with the standard 429, across all write routes, leaving reads and other staff alone', async () => {
    const limited = await newInventoryStaff('a');
    const colleague = await newInventoryStaff('b');
    const window = await startInFreshWindow();
    await useWholeBudget(limited);

    for (const [method, routePath, body] of [
      ['post', '/api/admin/inventory/adjustments', { operation: 'ADD' }],
      ['post', '/api/admin/inventory/receipts', { warehouseId }],
      ['put', '/api/admin/inventory/thresholds', { variantId, warehouseId, lowStockThreshold: 1 }],
      ['post', '/api/admin/warehouses', { code: 'NOPE' }],
      ['patch', `/api/admin/warehouses/${warehouseId}`, { name: 'Nope' }],
      ['post', `/api/admin/warehouses/${warehouseId}/status`, { isActive: false }],
    ] as const) {
      const response = await callApi(method, 'admin', routePath, { cookie: limited, body });
      expectSameWindow(window);
      expect(response.status, `${method} ${routePath}`).toBe(429);
      const { error } = errorEnvelope.parse(response.body);
      expect(error.code).toBe('RATE_LIMITED');
      const seconds = retryAfterSeconds(response);
      expect(seconds).toBeGreaterThanOrEqual(1);
      expect(seconds).toBeLessThanOrEqual(policy.windowSeconds);
      expect(error.details).toEqual({ retryAfterSeconds: seconds });
      expect(JSON.stringify(response.body)).not.toMatch(/inventory-write|ratelimit|[0-9a-f]{64}/);
    }

    // Reads are not limited; another staff member has a budget of their own.
    expect(
      (await callApi('get', 'admin', '/api/admin/inventory/movements', { cookie: limited })).status,
    ).toBe(200);
    const other = await countedWrite(colleague);
    expect(other.status).toBe(400);
    expect(errorCode(other.body)).toBe('IDEMPOTENCY_KEY_REQUIRED');
  }, 60_000);

  it('checks the session and permission before the budget: anonymous and read-only callers never get 429', async () => {
    const limited = await newInventoryStaff('c');
    const window = await startInFreshWindow();
    await useWholeBudget(limited);
    const overBudget = await countedWrite(limited);
    expectSameWindow(window);
    expect(overBudget.status).toBe(429);

    const anonymous = await countedWrite('');
    expect(anonymous.status).toBe(401);
    const readOnly = await countedWrite(support);
    expect(readOnly.status).toBe(403);
    expect(errorCode(readOnly.body)).toBe('PERMISSION_DENIED');
  }, 60_000);

  it('checks permission before the budget on adjustments and warehouse writes: 201 refused writes leave the whole budget of 200', async () => {
    // A staff member with only inventory.read sends maxRequests + 1 writes, alternating between the
    // adjustments route and a warehouse write route; every one must be 403, never 429. The same session is
    // then granted inventory.write and must still get exactly maxRequests writes past the budget check
    // (400 for the missing Idempotency-Key) before the next one is 429. If either route counted a refused
    // write before checking the permission, a refused write or one of the maxRequests writes would get 429.
    const readOnly = await newStaff('e', ['inventory.read']);
    const window = await startInFreshWindow();
    const refusedWrite = (index: number) =>
      index % 2 === 0
        ? countedWrite(readOnly)
        : callApi('patch', 'admin', `/api/admin/warehouses/${warehouseId}`, {
            cookie: readOnly,
            body: { name: 'Not allowed' },
          });
    let refused = 0;
    while (refused <= policy.maxRequests) {
      const batch = Math.min(batchSize, policy.maxRequests + 1 - refused);
      const responses = await Promise.all(
        Array.from({ length: batch }, (_, offset) => refusedWrite(refused + offset)),
      );
      expectSameWindow(window);
      for (const response of responses) {
        expect(response.status).not.toBe(429);
        expect(response.status).toBe(403);
        expect(errorCode(response.body)).toBe('PERMISSION_DENIED');
      }
      refused += batch;
    }
    expect(refused).toBe(policy.maxRequests + 1);

    // Same staff member, same session, same window, now allowed to write stock.
    await grantPermission('e', 'inventory.write');
    let allowed = 0;
    while (allowed < policy.maxRequests) {
      const batch = Math.min(batchSize, policy.maxRequests - allowed);
      const responses = await Promise.all(
        Array.from({ length: batch }, () => countedWrite(readOnly)),
      );
      expectSameWindow(window);
      for (const response of responses) {
        expect(response.status).toBe(400);
        expect(errorCode(response.body)).toBe('IDEMPOTENCY_KEY_REQUIRED');
      }
      allowed += batch;
    }
    expect(allowed).toBe(policy.maxRequests);

    const overBudget = await countedWrite(readOnly);
    expectSameWindow(window);
    expect(overBudget.status).toBe(429);
    expect(errorCode(overBudget.body)).toBe('RATE_LIMITED');
    const seconds = retryAfterSeconds(overBudget);
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(seconds).toBeLessThanOrEqual(policy.windowSeconds);
    expect(errorEnvelope.parse(overBudget.body).error.details).toEqual({
      retryAfterSeconds: seconds,
    });
  }, 60_000);

  it('applies nothing when limited; a retry with the same Idempotency-Key after Retry-After applies once, then replays', async () => {
    const limited = await newInventoryStaff('d');
    const window = await startInFreshWindow();
    const before = await onHand();
    await useWholeBudget(limited);

    const key = randomUUID();
    const body = { operation: 'ADD', variantId, warehouseId, quantity: 3, reason: 'Late delivery' };
    const refused = await callApi('post', 'admin', '/api/admin/inventory/adjustments', {
      cookie: limited,
      body,
    }).set('Idempotency-Key', key);
    expectSameWindow(window);
    expect(refused.status).toBe(429);
    expect(await onHand()).toBe(before);

    await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds(refused) * 1_000 + 250));
    const applied = await callApi('post', 'admin', '/api/admin/inventory/adjustments', {
      cookie: limited,
      body,
    }).set('Idempotency-Key', key);
    expect(applied.status).toBe(201);
    const replayed = await callApi('post', 'admin', '/api/admin/inventory/adjustments', {
      cookie: limited,
      body,
    }).set('Idempotency-Key', key);
    expect(replayed.status).toBe(200);
    expect(stockRequestBody.parse(replayed.body).stockRequest).toEqual({
      changeRequestId: stockRequestBody.parse(applied.body).stockRequest.changeRequestId,
      replayed: true,
    });
    expect(await onHand()).toBe(before + 3);
  }, 60_000);
});

import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { InventoryMovementType } from '@/generated/prisma/enums';
import {
  foreignKeyViolationConstraintName,
  getDatabase,
  isForeignKeyViolation,
  isUniqueViolation,
  uniqueViolationConstraintName,
} from '@/lib/db';

import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();
const receiptMigration = '20261110150000_inventory_receipt_movement_type';
const ledgerMigration = '20261110150100_inventory_ledger_integrity';
const fingerprint = 'a'.repeat(64);

async function createLocation() {
  const productType = await database.productType.create({
    data: { code: 'apparel', name: 'Apparel' },
    select: { id: true },
  });
  const brand = await database.brand.create({
    data: { name: 'Test Brand', slug: 'test-brand' },
    select: { id: true },
  });
  const product = await database.product.create({
    data: {
      productTypeId: productType.id,
      brandId: brand.id,
      name: 'Test Kurta',
      slug: 'test-kurta',
      taxRateBasisPoints: 500,
    },
    select: { id: true },
  });
  const variant = await database.productVariant.create({
    data: {
      productId: product.id,
      sku: 'TEST-KURTA-M',
      optionSignature: 'size=M',
      mrpPaise: 99_900,
      pricePaise: 79_900,
      weightGrams: 300,
      lengthMm: 300,
      breadthMm: 250,
      heightMm: 30,
    },
    select: { id: true },
  });
  const warehouse = await database.warehouse.create({
    data: {
      code: 'WH-TEST',
      name: 'Test Warehouse',
      addressLine1: '1 Test Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      contactName: 'Test Contact',
      contactPhone: '9876500000',
      priority: 1,
    },
    select: { id: true },
  });
  return { variantId: variant.id, warehouseId: warehouse.id };
}

async function createStaffUser(email: string) {
  return database.staffUser.create({
    data: { fullName: 'Stock Keeper', email, passwordHash: 'not-a-real-hash' },
    select: { id: true },
  });
}

type Location = Awaited<ReturnType<typeof createLocation>>;

function recordMovement(
  location: Location,
  movement: {
    movementType: InventoryMovementType;
    quantityDelta: number;
    onHandAfter?: number;
    reservedAfter?: number;
    reason?: string | null;
  },
) {
  return database.inventoryMovement.create({
    data: {
      ...location,
      movementType: movement.movementType,
      quantityDelta: movement.quantityDelta,
      onHandAfter: movement.onHandAfter ?? 10,
      reservedAfter: movement.reservedAfter ?? 0,
      reason: movement.reason ?? null,
      actorType: 'SYSTEM',
    },
    select: { id: true },
  });
}

function createChangeRequest(
  staffUserId: string,
  idempotencyKey: string,
  requestFingerprint = fingerprint,
) {
  return database.inventoryChangeRequest.create({
    data: { staffUserId, idempotencyKey, requestFingerprint },
    select: { id: true },
  });
}

function constraintOf(error: unknown): string | null {
  if (isUniqueViolation(error)) return uniqueViolationConstraintName(error);
  if (isForeignKeyViolation(error)) return foreignKeyViolationConstraintName(error);
  return null;
}

type Transaction = Parameters<Parameters<typeof database.$transaction>[0]>[0];

// The insert the stock services will use: the first request for a key gets a row, a duplicate gets none.
async function insertRequestIfNew(
  transaction: Transaction,
  input: { staffUserId: string; idempotencyKey: string; requestFingerprint: string },
): Promise<string | null> {
  const [inserted] = z
    .array(z.object({ id: z.string() }))
    .max(1)
    .parse(
      await transaction.$queryRaw`
        INSERT INTO inventory_change_requests (staff_user_id, idempotency_key, request_fingerprint)
        VALUES (${input.staffUserId}::uuid, ${input.idempotencyKey}, ${input.requestFingerprint})
        ON CONFLICT (staff_user_id, idempotency_key) DO NOTHING
        RETURNING id::text AS id`,
    );
  return inserted?.id ?? null;
}

async function backendProcessId(transaction: Transaction): Promise<number> {
  const [row] = z
    .tuple([z.object({ pid: z.number() })])
    .parse(await transaction.$queryRaw`SELECT pg_backend_pid() AS pid`);
  return row.pid;
}

// Polls from a third connection until PostgreSQL reports that `waiter` is blocked by `holder`.
async function waitUntilBlocked(waiter: number, holder: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const [row] = z
      .tuple([z.object({ blockers: z.array(z.number()) })])
      .parse(await database.$queryRaw`SELECT pg_blocking_pids(${waiter}::int) AS blockers`);
    if (row.blockers.includes(holder)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`backend ${String(waiter)} was never blocked by backend ${String(holder)}`);
}

class StockValidationFailed extends Error {}

// Two duplicate requests on two connections: the first inserts the request row and holds its transaction
// open; the second starts only then, and must wait on the unique index until the first commits or rolls back.
async function raceTwoDuplicates(input: {
  firstOutcome: 'commit' | 'rollback';
  secondFingerprint: string;
}) {
  const keeper = await createStaffUser('keeper@example.test');
  const idempotencyKey = randomUUID();
  const firstHoldsRow = Promise.withResolvers<{ pid: number; requestId: string | null }>();
  const releaseFirst = Promise.withResolvers<undefined>();
  const secondConnected = Promise.withResolvers<number>();

  const first = database
    .$transaction(
      async (transaction) => {
        const pid = await backendProcessId(transaction);
        const requestId = await insertRequestIfNew(transaction, {
          staffUserId: keeper.id,
          idempotencyKey,
          requestFingerprint: fingerprint,
        });
        firstHoldsRow.resolve({ pid, requestId });
        await releaseFirst.promise;
        if (input.firstOutcome === 'rollback') throw new StockValidationFailed('not enough stock');
        return requestId;
      },
      { timeout: 20_000 },
    )
    .then(
      (requestId) => ({ committed: true, requestId, error: null }),
      (error: unknown) => ({ committed: false, requestId: null, error }),
    );
  const holder = await firstHoldsRow.promise;

  let isSecondSettled = false;
  const second = database
    .$transaction(
      async (transaction) => {
        secondConnected.resolve(await backendProcessId(transaction));
        const insertedId = await insertRequestIfNew(transaction, {
          staffUserId: keeper.id,
          idempotencyKey,
          requestFingerprint: input.secondFingerprint,
        });
        const stored = await transaction.inventoryChangeRequest.findUniqueOrThrow({
          where: { staffUserId_idempotencyKey: { staffUserId: keeper.id, idempotencyKey } },
          select: { id: true, requestFingerprint: true },
        });
        return { insertedId, stored };
      },
      { timeout: 20_000 },
    )
    .finally(() => {
      isSecondSettled = true;
    });
  const waiter = await secondConnected.promise;

  await waitUntilBlocked(waiter, holder.pid);
  const wasStillWaiting = !isSecondSettled;
  releaseFirst.resolve(undefined);
  return {
    holderPid: holder.pid,
    waiterPid: waiter,
    firstInsertedId: holder.requestId,
    wasStillWaiting,
    first: await first,
    second: await second,
  };
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe(`inventory ledger migrations (${receiptMigration}, ${ledgerMigration})`, () => {
  it('are recorded as applied, add RECEIPT and replace the ledger indexes with id tiebreakers', async () => {
    const migrations = z
      .array(z.object({ migration_name: z.string() }))
      .parse(
        await database.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      )
      .map(({ migration_name }) => migration_name);
    expect(migrations).toEqual(expect.arrayContaining([receiptMigration, ledgerMigration]));

    const movementTypes = z
      .array(z.object({ label: z.string() }))
      .parse(
        await database.$queryRaw`SELECT enumlabel AS label FROM pg_enum WHERE enumtypid = '"InventoryMovementType"'::regtype ORDER BY enumsortorder`,
      )
      .map(({ label }) => label);
    expect(movementTypes).toEqual([
      'RESERVE',
      'RELEASE',
      'DISPATCH',
      'RETURN_RESTOCK',
      'RTO_RESTOCK',
      'ADJUSTMENT',
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'RECEIPT',
    ]);

    const indexes = new Map(
      z
        .array(z.object({ indexname: z.string(), indexdef: z.string() }))
        .parse(
          await database.$queryRaw`SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('inventory_movements', 'inventory_levels', 'inventory_change_requests')`,
        )
        .map(({ indexname, indexdef }) => [indexname, indexdef]),
    );
    expect(indexes.get('inventory_movements_created_at_id_idx')).toContain(
      '(created_at DESC, id DESC)',
    );
    expect(indexes.get('inventory_movements_variant_id_created_at_id_idx')).toContain(
      '(variant_id, created_at DESC, id DESC)',
    );
    expect(indexes.get('inventory_movements_warehouse_id_created_at_id_idx')).toContain(
      '(warehouse_id, created_at DESC, id DESC)',
    );
    expect(indexes.get('inventory_movements_movement_type_created_at_id_idx')).toContain(
      '(movement_type, created_at DESC, id DESC)',
    );
    expect(indexes.get('inventory_movements_reference_type_reference_id_idx')).toContain(
      '(reference_type, reference_id)',
    );
    expect(indexes.get('inventory_levels_low_stock_idx')).toContain(
      'WHERE ((available_quantity <= low_stock_threshold) AND (low_stock_threshold > 0))',
    );
    expect(indexes.get('inventory_change_requests_staff_user_id_idempotency_key_key')).toContain(
      'UNIQUE INDEX',
    );
    expect(indexes.has('inventory_movements_variant_id_created_at_idx')).toBe(false);
    expect(indexes.has('inventory_movements_warehouse_id_created_at_idx')).toBe(false);

    const unvalidated = z
      .tuple([z.object({ count: z.number() })])
      .parse(
        await database.$queryRaw`SELECT count(*)::int AS count FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND NOT convalidated`,
      );
    expect(unvalidated[0].count).toBe(0);
  });
});

describe('inventory movement rules', () => {
  it('refuses impossible quantities after a movement', async () => {
    const location = await createLocation();
    for (const after of [
      { onHandAfter: -1, reservedAfter: 0 },
      { onHandAfter: 5, reservedAfter: -1 },
      { onHandAfter: 5, reservedAfter: 6 },
    ]) {
      await expect(
        recordMovement(location, { movementType: 'RESERVE', quantityDelta: 1, ...after }),
      ).rejects.toThrow(/inventory_movements_quantities_after_check/);
    }
    await expect(
      recordMovement(location, {
        movementType: 'RESERVE',
        quantityDelta: 1,
        onHandAfter: 5,
        reservedAfter: 5,
      }),
    ).resolves.toHaveProperty('id');
  });

  it('allows each movement type to move stock in its own direction only', async () => {
    const location = await createLocation();
    const directions: readonly [InventoryMovementType, 'increase' | 'decrease'][] = [
      ['RESERVE', 'increase'],
      ['RELEASE', 'decrease'],
      ['DISPATCH', 'decrease'],
      ['RETURN_RESTOCK', 'increase'],
      ['RTO_RESTOCK', 'increase'],
      ['TRANSFER_OUT', 'decrease'],
      ['TRANSFER_IN', 'increase'],
      ['RECEIPT', 'increase'],
    ];
    for (const [movementType, direction] of directions) {
      const allowed = direction === 'increase' ? 2 : -2;
      for (const refused of [-allowed, 0]) {
        await expect(
          recordMovement(location, { movementType, quantityDelta: refused, reason: 'Count' }),
          `${movementType} ${String(refused)}`,
        ).rejects.toThrow(/inventory_movements_quantity_delta_sign_check/);
      }
      await expect(
        recordMovement(location, { movementType, quantityDelta: allowed, reason: 'Count' }),
      ).resolves.toHaveProperty('id');
    }
  });

  it('lets an adjustment move stock either way, including the zero of an empty opening location', async () => {
    const location = await createLocation();
    for (const quantityDelta of [-3, 0, 3]) {
      await expect(
        recordMovement(location, {
          movementType: 'ADJUSTMENT',
          quantityDelta,
          reason: 'Opening stock',
        }),
      ).resolves.toHaveProperty('id');
    }
  });

  it('requires a reason with a letter or digit for adjustments and receipts, and none for order movements', async () => {
    const location = await createLocation();
    const refusedReasons = [
      null,
      '',
      '   ',
      '\t',
      '\n',
      '\r\n',
      ' \t\n\t ',
      '\v\f',
      ' ',
      '　',
      '​',
      '﻿',
      '...',
      '-',
    ];
    const acceptedReasons = [
      'Damaged in transit',
      'Invoice 42',
      'क्षतिग्रस्त',
      'Défectueux',
      '破损',
    ];
    for (const movementType of ['ADJUSTMENT', 'RECEIPT'] as const) {
      for (const reason of refusedReasons) {
        await expect(
          recordMovement(location, { movementType, quantityDelta: 1, reason }),
          `${movementType} ${JSON.stringify(reason)}`,
        ).rejects.toThrow(/inventory_movements_reason_check/);
      }
      for (const reason of acceptedReasons) {
        await expect(
          recordMovement(location, { movementType, quantityDelta: 1, reason }),
          `${movementType} ${reason}`,
        ).resolves.toHaveProperty('id');
      }
    }
    await expect(
      recordMovement(location, { movementType: 'RESERVE', quantityDelta: 1, reason: null }),
    ).resolves.toHaveProperty('id');
  });
});

describe('idempotent staff stock requests', () => {
  it('stores a key once per staff member, while a new key with the same content is a separate request', async () => {
    const keeper = await createStaffUser('keeper@example.test');
    const colleague = await createStaffUser('colleague@example.test');
    const key = randomUUID();
    await createChangeRequest(keeper.id, key);

    const repeated = await createChangeRequest(keeper.id, key).catch((error: unknown) => error);
    expect(constraintOf(repeated)).toBe(
      'inventory_change_requests_staff_user_id_idempotency_key_key',
    );

    await expect(createChangeRequest(colleague.id, key)).resolves.toHaveProperty('id');
    await expect(createChangeRequest(keeper.id, randomUUID())).resolves.toHaveProperty('id');
    expect(await database.inventoryChangeRequest.count({ where: { staffUserId: keeper.id } })).toBe(
      2,
    );
  });

  it('refuses malformed keys and fingerprints', async () => {
    const keeper = await createStaffUser('keeper@example.test');
    for (const key of [
      'short',
      'has spaces in the key!!',
      'k'.repeat(101),
      'ключ-ключ-ключ-ключ',
    ]) {
      await expect(createChangeRequest(keeper.id, key), key).rejects.toThrow(
        /inventory_change_requests_idempotency_key_check/,
      );
    }
    for (const requestFingerprint of ['A'.repeat(64), 'a'.repeat(63) + 'g', 'a'.repeat(63)]) {
      await expect(
        createChangeRequest(keeper.id, randomUUID(), requestFingerprint),
        requestFingerprint,
      ).rejects.toThrow(/inventory_change_requests_request_fingerprint_check/);
    }
    await expect(createChangeRequest(keeper.id, 'k'.repeat(16))).resolves.toHaveProperty('id');
  });

  it('keeps exactly one request when the same key arrives ten times at once', async () => {
    const keeper = await createStaffUser('keeper@example.test');
    const key = randomUUID();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => createChangeRequest(keeper.id, key)),
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(constraintOf(result.reason)).toBe(
          'inventory_change_requests_staff_user_id_idempotency_key_key',
        );
      }
    }
    expect(await database.inventoryChangeRequest.count()).toBe(1);
  });

  it('lets concurrent duplicates find the winning request with ON CONFLICT, inside their own transactions', async () => {
    const keeper = await createStaffUser('keeper@example.test');
    const key = randomUUID();
    const insertedRowsSchema = z.array(z.object({ id: z.string() }));
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () =>
        database.$transaction(async (transaction) => {
          const inserted = insertedRowsSchema.parse(
            await transaction.$queryRaw`
              INSERT INTO inventory_change_requests (staff_user_id, idempotency_key, request_fingerprint)
              VALUES (${keeper.id}::uuid, ${key}, ${fingerprint})
              ON CONFLICT (staff_user_id, idempotency_key) DO NOTHING
              RETURNING id::text AS id`,
          );
          const stored = await transaction.inventoryChangeRequest.findUniqueOrThrow({
            where: { staffUserId_idempotencyKey: { staffUserId: keeper.id, idempotencyKey: key } },
            select: { id: true },
          });
          return { isFirst: inserted.length === 1, requestId: stored.id };
        }),
      ),
    );
    expect(outcomes.filter(({ isFirst }) => isFirst)).toHaveLength(1);
    expect(new Set(outcomes.map(({ requestId }) => requestId)).size).toBe(1);
  });

  it('makes a duplicate on another connection wait for the first, then find its committed request', async () => {
    const race = await raceTwoDuplicates({
      firstOutcome: 'commit',
      secondFingerprint: fingerprint,
    });
    expect(race.waiterPid).not.toBe(race.holderPid);
    expect(race.wasStillWaiting).toBe(true);
    expect(race.first).toMatchObject({ committed: true, requestId: race.firstInsertedId });
    expect(race.firstInsertedId).not.toBeNull();
    expect(race.second.insertedId).toBeNull();
    expect(race.second.stored).toEqual({
      id: race.firstInsertedId,
      requestFingerprint: fingerprint,
    });
    expect(await database.inventoryChangeRequest.count()).toBe(1);
  });

  it('shows a waiting duplicate with different content the stored fingerprint, so it can be refused', async () => {
    const otherFingerprint = 'b'.repeat(64);
    const race = await raceTwoDuplicates({
      firstOutcome: 'commit',
      secondFingerprint: otherFingerprint,
    });
    expect(race.wasStillWaiting).toBe(true);
    expect(race.second.insertedId).toBeNull();
    expect(race.second.stored.requestFingerprint).toBe(fingerprint);
    expect(race.second.stored.requestFingerprint).not.toBe(otherFingerprint);
    expect(await database.inventoryChangeRequest.count()).toBe(1);
  });

  it('makes the waiting duplicate the winner when the first transaction rolls back', async () => {
    const race = await raceTwoDuplicates({
      firstOutcome: 'rollback',
      secondFingerprint: fingerprint,
    });
    expect(race.wasStillWaiting).toBe(true);
    expect(race.first.committed).toBe(false);
    expect(race.first.error).toBeInstanceOf(StockValidationFailed);
    expect(race.second.insertedId).not.toBeNull();
    expect(race.second.insertedId).not.toBe(race.firstInsertedId);
    expect(race.second.stored.id).toBe(race.second.insertedId);
    const stored = await database.inventoryChangeRequest.findMany({ select: { id: true } });
    expect(stored).toEqual([{ id: race.second.insertedId }]);
  });

  it('rolls the request row back with everything else when stock validation fails in its transaction', async () => {
    const location = await createLocation();
    const level = { variantId: location.variantId, warehouseId: location.warehouseId };
    await database.inventoryLevel.create({
      data: { ...level, onHandQuantity: 5, reservedQuantity: 3 },
    });
    const keeper = await createStaffUser('keeper@example.test');
    const request = {
      staffUserId: keeper.id,
      idempotencyKey: randomUUID(),
      requestFingerprint: fingerprint,
    };

    // The database refuses: removing 4 of 5 would leave less on hand than the 3 reserved.
    await expect(
      database.$transaction(async (transaction) => {
        const requestId = await insertRequestIfNew(transaction, request);
        await transaction.inventoryMovement.create({
          data: {
            ...level,
            movementType: 'ADJUSTMENT',
            quantityDelta: -4,
            onHandAfter: 1,
            reservedAfter: 1,
            reason: 'Damaged',
            referenceType: 'inventory_change_request',
            referenceId: requestId,
            actorType: 'STAFF',
            actorId: keeper.id,
          },
        });
        await transaction.$executeRaw`
          UPDATE inventory_levels SET on_hand_quantity = on_hand_quantity - 4
          WHERE variant_id = ${level.variantId}::uuid AND warehouse_id = ${level.warehouseId}::uuid`;
      }),
    ).rejects.toThrow(/inventory_levels_quantities_check/);

    // The guarded update matches no row and the service refuses, with the same key.
    await expect(
      database.$transaction(async (transaction) => {
        await insertRequestIfNew(transaction, request);
        const changedRows = await transaction.$executeRaw`
          UPDATE inventory_levels SET on_hand_quantity = on_hand_quantity - 4
          WHERE variant_id = ${level.variantId}::uuid AND warehouse_id = ${level.warehouseId}::uuid
            AND on_hand_quantity - 4 >= reserved_quantity`;
        if (changedRows === 0) throw new StockValidationFailed('would go below reserved');
      }),
    ).rejects.toThrow(StockValidationFailed);

    expect(await database.inventoryChangeRequest.count()).toBe(0);
    expect(await database.inventoryMovement.count()).toBe(0);
    expect(
      await database.inventoryLevel.findUniqueOrThrow({
        where: { variantId_warehouseId: level },
        select: { onHandQuantity: true, reservedQuantity: true },
      }),
    ).toEqual({ onHandQuantity: 5, reservedQuantity: 3 });

    // Nothing persisted, so a retry with the same key runs as a new request.
    const retriedRequestId = await database.$transaction(async (transaction) => {
      const requestId = await insertRequestIfNew(transaction, request);
      await transaction.$executeRaw`
        UPDATE inventory_levels SET on_hand_quantity = on_hand_quantity - 1
        WHERE variant_id = ${level.variantId}::uuid AND warehouse_id = ${level.warehouseId}::uuid
          AND on_hand_quantity - 1 >= reserved_quantity`;
      return requestId;
    });
    expect(retriedRequestId).not.toBeNull();
    expect(await database.inventoryChangeRequest.count()).toBe(1);
  });

  it('belongs to an existing staff member, who cannot be deleted while requests point at them', async () => {
    const missingStaff = await createChangeRequest(randomUUID(), randomUUID()).catch(
      (error: unknown) => error,
    );
    expect(constraintOf(missingStaff)).toBe('inventory_change_requests_staff_user_id_fkey');

    const keeper = await createStaffUser('keeper@example.test');
    await createChangeRequest(keeper.id, randomUUID());
    const deletion = await database.staffUser
      .delete({ where: { id: keeper.id } })
      .catch((error: unknown) => error);
    expect(constraintOf(deletion)).toBe('inventory_change_requests_staff_user_id_fkey');
  });

  it('finds the movements of a request through the reference columns', async () => {
    const location = await createLocation();
    const keeper = await createStaffUser('keeper@example.test');
    const request = await createChangeRequest(keeper.id, randomUUID());
    await database.inventoryMovement.create({
      data: {
        ...location,
        movementType: 'RECEIPT',
        quantityDelta: 12,
        onHandAfter: 12,
        reservedAfter: 0,
        reason: 'Supplier invoice INV-1',
        referenceType: 'inventory_change_request',
        referenceId: request.id,
        actorType: 'STAFF',
        actorId: keeper.id,
      },
    });
    await recordMovement(location, {
      movementType: 'ADJUSTMENT',
      quantityDelta: 1,
      reason: 'Found',
    });
    const replayed = await database.inventoryMovement.findMany({
      where: { referenceType: 'inventory_change_request', referenceId: request.id },
      select: { movementType: true, quantityDelta: true },
    });
    expect(replayed).toEqual([{ movementType: 'RECEIPT', quantityDelta: 12 }]);
  });
});

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { type CustomerContext, requireCustomer } from '@/modules/identity/access-control';
import { AddressNotFoundError } from '@/modules/identity/address.errors';
import {
  archiveAddress,
  createAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress,
} from '@/modules/identity/address.service';
import { registerCustomer } from '@/modules/identity/customer-account.service';
import { createAddressSchema, type CreateAddressInput } from '@/modules/identity/identity.schema';

import { expectAuditTrailFreeOf, testMetadata } from './support/identity-fixtures';
import { truncateAllTestTables } from './support/test-database';
import { deleteTestRedisKeys } from './support/test-redis';

const database = getDatabase();

async function newCustomer(email: string, phone: string): Promise<CustomerContext> {
  const { session } = await registerCustomer(
    { fullName: 'Address Owner', email, phone, password: 'Address-Test-2026' },
    testMetadata(),
  );
  return requireCustomer(
    new NextRequest('http://store.localhost:3100/api/probe', {
      headers: { cookie: `store_session=${session.sessionToken}` },
    }),
  );
}

function addressInput(label: string, extra: Partial<CreateAddressInput> = {}): CreateAddressInput {
  return createAddressSchema.parse({
    recipientName: 'Kiran Rao',
    phone: '9876503000',
    addressLine1: `${label} MG Road`,
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
    ...extra,
  });
}

async function defaultAddressIds(customerId: string): Promise<string[]> {
  const rows = await database.customerAddress.findMany({
    where: { customerId, isDefault: true },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

let customer: CustomerContext;

beforeEach(async () => {
  await truncateAllTestTables();
  await deleteTestRedisKeys();
  customer = await newCustomer('address.owner@example.test', '9876503100');
});

describe('creating addresses', () => {
  it('makes the first address the default even when not asked to', async () => {
    const first = await createAddress(customer, addressInput('1'), testMetadata());
    expect(first.isDefault).toBe(true);
    const second = await createAddress(customer, addressInput('2'), testMetadata());
    expect(second.isDefault).toBe(false);
    expect(await defaultAddressIds(customer.customerId)).toEqual([first.id]);
  });

  it('moves the default when a new address asks to be the default', async () => {
    await createAddress(customer, addressInput('1'), testMetadata());
    const second = await createAddress(
      customer,
      addressInput('2', { isDefault: true }),
      testMetadata(),
    );
    expect(await defaultAddressIds(customer.customerId)).toEqual([second.id]);
  });

  it('keeps exactly one default when ten default addresses are created at once', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_unused, index) =>
        createAddress(customer, addressInput(`${index}`, { isDefault: true }), testMetadata()),
      ),
    );
    expect(results.every(({ status }) => status === 'fulfilled')).toBe(true);
    expect(
      await database.customerAddress.count({ where: { customerId: customer.customerId } }),
    ).toBe(10);
    expect(await defaultAddressIds(customer.customerId)).toHaveLength(1);
  });
});

describe('changing the default', () => {
  it('switches the default and audits the previous one', async () => {
    const first = await createAddress(customer, addressInput('1'), testMetadata());
    const second = await createAddress(customer, addressInput('2'), testMetadata());
    const result = await setDefaultAddress(customer, second.id, testMetadata());
    expect(result.isDefault).toBe(true);
    expect(await defaultAddressIds(customer.customerId)).toEqual([second.id]);
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'customer.default_address_changed' },
    });
    expect(audit).toMatchObject({
      entityId: second.id,
      after: { previousDefaultAddressId: first.id },
    });
  });

  it('does nothing (and audits nothing) when the address is already the default', async () => {
    const first = await createAddress(customer, addressInput('1'), testMetadata());
    await setDefaultAddress(customer, first.id, testMetadata());
    expect(
      await database.auditLog.count({ where: { action: 'customer.default_address_changed' } }),
    ).toBe(0);
  });

  it('ends with exactly one default when many default changes race', async () => {
    const addresses = [];
    for (let index = 0; index < 5; index += 1) {
      addresses.push(await createAddress(customer, addressInput(`${index}`), testMetadata()));
    }
    const results = await Promise.allSettled(
      [...addresses, ...addresses].map((address) =>
        setDefaultAddress(customer, address.id, testMetadata()),
      ),
    );
    expect(results.every(({ status }) => status === 'fulfilled')).toBe(true);
    expect(await defaultAddressIds(customer.customerId)).toHaveLength(1);
  });
});

describe('editing and archiving', () => {
  it('updates only the given fields and audits field names, not street or phone values', async () => {
    const address = await createAddress(customer, addressInput('1'), testMetadata());
    const updated = await updateAddress(
      customer,
      address.id,
      { addressLine1: '42 Residency Road', phone: '9876503999' },
      testMetadata(),
    );
    expect(updated).toMatchObject({
      addressLine1: '42 Residency Road',
      phone: '9876503999',
      city: 'Bengaluru',
    });
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'customer.address_updated' },
    });
    expect(audit.after).toEqual({
      changedFields: 'addressLine1,phone',
      city: 'Bengaluru',
      pincode: '560001',
    });
    await expectAuditTrailFreeOf(['42 Residency Road', '9876503999', '1 MG Road']);
  });

  it('archives the default and promotes the newest remaining address', async () => {
    const first = await createAddress(customer, addressInput('1'), testMetadata());
    await createAddress(customer, addressInput('2'), testMetadata());
    const third = await createAddress(customer, addressInput('3'), testMetadata());
    await archiveAddress(customer, first.id, testMetadata());

    const remaining = await listAddresses(customer);
    expect(remaining.map(({ id }) => id)).not.toContain(first.id);
    expect(remaining).toHaveLength(2);
    expect(await defaultAddressIds(customer.customerId)).toEqual([third.id]);

    const archived = await database.customerAddress.findUniqueOrThrow({ where: { id: first.id } });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.isDefault).toBe(false);
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'customer.address_archived' },
    });
    expect(audit.after).toEqual({ wasDefault: true, promotedAddressId: third.id });
  });

  it('leaves no default after the last address is archived', async () => {
    const only = await createAddress(customer, addressInput('1'), testMetadata());
    await archiveAddress(customer, only.id, testMetadata());
    expect(await listAddresses(customer)).toEqual([]);
    expect(await defaultAddressIds(customer.customerId)).toEqual([]);
  });

  it("answers 404 for another customer's address, an archived address or an unknown id", async () => {
    const intruder = await newCustomer('intruder@example.test', '9876503200');
    const address = await createAddress(customer, addressInput('1'), testMetadata());

    const attempts = [
      () => updateAddress(intruder, address.id, { city: 'Mysuru' }, testMetadata()),
      () => archiveAddress(intruder, address.id, testMetadata()),
      () => setDefaultAddress(intruder, address.id, testMetadata()),
      () => setDefaultAddress(customer, '01900000-0000-7000-8000-000000000000', testMetadata()),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toBeInstanceOf(AddressNotFoundError);
    }
    await archiveAddress(customer, address.id, testMetadata());
    await expect(
      updateAddress(customer, address.id, { city: 'Mysuru' }, testMetadata()),
    ).rejects.toMatchObject({
      httpStatus: 404,
      code: 'ADDRESS_NOT_FOUND',
    });
    const unchanged = await database.customerAddress.findUniqueOrThrow({
      where: { id: address.id },
    });
    expect(unchanged.city).toBe('Bengaluru');
  });
});

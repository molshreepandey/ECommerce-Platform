import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { getDatabase } from '@/lib/db';

import { currentDatabaseName, truncateAllTestTables } from './support/test-database';

const database = getDatabase();

function customerData(overrides: { email?: string; phone?: string } = {}) {
  return {
    fullName: 'Constraint Test',
    email: overrides.email ?? 'constraint.test@example.test',
    phone: overrides.phone ?? '9876500100',
    passwordHash: 'not-a-real-hash',
  };
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('identity constraints migration (20261107150000_identity_constraints)', () => {
  it('is recorded as applied in the test database, with the sessions expiry index', async () => {
    expect(await currentDatabaseName()).toBe('ecommerce_test');
    const migrations = z
      .array(z.object({ migration_name: z.string() }))
      .parse(
        await database.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`,
      );
    expect(migrations.map(({ migration_name }) => migration_name)).toEqual(
      expect.arrayContaining(['20261107000000_init', '20261107150000_identity_constraints']),
    );
    const indexes = z
      .array(z.object({ indexdef: z.string() }))
      .parse(
        await database.$queryRaw`SELECT indexdef FROM pg_indexes WHERE indexname = 'sessions_expires_at_idx'`,
      );
    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.indexdef).toContain('(expires_at)');
  });

  it('accepts a lower-case customer email and rejects any upper-case letter', async () => {
    await database.customer.create({ data: customerData() });
    await expect(
      database.customer.create({
        data: customerData({ email: 'Asha.Verma@example.test', phone: '9876500101' }),
      }),
    ).rejects.toThrow(/customers_email_lowercase_check/);
  });

  it('rejects an upper-case staff email', async () => {
    await expect(
      database.staffUser.create({
        data: {
          fullName: 'Staff Test',
          email: 'Ops@Demo-Store.test',
          passwordHash: 'not-a-real-hash',
        },
      }),
    ).rejects.toThrow(/staff_users_email_lowercase_check/);
    await database.staffUser.create({
      data: {
        fullName: 'Staff Test',
        email: 'ops@demo-store.test',
        passwordHash: 'not-a-real-hash',
      },
    });
    expect(await database.staffUser.count()).toBe(1);
  });

  it.each([
    ['a +91 prefix', '+919876500102'],
    ['spaces', '98765 00102'],
    ['only 9 digits', '987650010'],
    ['11 digits', '98765001023'],
    ['a leading 5', '5876500102'],
    ['letters', '98765OO102'],
  ])('rejects a customer phone with %s', async (_label, phone) => {
    await expect(database.customer.create({ data: customerData({ phone }) })).rejects.toThrow(
      /customers_phone_format_check/,
    );
  });

  it.each(['6000000000', '7123456789', '8999999999', '9876500103'])(
    'accepts the customer phone %s',
    async (phone) => {
      await database.customer.create({
        data: customerData({ phone, email: `phone.${phone}@example.test` }),
      });
      expect(await database.customer.count({ where: { phone } })).toBe(1);
    },
  );

  it('applies the same phone rule to addresses', async () => {
    const customer = await database.customer.create({ data: customerData(), select: { id: true } });
    const address = {
      customerId: customer.id,
      recipientName: 'Constraint Test',
      addressLine1: '1 Test Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    };
    await expect(
      database.customerAddress.create({ data: { ...address, phone: '+91 98765 00104' } }),
    ).rejects.toThrow(/customer_addresses_phone_format_check/);
    await database.customerAddress.create({ data: { ...address, phone: '9876500104' } });
    expect(await database.customerAddress.count()).toBe(1);
  });
});

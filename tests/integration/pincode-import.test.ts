import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { importServiceablePincodes } from '@/modules/fulfilment/pincode-import.service';

import { testMetadata } from './support/identity-fixtures';
import { createStaffMember } from './support/inventory-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof DomainError ? `${String(error.httpStatus)} ${error.code}` : String(error);
}

async function courier() {
  return database.courierPartner.create({
    data: { code: 'csv-courier', name: 'CSV Courier', adapterKey: 'demo_courier', priority: 1 },
    select: { id: true },
  });
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('serviceable pincode CSV upload (D41)', () => {
  it('saves valid rows, updates existing ones, and reports bad rows without writing them', async () => {
    const staff = await createStaffMember(['couriers.write']);
    const partner = await courier();
    await database.courierServiceablePincode.create({
      data: { courierPartnerId: partner.id, pincode: '411001', etaDays: 7, codAvailable: false },
    });
    const csv = [
      'pincode,cod_available,max_cod_value_rupees,eta_days',
      '411001,yes,5000,2',
      '560034,no,,4',
      '12345,yes,,2',
      '400050,maybe,,3',
      '560034,yes,,1',
      '302001,yes,abc,0',
    ].join('\n');
    const result = await importServiceablePincodes(staff, partner.id, csv, testMetadata());
    expect(result.savedCount).toBe(2);
    expect(result.errors.map(({ line }) => line)).toEqual([4, 5, 6, 7]);
    expect(result.errors[2]?.messages).toEqual(['This pincode appears earlier in the file.']);
    const rows = await database.courierServiceablePincode.findMany({
      where: { courierPartnerId: partner.id },
      orderBy: { pincode: 'asc' },
      select: { pincode: true, codAvailable: true, maxCodValuePaise: true, etaDays: true },
    });
    expect(rows).toEqual([
      { pincode: '411001', codAvailable: true, maxCodValuePaise: 500_000, etaDays: 2 },
      { pincode: '560034', codAvailable: false, maxCodValuePaise: null, etaDays: 4 },
    ]);
    expect(
      await database.auditLog.count({
        where: { action: 'courier.pincodes_changed', entityId: partner.id },
      }),
    ).toBe(1);
  });

  it('refuses a bad header or an unreadable file (422) and writes nothing', async () => {
    const staff = await createStaffMember(['couriers.write']);
    const partner = await courier();
    expect(
      await failure(
        importServiceablePincodes(staff, partner.id, 'pincode,eta\n411001,2', testMetadata()),
      ),
    ).toBe('422 CSV_HEADER_INVALID');
    expect(
      await failure(
        importServiceablePincodes(
          staff,
          partner.id,
          'pincode,cod_available,max_cod_value_rupees,eta_days\n"411001,yes,,2',
          testMetadata(),
        ),
      ),
    ).toBe('422 CSV_INVALID');
    expect(await database.courierServiceablePincode.count()).toBe(0);
  });

  it('needs couriers.write (403) and a real courier (404)', async () => {
    const reader = await createStaffMember(['orders.read']);
    const partner = await courier();
    const csv = 'pincode,cod_available,max_cod_value_rupees,eta_days\n411001,yes,,2';
    expect(await failure(importServiceablePincodes(reader, partner.id, csv, testMetadata()))).toBe(
      '403 PERMISSION_DENIED',
    );
    const writer = await createStaffMember(['couriers.write']);
    expect(
      await failure(
        importServiceablePincodes(
          writer,
          '0195f2a0-0000-7000-8000-000000000999',
          csv,
          testMetadata(),
        ),
      ),
    ).toBe('404 COURIER_NOT_FOUND');
  });
});

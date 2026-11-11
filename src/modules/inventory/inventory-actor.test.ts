import { randomUUID } from 'node:crypto';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { type CustomerId, customerIdSchema, type StaffUserId, staffUserIdSchema } from '@/lib/ids';

import {
  actorAuditDetails,
  actorColumns,
  actorRequestColumns,
  type InventoryActor,
} from './inventory-actor';

const metadata = { requestId: 'request-1', clientIp: '203.0.113.7' };
const staffUserId = staffUserIdSchema.parse(randomUUID());
const customerId = customerIdSchema.parse(randomUUID());

const staffActor: InventoryActor = {
  kind: 'STAFF',
  staff: { staffUserId, sessionId: randomUUID(), permissionCodes: new Set(['inventory.write']) },
  metadata,
};
const customerActor: InventoryActor = { kind: 'CUSTOMER', customerId, metadata };
const systemActor: InventoryActor = {
  kind: 'SYSTEM',
  process: 'reservation-expiry',
  metadata: { requestId: 'job-7' },
};

describe('actorColumns', () => {
  it('records a staff member as STAFF with their staff id', () => {
    expect(actorColumns(staffActor)).toEqual({ actorType: 'STAFF', actorId: staffUserId });
  });

  it('records a customer as CUSTOMER with their customer id, never a staff id', () => {
    const columns = actorColumns(customerActor);
    expect(columns).toEqual({ actorType: 'CUSTOMER', actorId: customerId });
    expect(columns.actorId).not.toBe(staffUserId);
  });

  it('records a system process as SYSTEM with no actor id', () => {
    expect(actorColumns(systemActor)).toEqual({ actorType: 'SYSTEM', actorId: null });
  });
});

describe('actorRequestColumns and actorAuditDetails', () => {
  it('takes the client IP and request id from the request for staff and customers', () => {
    expect(actorRequestColumns(staffActor)).toEqual({
      ipAddress: '203.0.113.7',
      requestId: 'request-1',
    });
    expect(actorRequestColumns(customerActor)).toEqual({
      ipAddress: '203.0.113.7',
      requestId: 'request-1',
    });
    expect(actorAuditDetails(staffActor)).toEqual({});
    expect(actorAuditDetails(customerActor)).toEqual({});
  });

  it('gives a system process no IP, its own request id, and names the process in the audit row', () => {
    expect(actorRequestColumns(systemActor)).toEqual({ ipAddress: null, requestId: 'job-7' });
    expect(actorAuditDetails(systemActor)).toEqual({ systemProcess: 'reservation-expiry' });
  });
});

describe('actor id types', () => {
  it('keeps staff and customer ids apart at compile time', () => {
    expectTypeOf<StaffUserId>().not.toExtend<CustomerId>();
    expectTypeOf<CustomerId>().not.toExtend<StaffUserId>();
    expectTypeOf<string>().not.toExtend<CustomerId>();
  });
});

import { getDatabase } from '@/lib/db';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import type { AuditAction, AuditData } from '@/modules/audit/audit.types';

import type { CustomerContext, RequestMetadata } from './access-control';
import { AddressNotFoundError } from './address.errors';
import {
  type AddressRow,
  type AddressWrite,
  archiveAddressRow,
  clearDefaultAddress,
  countActiveAddresses,
  findActiveAddress,
  findNewestActiveAddress,
  insertAddress,
  listActiveAddresses,
  lockCustomerForAddressChange,
  markAddressDefault,
  updateAddressRow,
} from './address.repository';
import type { CreateAddressInput, UpdateAddressInput } from './identity.schema';
import type { DatabaseClient } from '@/lib/db';

function toAddressWrite(input: Omit<CreateAddressInput, 'isDefault'>): AddressWrite {
  return {
    recipientName: input.recipientName,
    phone: input.phone,
    addressLine1: input.addressLine1,
    addressLine2: emptyToNull(input.addressLine2),
    landmark: emptyToNull(input.landmark),
    city: input.city,
    state: input.state,
    pincode: input.pincode,
  };
}

function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

// Clearing an optional line in the form sends "", which is stored as NULL like a never-filled line.
function definedChanges(input: UpdateAddressInput): Partial<AddressWrite> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) =>
        (field === 'addressLine2' || field === 'landmark') && value === ''
          ? [field, null]
          : [field, value],
      ),
  );
}

// Street lines and phone numbers stay out of the audit trail; field names, city and pincode are enough.
function auditAddress(
  database: DatabaseClient,
  customer: CustomerContext,
  metadata: RequestMetadata,
  event: { action: AuditAction; addressId: string; after: AuditData },
): Promise<void> {
  return recordAuditEvent(database, {
    actorType: 'CUSTOMER',
    actorId: customer.customerId,
    action: event.action,
    entityType: 'customer_address',
    entityId: event.addressId,
    after: event.after,
    ipAddress: metadata.clientIp,
    requestId: metadata.requestId,
  });
}

export function listAddresses(customer: CustomerContext): Promise<AddressRow[]> {
  return listActiveAddresses(getDatabase(), customer.customerId);
}

export function createAddress(
  customer: CustomerContext,
  input: CreateAddressInput,
  metadata: RequestMetadata,
): Promise<AddressRow> {
  return getDatabase().$transaction(async (transaction) => {
    await lockCustomerForAddressChange(transaction, customer.customerId);
    const isFirstAddress = (await countActiveAddresses(transaction, customer.customerId)) === 0;
    const isDefault = input.isDefault === true || isFirstAddress;
    if (isDefault) await clearDefaultAddress(transaction, customer.customerId);
    const address = await insertAddress(transaction, customer.customerId, {
      ...toAddressWrite(input),
      isDefault,
    });
    await auditAddress(transaction, customer, metadata, {
      action: 'customer.address_created',
      addressId: address.id,
      after: { city: address.city, pincode: address.pincode, isDefault },
    });
    return address;
  });
}

export function updateAddress(
  customer: CustomerContext,
  addressId: string,
  input: UpdateAddressInput,
  metadata: RequestMetadata,
): Promise<AddressRow> {
  return getDatabase().$transaction(async (transaction) => {
    const existing = await findActiveAddress(transaction, customer.customerId, addressId);
    if (existing === null) throw new AddressNotFoundError();
    const changes = definedChanges(input);
    const address = await updateAddressRow(transaction, addressId, changes);
    await auditAddress(transaction, customer, metadata, {
      action: 'customer.address_updated',
      addressId,
      after: {
        changedFields: Object.keys(changes).sort().join(','),
        city: address.city,
        pincode: address.pincode,
      },
    });
    return address;
  });
}

export function archiveAddress(
  customer: CustomerContext,
  addressId: string,
  metadata: RequestMetadata,
): Promise<void> {
  return getDatabase().$transaction(async (transaction) => {
    await lockCustomerForAddressChange(transaction, customer.customerId);
    const existing = await findActiveAddress(transaction, customer.customerId, addressId);
    if (existing === null) throw new AddressNotFoundError();
    await archiveAddressRow(transaction, addressId);
    const promoted = existing.isDefault
      ? await findNewestActiveAddress(transaction, customer.customerId)
      : null;
    if (promoted !== null) await markAddressDefault(transaction, promoted.id);
    await auditAddress(transaction, customer, metadata, {
      action: 'customer.address_archived',
      addressId,
      after: { wasDefault: existing.isDefault, promotedAddressId: promoted?.id ?? null },
    });
  });
}

export function setDefaultAddress(
  customer: CustomerContext,
  addressId: string,
  metadata: RequestMetadata,
): Promise<AddressRow> {
  return getDatabase().$transaction(async (transaction) => {
    await lockCustomerForAddressChange(transaction, customer.customerId);
    const existing = await findActiveAddress(transaction, customer.customerId, addressId);
    if (existing === null) throw new AddressNotFoundError();
    if (existing.isDefault) return existing;
    const previousDefault = (await listActiveAddresses(transaction, customer.customerId)).find(
      (address) => address.isDefault,
    );
    await clearDefaultAddress(transaction, customer.customerId);
    await markAddressDefault(transaction, addressId);
    await auditAddress(transaction, customer, metadata, {
      action: 'customer.default_address_changed',
      addressId,
      after: { previousDefaultAddressId: previousDefault?.id ?? null },
    });
    return { ...existing, isDefault: true };
  });
}

// Checkout (C27): the customer's own active address, read inside the checkout transaction.
export function findCustomerAddress(
  database: DatabaseClient,
  customerId: string,
  addressId: string,
): Promise<AddressRow | null> {
  return findActiveAddress(database, customerId, addressId);
}

import { getDatabase, isUniqueViolation } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import {
  assertStaffPermission,
  type RequestMetadata,
  type StaffContext,
} from '@/modules/identity/access-control';

import type {
  CreateCourierPartnerInput,
  ServiceablePincodeInput,
  UpdateCourierPartnerInput,
} from './courier-admin.schema';
import {
  listCourierPartnerRows,
  listServiceablePincodeRows,
  listWebhookReceiptRows,
} from './courier.repository';
import { demoCourierAdapterKey } from './demo-courier';

const courierNotFound = () =>
  new DomainError({
    kind: 'NOT_FOUND',
    code: 'COURIER_NOT_FOUND',
    message: 'This courier was not found.',
  });

function staffAudit(staff: StaffContext, metadata: RequestMetadata) {
  return {
    actorType: 'STAFF' as const,
    actorId: staff.staffUserId,
    ipAddress: metadata.clientIp,
    requestId: metadata.requestId,
  };
}

export function listCourierPartners(staff: StaffContext) {
  assertStaffPermission(staff, 'orders.read');
  return listCourierPartnerRows(getDatabase());
}

export function listServiceablePincodes(staff: StaffContext, courierPartnerId: string) {
  assertStaffPermission(staff, 'orders.read');
  return listServiceablePincodeRows(getDatabase(), courierPartnerId);
}

export function listWebhookReceipts(staff: StaffContext, before: Date | null) {
  assertStaffPermission(staff, 'orders.read');
  return listWebhookReceiptRows(getDatabase(), before, 50);
}

// D40: only the demo_courier adapter exists, so every new partner uses it (plan §8).
export async function createCourierPartner(
  staff: StaffContext,
  input: CreateCourierPartnerInput,
  metadata: RequestMetadata,
) {
  assertStaffPermission(staff, 'couriers.write');
  try {
    return await getDatabase().$transaction(async (transaction) => {
      const partner = await transaction.courierPartner.create({
        data: { ...input, adapterKey: demoCourierAdapterKey },
        select: { id: true, code: true },
      });
      await recordAuditEvent(transaction, {
        ...staffAudit(staff, metadata),
        action: 'courier.partner_created',
        entityType: 'courier_partner',
        entityId: partner.id,
        after: { ...input },
      });
      return partner;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError({
        kind: 'CONFLICT',
        code: 'COURIER_CODE_TAKEN',
        message: 'A courier with this code already exists.',
        details: { fieldErrors: { code: ['A courier with this code already exists.'] } },
      });
    }
    throw error;
  }
}

export async function updateCourierPartner(
  staff: StaffContext,
  courierPartnerId: string,
  input: UpdateCourierPartnerInput,
  metadata: RequestMetadata,
) {
  assertStaffPermission(staff, 'couriers.write');
  return getDatabase().$transaction(async (transaction) => {
    const before = await transaction.courierPartner.findUnique({
      where: { id: courierPartnerId },
      select: { name: true, priority: true, supportsCod: true, isActive: true },
    });
    if (before === null) throw courierNotFound();
    const after = await transaction.courierPartner.update({
      where: { id: courierPartnerId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.supportsCod === undefined ? {} : { supportsCod: input.supportsCod }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
      select: { name: true, priority: true, supportsCod: true, isActive: true },
    });
    await recordAuditEvent(transaction, {
      ...staffAudit(staff, metadata),
      action: 'courier.partner_updated',
      entityType: 'courier_partner',
      entityId: courierPartnerId,
      before,
      after,
    });
    return after;
  });
}

// D41 (list/edit): add or change one serviceable pincode, or remove it.
export async function upsertServiceablePincode(
  staff: StaffContext,
  courierPartnerId: string,
  input: ServiceablePincodeInput,
  metadata: RequestMetadata,
): Promise<void> {
  assertStaffPermission(staff, 'couriers.write');
  await getDatabase().$transaction(async (transaction) => {
    const partner = await transaction.courierPartner.findUnique({
      where: { id: courierPartnerId },
      select: { id: true },
    });
    if (partner === null) throw courierNotFound();
    const fields = {
      codAvailable: input.codAvailable,
      maxCodValuePaise: input.maxCodValuePaise,
      etaDays: input.etaDays,
    };
    await transaction.courierServiceablePincode.upsert({
      where: { courierPartnerId_pincode: { courierPartnerId, pincode: input.pincode } },
      create: { courierPartnerId, pincode: input.pincode, ...fields },
      update: fields,
      select: { pincode: true },
    });
    await recordAuditEvent(transaction, {
      ...staffAudit(staff, metadata),
      action: 'courier.pincodes_changed',
      entityType: 'courier_partner',
      entityId: courierPartnerId,
      after: { ...input, change: 'saved' },
    });
  });
}

export async function removeServiceablePincode(
  staff: StaffContext,
  courierPartnerId: string,
  pincode: string,
  metadata: RequestMetadata,
): Promise<void> {
  assertStaffPermission(staff, 'couriers.write');
  await getDatabase().$transaction(async (transaction) => {
    const { count } = await transaction.courierServiceablePincode.deleteMany({
      where: { courierPartnerId, pincode },
    });
    if (count === 0) {
      throw new DomainError({
        kind: 'NOT_FOUND',
        code: 'PINCODE_NOT_FOUND',
        message: 'This pincode is not listed.',
      });
    }
    await recordAuditEvent(transaction, {
      ...staffAudit(staff, metadata),
      action: 'courier.pincodes_changed',
      entityType: 'courier_partner',
      entityId: courierPartnerId,
      after: { pincode, change: 'removed' },
    });
  });
}

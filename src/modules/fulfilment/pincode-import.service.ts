import { csvRecordsOrThrow, type CsvRowError, zodMessages } from '@/lib/csv';
import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { rupeesTextToPaise } from '@/lib/money';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import {
  assertStaffPermission,
  type RequestMetadata,
  type StaffContext,
} from '@/modules/identity/access-control';

import { type ServiceablePincodeInput, serviceablePincodeSchema } from './courier-admin.schema';
import { upsertServiceablePincodeRows } from './courier.repository';

export const pincodeCsvColumns = [
  'pincode',
  'cod_available',
  'max_cod_value_rupees',
  'eta_days',
] as const;

const yesValues = new Set(['yes', 'y', 'true', '1']);
const noValues = new Set(['no', 'n', 'false', '0']);

function booleanCell(value: string): boolean | string {
  const lower = value.toLowerCase();
  if (yesValues.has(lower)) return true;
  if (noValues.has(lower)) return false;
  return value;
}

function toInput(values: Record<string, string>): unknown {
  const rupees = values['max_cod_value_rupees'] ?? '';
  const eta = values['eta_days'] ?? '';
  return {
    pincode: values['pincode'] ?? '',
    codAvailable: booleanCell(values['cod_available'] ?? ''),
    maxCodValuePaise: rupees === '' ? null : (rupeesTextToPaise(rupees) ?? rupees),
    etaDays: /^\d+$/.test(eta) ? Number(eta) : eta,
  };
}

export interface PincodeImportResult {
  savedCount: number;
  errors: CsvRowError[];
}

// D41 (CSV): every valid row is saved (insert or update) in one transaction; invalid or repeated rows
// are reported by line and never written, so a file with mistakes never half-writes a bad row.
export async function importServiceablePincodes(
  staff: StaffContext,
  courierPartnerId: string,
  csv: string,
  metadata: RequestMetadata,
): Promise<PincodeImportResult> {
  assertStaffPermission(staff, 'couriers.write');
  const database = getDatabase();
  const partner = await database.courierPartner.findUnique({
    where: { id: courierPartnerId },
    select: { id: true },
  });
  if (partner === null) {
    throw new DomainError({
      kind: 'NOT_FOUND',
      code: 'COURIER_NOT_FOUND',
      message: 'This courier partner was not found.',
    });
  }
  const records = csvRecordsOrThrow(csv, pincodeCsvColumns);
  const errors: CsvRowError[] = [];
  const valid = new Map<string, ServiceablePincodeInput>();
  for (const record of records) {
    const parsed = serviceablePincodeSchema.safeParse(toInput(record.values));
    if (!parsed.success) {
      errors.push({ line: record.line, messages: zodMessages(parsed.error) });
    } else if (valid.has(parsed.data.pincode)) {
      errors.push({ line: record.line, messages: ['This pincode appears earlier in the file.'] });
    } else {
      valid.set(parsed.data.pincode, parsed.data);
    }
  }
  if (valid.size === 0) return { savedCount: 0, errors };
  await database.$transaction(async (transaction) => {
    await upsertServiceablePincodeRows(transaction, courierPartnerId, [...valid.values()]);
    await recordAuditEvent(transaction, {
      actorType: 'STAFF',
      actorId: staff.staffUserId,
      action: 'courier.pincodes_changed',
      entityType: 'courier_partner',
      entityId: courierPartnerId,
      after: { change: 'csv_import', savedCount: valid.size, rejectedRowCount: errors.length },
      ipAddress: metadata.clientIp,
      requestId: metadata.requestId,
    });
  });
  return { savedCount: valid.size, errors };
}

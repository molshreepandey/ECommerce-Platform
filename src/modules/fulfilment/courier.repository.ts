import type { DatabaseClient } from '@/lib/db';

// Serviceability for one pincode (D41, C27): active partners only, best priority first.
export function findServiceableCourierRows(database: DatabaseClient, pincode: string) {
  return database.courierServiceablePincode.findMany({
    where: { pincode, courierPartner: { isActive: true } },
    select: {
      codAvailable: true,
      maxCodValuePaise: true,
      etaDays: true,
      courierPartner: { select: { id: true, name: true, priority: true, supportsCod: true } },
    },
    orderBy: [{ courierPartner: { priority: 'asc' } }, { courierPartnerId: 'asc' }],
  });
}

export function findCourierPartnerByCode(database: DatabaseClient, code: string) {
  return database.courierPartner.findUnique({
    where: { code },
    select: { id: true, adapterKey: true, isActive: true },
  });
}

export function findCourierPartnerAdapters(database: DatabaseClient, ids: readonly string[]) {
  return database.courierPartner.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, adapterKey: true, code: true },
  });
}

// Dedupe by (courier, provider event id) (plan §8): null means this event was already received.
export async function insertWebhookReceiptIfNew(
  database: DatabaseClient,
  receipt: {
    courierPartnerId: string;
    providerEventId: string;
    awbNumber: string;
    payload: unknown;
  },
): Promise<string | null> {
  const rows = await database.$queryRaw<{ id: string }[]>`
    INSERT INTO courier_webhook_receipts (courier_partner_id, provider_event_id, awb_number, payload)
    VALUES (${receipt.courierPartnerId}::uuid, ${receipt.providerEventId}, ${receipt.awbNumber},
            ${JSON.stringify(receipt.payload)}::jsonb)
    ON CONFLICT (courier_partner_id, provider_event_id) DO NOTHING
    RETURNING id`;
  return rows[0]?.id ?? null;
}

export async function markWebhookReceipt(
  database: DatabaseClient,
  receiptId: string,
  result: 'PROCESSED' | 'FAILED',
  errorMessage: string | null,
): Promise<void> {
  await database.courierWebhookReceipt.update({
    where: { id: receiptId },
    data: { processingResult: result, errorMessage, processedAt: new Date() },
    select: { id: true },
  });
}

export function listCourierPartnerRows(database: DatabaseClient) {
  return database.courierPartner.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      adapterKey: true,
      priority: true,
      supportsCod: true,
      isActive: true,
      _count: { select: { serviceablePincodes: true } },
    },
    orderBy: [{ priority: 'asc' }, { code: 'asc' }],
  });
}

export function listServiceablePincodeRows(database: DatabaseClient, courierPartnerId: string) {
  return database.courierServiceablePincode.findMany({
    where: { courierPartnerId },
    select: { pincode: true, codAvailable: true, maxCodValuePaise: true, etaDays: true },
    orderBy: [{ pincode: 'asc' }],
    take: 500,
  });
}

export function listWebhookReceiptRows(
  database: DatabaseClient,
  before: Date | null,
  limit: number,
) {
  return database.courierWebhookReceipt.findMany({
    where: before === null ? {} : { receivedAt: { lt: before } },
    select: {
      id: true,
      providerEventId: true,
      awbNumber: true,
      processingResult: true,
      errorMessage: true,
      receivedAt: true,
      processedAt: true,
      courierPartner: { select: { name: true } },
    },
    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
}

// D41 CSV import: one statement for all rows (insert or update by courier and pincode).
export async function upsertServiceablePincodeRows(
  database: DatabaseClient,
  courierPartnerId: string,
  rows: readonly {
    pincode: string;
    codAvailable: boolean;
    maxCodValuePaise: number | null;
    etaDays: number;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  await database.$executeRaw`
    INSERT INTO courier_serviceable_pincodes (courier_partner_id, pincode, cod_available, max_cod_value_paise, eta_days)
    SELECT ${courierPartnerId}::uuid, row.pincode, row.cod_available, row.max_cod_value_paise, row.eta_days
    FROM unnest(
      ${rows.map(({ pincode }) => pincode)}::text[],
      ${rows.map(({ codAvailable }) => codAvailable)}::boolean[],
      ${rows.map(({ maxCodValuePaise }) => maxCodValuePaise)}::int[],
      ${rows.map(({ etaDays }) => etaDays)}::int[]
    ) AS row(pincode, cod_available, max_cod_value_paise, eta_days)
    ON CONFLICT (courier_partner_id, pincode) DO UPDATE SET
      cod_available = EXCLUDED.cod_available,
      max_cod_value_paise = EXCLUDED.max_cod_value_paise,
      eta_days = EXCLUDED.eta_days,
      updated_at = now()`;
}

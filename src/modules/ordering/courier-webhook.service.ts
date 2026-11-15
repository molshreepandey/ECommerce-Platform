import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import {
  findCourierPartnerByCode,
  insertWebhookReceiptIfNew,
  markWebhookReceipt,
} from '@/modules/fulfilment/courier.repository';
import type { CourierTrackingEvent } from '@/modules/fulfilment/courier-provider';
import { courierProviderFor } from '@/modules/fulfilment/demo-courier';

import { findShipmentByAwb } from './order-lifecycle.repository';
import { applyShipmentChange } from './order-lifecycle.service';

export interface WebhookEventResult {
  providerEventId: string;
  result: 'PROCESSED' | 'DUPLICATE' | 'FAILED';
  message: string | null;
}

const signatureInvalid = () =>
  new DomainError({
    kind: 'UNAUTHENTICATED',
    code: 'WEBHOOK_SIGNATURE_INVALID',
    message: 'The webhook signature is missing, wrong or too old.',
  });

async function applyEvent(
  courierPartnerId: string,
  event: CourierTrackingEvent,
  requestId: string,
): Promise<WebhookEventResult> {
  const database = getDatabase();
  const receipt = {
    courierPartnerId,
    providerEventId: event.providerEventId,
    awbNumber: event.awbNumber,
    payload: { ...event, occurredAt: event.occurredAt.toISOString() },
  };
  try {
    // The receipt is stored in the same transaction as the change it records: if that transaction fails
    // for any other reason (timeout, deadlock), nothing is stored and the courier's retry is processed
    // instead of being answered DUPLICATE.
    const result = await database.$transaction(
      async (transaction): Promise<'PROCESSED' | 'DUPLICATE'> => {
        const receiptId = await insertWebhookReceiptIfNew(transaction, receipt);
        if (receiptId === null) return 'DUPLICATE';
        const shipment = await findShipmentByAwb(transaction, event.awbNumber);
        if (shipment === null || shipment.courierPartnerId !== courierPartnerId) {
          throw new DomainError({
            kind: 'NOT_FOUND',
            code: 'SHIPMENT_NOT_FOUND',
            message: `No shipment with AWB ${event.awbNumber}`,
          });
        }
        await applyShipmentChange(transaction, {
          shipmentId: shipment.id,
          change: {
            to: event.status,
            description: event.description,
            location: event.location,
            providerEventId: event.providerEventId,
            occurredAt: event.occurredAt,
          },
          actor: { kind: 'COURIER', courierPartnerId, metadata: { requestId } },
        });
        await markWebhookReceipt(transaction, receiptId, 'PROCESSED', null);
        return 'PROCESSED';
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    return { providerEventId: event.providerEventId, result, message: null };
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    // A refused event is recorded once as FAILED (the rollback removed its receipt) and not retried.
    const receiptId = await insertWebhookReceiptIfNew(database, receipt);
    if (receiptId === null) {
      return { providerEventId: event.providerEventId, result: 'DUPLICATE', message: null };
    }
    await markWebhookReceipt(database, receiptId, 'FAILED', `${error.code}: ${error.message}`);
    return { providerEventId: event.providerEventId, result: 'FAILED', message: error.message };
  }
}

// D42 / plan §8: verify the HMAC signature, store each event once per (courier, event id), and apply it
// through the shipment state machine. A refused transition is recorded as FAILED, not retried.
export async function processCourierWebhook(input: {
  providerCode: string;
  rawBody: string;
  signatureHeader: string | null;
  requestId: string;
}): Promise<{ events: WebhookEventResult[] }> {
  const partner = await findCourierPartnerByCode(getDatabase(), input.providerCode);
  if (partner === null) {
    throw new DomainError({
      kind: 'NOT_FOUND',
      code: 'COURIER_NOT_FOUND',
      message: 'Unknown courier.',
    });
  }
  const provider = courierProviderFor(partner.adapterKey);
  if (
    !provider.verifyWebhook({
      // The partner was found by this code, so the key is that partner's own (L2).
      partnerCode: input.providerCode,
      rawBody: input.rawBody,
      signatureHeader: input.signatureHeader,
      now: new Date(),
    })
  ) {
    throw signatureInvalid();
  }
  let events: CourierTrackingEvent[];
  try {
    events = provider.parseWebhook(input.rawBody);
  } catch {
    throw new DomainError({
      kind: 'VALIDATION',
      code: 'WEBHOOK_PAYLOAD_INVALID',
      message: 'The webhook body is not valid.',
    });
  }
  const results: WebhookEventResult[] = [];
  for (const event of events) results.push(await applyEvent(partner.id, event, input.requestId));
  return { events: results };
}

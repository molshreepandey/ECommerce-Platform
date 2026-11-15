import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { ShipmentStatus } from '@/generated/prisma/enums';

import { courierSigningKey } from './courier-secret';
import type { CourierProvider, CourierTrackingEvent } from './courier-provider';
import { signWebhook, verifyWebhookSignature } from './webhook-signature';

export const demoCourierAdapterKey = 'demo_courier';

const trackingStatusSchema = z.enum([
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RTO_INITIATED',
]);

const webhookBodySchema = z.object({
  events: z
    .array(
      z.object({
        eventId: z.string().min(1).max(100),
        awbNumber: z.string().min(1).max(40),
        status: trackingStatusSchema,
        description: z.string().max(200),
        location: z.string().max(100).nullable(),
        occurredAt: z.iso.datetime({ offset: true }),
      }),
    )
    .min(1)
    .max(50),
});

const scanDescriptions: Readonly<Record<z.infer<typeof trackingStatusSchema>, string>> = {
  SHIPPED: 'Picked up from the warehouse',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered to the customer',
  DELIVERY_FAILED: 'Delivery attempt failed: customer not available',
  RTO_INITIATED: 'Returning to origin',
};

// AWB numbers are derived from the shipment id, so a retried creation returns the same AWB.
function awbFor(shipmentId: string): string {
  const digits = BigInt(`0x${createHash('sha256').update(shipmentId).digest('hex').slice(0, 15)}`)
    .toString()
    .padStart(12, '0')
    .slice(-12);
  return `DMO${digits}`;
}

// The built-in simulated partner (plan §8): no network, deterministic, HMAC-signed tracking webhooks.
export const demoCourier: CourierProvider = {
  createShipment({ shipmentId }) {
    return Promise.resolve({
      providerShipmentId: `demo-${shipmentId}`,
      awbNumber: awbFor(shipmentId),
    });
  },
  cancelShipment() {
    return Promise.resolve();
  },
  verifyWebhook({ partnerCode, rawBody, signatureHeader, now }) {
    return verifyWebhookSignature({
      secret: courierSigningKey(partnerCode),
      rawBody,
      signatureHeader,
      now,
    });
  },
  parseWebhook(rawBody): CourierTrackingEvent[] {
    const parsed = webhookBodySchema.parse(JSON.parse(rawBody));
    return parsed.events.map((event) => ({
      providerEventId: event.eventId,
      awbNumber: event.awbNumber,
      status: event.status,
      description: event.description,
      location: event.location,
      occurredAt: new Date(event.occurredAt),
    }));
  },
};

// "Simulate next scan" (admin demo button): the next courier event for a shipment's current status.
export function nextDemoScan(
  current: ShipmentStatus,
  outcome: 'DELIVERED' | 'DELIVERY_FAILED',
): z.infer<typeof trackingStatusSchema> | null {
  if (current === 'READY_TO_SHIP') return 'SHIPPED';
  if (current === 'SHIPPED') return 'OUT_FOR_DELIVERY';
  if (current === 'OUT_FOR_DELIVERY') return outcome;
  return null;
}

export function buildDemoWebhook(input: {
  partnerCode: string;
  awbNumber: string;
  status: z.infer<typeof trackingStatusSchema>;
  location: string | null;
  now: Date;
}): { rawBody: string; signatureHeader: string } {
  const rawBody = JSON.stringify({
    events: [
      {
        eventId: `demo-${randomUUID()}`,
        awbNumber: input.awbNumber,
        status: input.status,
        description: scanDescriptions[input.status],
        location: input.location,
        occurredAt: input.now.toISOString(),
      },
    ],
  });
  return {
    rawBody,
    signatureHeader: signWebhook(courierSigningKey(input.partnerCode), rawBody, input.now),
  };
}

export function courierProviderFor(adapterKey: string): CourierProvider {
  if (adapterKey === demoCourierAdapterKey) return demoCourier;
  throw new Error(`No courier adapter for ${adapterKey}`);
}

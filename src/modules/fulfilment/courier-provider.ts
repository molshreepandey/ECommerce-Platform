import type { ShipmentStatus } from '@/generated/prisma/enums';

export interface CreatedCourierShipment {
  providerShipmentId: string;
  awbNumber: string;
}

export interface CourierTrackingEvent {
  providerEventId: string;
  awbNumber: string;
  status: ShipmentStatus;
  description: string;
  location: string | null;
  occurredAt: Date;
}

// Plan §8: one adapter per partner; courier calls never run inside a database transaction.
export interface CourierProvider {
  createShipment(input: {
    shipmentId: string;
    orderNumber: string;
    pincode: string;
  }): Promise<CreatedCourierShipment>;
  cancelShipment(input: { awbNumber: string }): Promise<void>;
  verifyWebhook(input: {
    partnerCode: string;
    rawBody: string;
    signatureHeader: string | null;
    now: Date;
  }): boolean;
  parseWebhook(rawBody: string): CourierTrackingEvent[];
}

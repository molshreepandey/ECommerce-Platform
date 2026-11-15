import { z } from 'zod';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { buildTextPdf, pdfRupees } from '@/lib/simple-pdf';
import { assertStaffPermission, type StaffContext } from '@/modules/identity/access-control';

import { codToCollectByShipment } from './cod-collection.service';
import { findShipmentLabelRow } from './order-lifecycle.repository';

export const addressSchema = z.object({
  recipientName: z.string(),
  phone: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  landmark: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
});

// D35: the courier label as a PDF, available once the AWB exists. The amount to collect is shown only
// for Cash on Delivery orders that are not paid yet, and only this package's share of a split order.
export async function buildShippingLabel(staff: StaffContext, shipmentId: string): Promise<Buffer> {
  assertStaffPermission(staff, 'orders.read');
  const database = getDatabase();
  const shipment = await findShipmentLabelRow(database, shipmentId);
  if (shipment === null || shipment.awbNumber === null) {
    throw new DomainError({
      kind: 'NOT_FOUND',
      code: 'LABEL_NOT_FOUND',
      message: 'This shipment has no label yet. Create the AWB first.',
    });
  }
  const address = addressSchema.parse(shipment.order.shippingAddress);
  const collectPaise =
    (await codToCollectByShipment(database, [shipment.order])).get(shipmentId) ?? 0;
  const collect =
    collectPaise > 0
      ? `COLLECT ON DELIVERY: ${pdfRupees(collectPaise)}`
      : 'PREPAID: do not collect';
  return buildTextPdf([
    { text: shipment.courierPartner?.name ?? 'Courier', size: 12 },
    { text: `AWB ${shipment.awbNumber}`, size: 18 },
    { text: `Order ${shipment.order.orderNumber}`, size: 11 },
    { text: collect, size: 11 },
    { text: 'Ship to:', size: 10 },
    { text: address.recipientName, size: 12 },
    { text: address.addressLine1, size: 10 },
    ...(address.addressLine2 === null ? [] : [{ text: address.addressLine2, size: 10 }]),
    ...(address.landmark === null ? [] : [{ text: `Near ${address.landmark}`, size: 10 }]),
    { text: `${address.city}, ${address.state} ${address.pincode}`, size: 10 },
    { text: `Phone ${address.phone}`, size: 10 },
    {
      text: `From: ${shipment.warehouse.name}, ${shipment.warehouse.city} ${shipment.warehouse.pincode}`,
      size: 9,
    },
    {
      text: `Items: ${String(shipment.items.reduce((total, item) => total + item.quantity, 0))}`,
      size: 9,
    },
  ]);
}

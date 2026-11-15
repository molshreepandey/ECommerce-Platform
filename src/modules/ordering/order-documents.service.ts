import { getDatabase } from '@/lib/db';
import { formatDate } from '@/lib/date-format';
import { DomainError } from '@/lib/errors';
import { buildTextPdf, pdfRupees, type PdfLine } from '@/lib/simple-pdf';
import {
  assertStaffPermission,
  type CustomerContext,
  type StaffContext,
} from '@/modules/identity/access-control';
import { loadStoreBranding } from '@/modules/merchandising/store-branding.service';

import { codToCollectByShipment } from './cod-collection.service';
import { findManifestWarehouse, listWarehouseOptions } from './order-documents.repository';
import { findPackingSlipRow, listManifestRows } from './order-lifecycle.repository';
import type { OrderDetailRow } from './order-query.repository';
import { getCustomerOrder, getStaffOrder } from './order-query.service';
import { addressSchema } from './shipping-label.service';

function optionText(optionValues: unknown): string {
  if (typeof optionValues !== 'object' || optionValues === null) return '';
  return Object.values(optionValues)
    .filter((value): value is string => typeof value === 'string')
    .join(' / ');
}

function addressLines(address: unknown): PdfLine[] {
  const parsed = addressSchema.safeParse(address);
  if (!parsed.success) return [{ text: 'Address not available', size: 10 }];
  const value = parsed.data;
  return [
    { text: value.recipientName, size: 10 },
    {
      text: [value.addressLine1, value.addressLine2].filter((part) => part !== null).join(', '),
      size: 10,
    },
    { text: `${value.city}, ${value.state} ${value.pincode} · Phone ${value.phone}`, size: 10 },
  ];
}

// C36 / D39: a GST-inclusive tax invoice from the order's snapshots (prices, tax, address).
async function invoicePdf(order: OrderDetailRow): Promise<Buffer> {
  if (order.status === 'CANCELLED') {
    throw new DomainError({
      kind: 'CONFLICT',
      code: 'INVOICE_NOT_AVAILABLE',
      message: 'A cancelled order has no invoice.',
    });
  }
  const branding = await loadStoreBranding();
  const lines: PdfLine[] = [
    { text: branding.storeName, size: 16 },
    { text: 'TAX INVOICE (prices include GST)', size: 11 },
    { text: `Invoice for order ${order.orderNumber} · ${formatDate(order.placedAt)}`, size: 10 },
    { text: 'Bill and ship to:', size: 10 },
    ...addressLines(order.shippingAddress),
    { text: ' ', size: 6 },
    ...order.items.flatMap((item) => [
      {
        text: `${item.productName} (${[optionText(item.optionValues), item.sku].filter((part) => part !== '').join(' · ')})`,
        size: 10,
      },
      {
        text: `   ${String(item.quantity)} x ${pdfRupees(item.unitPricePaise)} = ${pdfRupees(item.lineTotalPaise)}   (GST incl. ${pdfRupees(item.taxPaise)})`,
        size: 9,
      },
    ]),
    { text: ' ', size: 6 },
    { text: `Subtotal: ${pdfRupees(order.subtotalPaise)}`, size: 10 },
    ...(order.discountPaise > 0
      ? [
          {
            text: `Discount${order.couponCode === null ? '' : ` (${order.couponCode})`}: -${pdfRupees(order.discountPaise)}`,
            size: 10,
          },
        ]
      : []),
    {
      text: `Shipping: ${order.shippingFeePaise === 0 ? 'Free' : pdfRupees(order.shippingFeePaise)}`,
      size: 10,
    },
    ...(order.codFeePaise > 0
      ? [{ text: `Cash on Delivery fee: ${pdfRupees(order.codFeePaise)}`, size: 10 }]
      : []),
    { text: `TOTAL: ${pdfRupees(order.totalPaise)}`, size: 12 },
    { text: `GST included: ${pdfRupees(order.taxPaise)}`, size: 10 },
    {
      text: `Payment: ${order.paymentMethod === 'COD' ? 'Cash on Delivery' : 'Online (simulated)'} · ${order.payment?.status.toLowerCase() ?? 'pending'}`,
      size: 10,
    },
  ];
  return buildTextPdf(lines, 'a4');
}

export async function buildCustomerInvoice(
  customer: CustomerContext,
  orderId: string,
): Promise<Buffer> {
  return invoicePdf(await getCustomerOrder(customer, orderId));
}

export async function buildStaffInvoice(staff: StaffContext, orderId: string): Promise<Buffer> {
  return invoicePdf((await getStaffOrder(staff, orderId)).order);
}

// D39: what to put in the box — items and quantities, no prices.
export async function buildPackingSlip(staff: StaffContext, shipmentId: string): Promise<Buffer> {
  assertStaffPermission(staff, 'orders.read');
  const shipment = await findPackingSlipRow(getDatabase(), shipmentId);
  if (shipment === null) {
    throw new DomainError({
      kind: 'NOT_FOUND',
      code: 'SHIPMENT_NOT_FOUND',
      message: 'This shipment was not found.',
    });
  }
  return buildTextPdf(
    [
      { text: 'PACKING SLIP', size: 14 },
      {
        text: `Order ${shipment.order.orderNumber} · ${formatDate(shipment.order.placedAt)}`,
        size: 10,
      },
      {
        text: `From ${shipment.warehouse.name} (${shipment.warehouse.code})${shipment.awbNumber === null ? '' : ` · AWB ${shipment.awbNumber}`}`,
        size: 10,
      },
      { text: 'Ship to:', size: 10 },
      ...addressLines(shipment.order.shippingAddress),
      { text: ' ', size: 6 },
      ...shipment.items.map((item) => ({
        text: `[ ] ${String(item.quantity)} x ${item.orderItem.productName} · ${item.orderItem.sku} ${optionText(item.orderItem.optionValues)}`,
        size: 10,
      })),
    ],
    'a4',
  );
}

function istDayRange(isoDate: string): { from: Date; to: Date } {
  const from = new Date(`${isoDate}T00:00:00+05:30`);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

export async function getManifest(staff: StaffContext, warehouseId: string, isoDate: string) {
  assertStaffPermission(staff, 'orders.read');
  const database = getDatabase();
  const warehouse = await findManifestWarehouse(database, warehouseId);
  if (warehouse === null) {
    throw new DomainError({
      kind: 'NOT_FOUND',
      code: 'WAREHOUSE_NOT_FOUND',
      message: 'This warehouse was not found.',
    });
  }
  const { from, to } = istDayRange(isoDate);
  const shipments = await listManifestRows(database, warehouseId, from, to);
  const collectByShipment = await codToCollectByShipment(database, [
    ...new Map(shipments.map(({ order }) => [order.id, order])).values(),
  ]);
  return {
    warehouse,
    date: isoDate,
    shipments: shipments.map((shipment) => {
      const address = addressSchema.safeParse(shipment.order.shippingAddress);
      return {
        shipmentId: shipment.id,
        orderNumber: shipment.order.orderNumber,
        awbNumber: shipment.awbNumber,
        courierName: shipment.courierPartner?.name ?? '—',
        status: shipment.status,
        itemCount: shipment.items.reduce((total, item) => total + item.quantity, 0),
        destination: address.success ? `${address.data.city} ${address.data.pincode}` : '—',
        collectOnDeliveryPaise: collectByShipment.get(shipment.id) ?? 0,
      };
    }),
  };
}

// D35: the courier hand-over list for one warehouse and day.
export async function buildManifestPdf(
  staff: StaffContext,
  warehouseId: string,
  isoDate: string,
): Promise<Buffer> {
  const manifest = await getManifest(staff, warehouseId, isoDate);
  const totalCollect = manifest.shipments.reduce(
    (total, row) => total + row.collectOnDeliveryPaise,
    0,
  );
  return buildTextPdf(
    [
      {
        text: `MANIFEST · ${manifest.warehouse.name} (${manifest.warehouse.code}) · ${manifest.date}`,
        size: 13,
      },
      {
        text: `${String(manifest.shipments.length)} shipments · COD to collect ${pdfRupees(totalCollect)}`,
        size: 10,
      },
      { text: ' ', size: 6 },
      ...manifest.shipments.map((row, index) => ({
        text: `${String(index + 1)}. AWB ${row.awbNumber ?? '-'} · ${row.orderNumber} · ${row.courierName} · ${String(row.itemCount)} items · ${row.destination}${row.collectOnDeliveryPaise > 0 ? ` · COD ${pdfRupees(row.collectOnDeliveryPaise)}` : ''}`,
        size: 9,
      })),
      { text: ' ', size: 6 },
      {
        text: 'Courier signature: ____________________   Warehouse signature: ____________________',
        size: 9,
      },
    ],
    'a4',
  );
}

export function listManifestWarehouses(staff: StaffContext) {
  assertStaffPermission(staff, 'orders.read');
  return listWarehouseOptions(getDatabase());
}

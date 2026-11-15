import { z } from 'zod';

import { type DatabaseClient, getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import type { CustomerContext, RequestMetadata } from '@/modules/identity/access-control';
import { lockOrder } from '@/modules/ordering/order-lifecycle.repository';
import { findCustomerOrderNumber } from '@/modules/ordering/order-query.repository';
import { orderingErrors } from '@/modules/ordering/ordering.errors';
import { loadStoreSettings } from '@/modules/pricing/store-settings.service';

import { returnableQuantity, returnWindowEndsAt } from './return-rules';
import type { CreateReturnInput } from './returns.schema';
import {
  countReturnsOfOrder,
  findExchangeOptions,
  findReturnableLines,
  insertReturnRequest,
  listReturnsOfOrder,
} from './returns.repository';

const optionValuesSchema = z.record(z.string(), z.string());

export interface ReturnableLine {
  orderItemId: string;
  productName: string;
  sku: string;
  returnableQuantity: number;
  windowEndsAt: string | null;
  exchangeOptions: { variantId: string; label: string }[];
}

const refuse = (code: string, message: string) =>
  new DomainError({ kind: 'UNPROCESSABLE', code, message });

async function returnableLines(
  database: DatabaseClient,
  orderId: string,
  now: Date,
): Promise<(ReturnableLine & { productId: string })[]> {
  const [lines, settings] = await Promise.all([
    findReturnableLines(database, orderId),
    loadStoreSettings(database),
  ]);
  const options = await findExchangeOptions(
    database,
    lines.map(({ productId }) => productId),
  );
  return lines.map((line) => {
    const delivered = line.shipmentItems.reduce((total, item) => total + item.quantity, 0);
    const deliveredAt = line.shipmentItems
      .map(({ shipment }) => shipment.deliveredAt)
      .filter((date): date is Date => date !== null)
      .sort((left, right) => right.getTime() - left.getTime())[0];
    const windowEndsAt =
      deliveredAt === undefined ? null : returnWindowEndsAt(deliveredAt, settings.returnWindowDays);
    const isOpen = windowEndsAt !== null && now < windowEndsAt;
    return {
      orderItemId: line.id,
      productId: line.productId,
      productName: line.productName,
      sku: line.sku,
      returnableQuantity: isOpen
        ? returnableQuantity({
            deliveredQuantity: delivered,
            deliveredInOpenWindowQuantity: line.shipmentItems
              .filter(
                ({ shipment }) =>
                  shipment.deliveredAt !== null &&
                  now < returnWindowEndsAt(shipment.deliveredAt, settings.returnWindowDays),
              )
              .reduce((total, item) => total + item.quantity, 0),
            alreadyRequestedQuantity: line.returnRequestItems.reduce(
              (total, item) => total + item.quantity,
              0,
            ),
          })
        : 0,
      windowEndsAt: windowEndsAt?.toISOString() ?? null,
      // An exchange order is issued at no charge, so the replacement is the same variant or one that costs
      // no more than the customer paid per unit (no free upgrade to a pricier variant).
      exchangeOptions: options
        .filter(
          (option) =>
            option.productId === line.productId &&
            (option.id === line.variantId || option.pricePaise <= line.unitPricePaise),
        )
        .map((option) => {
          const values = optionValuesSchema.safeParse(option.optionValues);
          const label = values.success ? Object.values(values.data).join(' / ') : '';
          return {
            variantId: option.id,
            label: label === '' ? option.sku : `${label} (${option.sku})`,
          };
        }),
    };
  });
}

// The order page: what can still be returned or exchanged, and the requests already made.
export async function getReturnOverview(customer: CustomerContext, orderId: string) {
  const database = getDatabase();
  const order = await findCustomerOrderNumber(database, orderId);
  if (order === null || order.customerId !== customer.customerId)
    throw orderingErrors.orderNotFound();
  const [lines, requests] = await Promise.all([
    returnableLines(database, orderId, new Date()),
    listReturnsOfOrder(database, orderId),
  ]);
  return { lines, requests };
}

// C37: within the window, delivered units only, never more than delivered minus earlier requests (the
// order row lock serialises two requests for the same order). Exchanges name a replacement variant of the
// same product.
export async function requestReturn(
  customer: CustomerContext,
  orderId: string,
  input: CreateReturnInput,
  metadata: RequestMetadata,
) {
  return getDatabase().$transaction(async (transaction) => {
    const order = await lockOrder(transaction, orderId);
    if (order === null || order.customerId !== customer.customerId)
      throw orderingErrors.orderNotFound();
    const lines = new Map(
      (await returnableLines(transaction, orderId, new Date())).map((line) => [
        line.orderItemId,
        line,
      ]),
    );
    for (const item of input.items) {
      const line = lines.get(item.orderItemId);
      if (line === undefined)
        throw refuse('ORDER_ITEM_NOT_FOUND', 'This item is not part of the order.');
      if (line.windowEndsAt === null) {
        throw refuse(
          'RETURN_NOT_DELIVERED',
          `${line.productName} has not been delivered, so it cannot be returned.`,
        );
      }
      if (new Date(line.windowEndsAt) <= new Date()) {
        throw refuse(
          'RETURN_WINDOW_CLOSED',
          `The return window for ${line.productName} has closed.`,
        );
      }
      if (item.quantity > line.returnableQuantity) {
        throw refuse(
          'RETURN_QUANTITY_EXCEEDED',
          `At most ${String(line.returnableQuantity)} of ${line.productName} can be returned.`,
        );
      }
      if (
        input.requestType === 'EXCHANGE' &&
        !line.exchangeOptions.some(({ variantId }) => variantId === item.exchangeVariantId)
      ) {
        throw refuse(
          'EXCHANGE_VARIANT_INVALID',
          `Choose an available replacement for ${line.productName}.`,
        );
      }
    }
    const sequence = (await countReturnsOfOrder(transaction, orderId)) + 1;
    const returnRequest = await insertReturnRequest(transaction, {
      returnNumber: `RET-${order.orderNumber.replace(/^ORD-/, '')}-${String(sequence)}`,
      orderId,
      customerId: customer.customerId,
      requestType: input.requestType,
      reason: input.reason,
      items: {
        create: input.items.map((item) => ({
          orderItemId: item.orderItemId,
          quantity: item.quantity,
          exchangeVariantId:
            input.requestType === 'EXCHANGE' ? (item.exchangeVariantId ?? null) : null,
        })),
      },
    });
    await recordAuditEvent(transaction, {
      actorType: 'CUSTOMER',
      actorId: customer.customerId,
      action: 'return.requested',
      entityType: 'return_request',
      entityId: returnRequest.id,
      after: {
        returnNumber: returnRequest.returnNumber,
        orderId,
        requestType: input.requestType,
        itemCount: input.items.reduce((total, item) => total + item.quantity, 0),
      },
      ipAddress: metadata.clientIp,
      requestId: metadata.requestId,
    });
    return returnRequest;
  });
}

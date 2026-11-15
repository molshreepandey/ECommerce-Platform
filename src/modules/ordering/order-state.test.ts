import { describe, expect, it } from 'vitest';
import {
  canMoveOrder,
  canMoveShipment,
  orderCanBeCancelled,
  orderStatusFromShipments,
} from './order-state';

describe('shipment transitions', () => {
  it('follows the plan §9.3 path and refuses skips', () => {
    expect(canMoveShipment('PENDING', 'PACKED')).toBe(true);
    expect(canMoveShipment('PACKED', 'AWB_PENDING')).toBe(true);
    expect(canMoveShipment('READY_TO_SHIP', 'SHIPPED')).toBe(true);
    expect(canMoveShipment('OUT_FOR_DELIVERY', 'DELIVERY_FAILED')).toBe(true);
    expect(canMoveShipment('DELIVERY_FAILED', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(canMoveShipment('DELIVERY_FAILED', 'RTO_INITIATED')).toBe(true);
    expect(canMoveShipment('PENDING', 'SHIPPED')).toBe(false);
    expect(canMoveShipment('SHIPPED', 'CANCELLED')).toBe(false);
    expect(canMoveShipment('DELIVERED', 'RTO_INITIATED')).toBe(false);
  });
});

describe('order transitions', () => {
  it('allows confirm and cancel before shipping only', () => {
    expect(canMoveOrder('PLACED', 'CONFIRMED')).toBe(true);
    expect(canMoveOrder('PLACED', 'CANCELLED')).toBe(true);
    expect(canMoveOrder('SHIPPED', 'CANCELLED')).toBe(false);
    expect(canMoveOrder('DELIVERED', 'PLACED')).toBe(false);
  });

  it('cancels only while nothing has shipped', () => {
    expect(orderCanBeCancelled('CONFIRMED', ['PACKED', 'PENDING'])).toBe(true);
    expect(orderCanBeCancelled('PROCESSING', ['READY_TO_SHIP', 'SHIPPED'])).toBe(false);
    expect(orderCanBeCancelled('SHIPPED', ['SHIPPED'])).toBe(false);
    expect(orderCanBeCancelled('CANCELLED', ['CANCELLED'])).toBe(false);
  });
});

describe('orderStatusFromShipments (split-shipment roll-up)', () => {
  it.each([
    ['CONFIRMED', ['PACKED', 'PENDING'], 'PROCESSING'],
    ['PLACED', ['PENDING'], 'PLACED'],
    ['PROCESSING', ['SHIPPED', 'PACKED'], 'PARTIALLY_SHIPPED'],
    ['PARTIALLY_SHIPPED', ['SHIPPED', 'OUT_FOR_DELIVERY'], 'SHIPPED'],
    ['SHIPPED', ['DELIVERED', 'OUT_FOR_DELIVERY'], 'PARTIALLY_DELIVERED'],
    ['PARTIALLY_DELIVERED', ['DELIVERED', 'DELIVERED'], 'DELIVERED'],
    ['SHIPPED', ['RTO_INITIATED', 'RTO_RECEIVED'], 'RTO'],
    ['SHIPPED', ['DELIVERED', 'CANCELLED'], 'DELIVERED'],
  ] as const)('%s with %j → %s', (current, shipments, expected) => {
    expect(orderStatusFromShipments(current, shipments)).toBe(expected);
  });
});

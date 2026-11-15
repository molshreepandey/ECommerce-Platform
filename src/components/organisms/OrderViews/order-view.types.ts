import type { OrderDetailRow } from '@/modules/ordering/order-query.repository';

export type OrderDetail = OrderDetailRow;
export type OrderShipment = OrderDetailRow['shipments'][number];
export type OrderItem = OrderDetailRow['items'][number];

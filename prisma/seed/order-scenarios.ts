import type { OrderStatus, ShipmentStatus } from '../../src/generated/prisma/enums';
import type { DemoCustomerKey } from './identity.seed';
import type { WarehouseCode } from './warehouses.seed';

export interface OrderLineScenario {
  sku: string;
  quantity: number;
}

export interface ShipmentScenario {
  warehouseCode: WarehouseCode;
  statusPath: readonly ShipmentStatus[];
  lines: readonly OrderLineScenario[];
}

export interface OrderScenario {
  orderNumber: string;
  customerKey: DemoCustomerKey;
  addressKey: 'default' | 'secondary';
  placedDaysAgo: number;
  statusPath: readonly OrderStatus[];
  couponCode: string | null;
  shipments: readonly ShipmentScenario[];
  reviewRating: number | null;
}

const toReadyToShip: readonly ShipmentStatus[] = [
  'PENDING',
  'PACKED',
  'AWB_PENDING',
  'READY_TO_SHIP',
];
const toShipped: readonly ShipmentStatus[] = [...toReadyToShip, 'SHIPPED'];
const toOutForDelivery: readonly ShipmentStatus[] = [...toShipped, 'OUT_FOR_DELIVERY'];
const toDelivered: readonly ShipmentStatus[] = [...toOutForDelivery, 'DELIVERED'];
const toDeliveryFailed: readonly ShipmentStatus[] = [...toOutForDelivery, 'DELIVERY_FAILED'];
const toRtoInitiated: readonly ShipmentStatus[] = [...toDeliveryFailed, 'RTO_INITIATED'];
const toRtoReceived: readonly ShipmentStatus[] = [...toRtoInitiated, 'RTO_RECEIVED'];

const orderToProcessing: readonly OrderStatus[] = ['PLACED', 'CONFIRMED', 'PROCESSING'];
const orderToShipped: readonly OrderStatus[] = [...orderToProcessing, 'SHIPPED'];
const orderToDelivered: readonly OrderStatus[] = [...orderToShipped, 'DELIVERED'];

export const shipmentStatusOffsetHours: Record<ShipmentStatus, number> = {
  PENDING: 0,
  CANCELLED: 2,
  PACKED: 4,
  AWB_PENDING: 5,
  READY_TO_SHIP: 5.5,
  SHIPPED: 24,
  OUT_FOR_DELIVERY: 48,
  DELIVERED: 72,
  DELIVERY_FAILED: 72,
  RTO_INITIATED: 96,
  RTO_RECEIVED: 144,
};

export const orderStatusOffsetHours: Record<OrderStatus, number> = {
  PLACED: 0,
  CONFIRMED: 1,
  CANCELLED: 2,
  PROCESSING: 4,
  PARTIALLY_SHIPPED: 24,
  SHIPPED: 24,
  PARTIALLY_DELIVERED: 72,
  DELIVERED: 72,
  RTO: 144,
};

export const firstSeededOrderNumber = 100001;

export const orderScenarios: readonly OrderScenario[] = [
  {
    orderNumber: 'ORD-100001',
    customerKey: 'rahul',
    addressKey: 'default',
    placedDaysAgo: 30,
    statusPath: orderToDelivered,
    couponCode: null,
    reviewRating: 4,
    shipments: [
      {
        warehouseCode: 'WH-DEL',
        statusPath: toDelivered,
        lines: [
          { sku: 'BEA036-30ML', quantity: 1 },
          { sku: 'ELE030-RED', quantity: 1 },
        ],
      },
    ],
  },
  {
    orderNumber: 'ORD-100002',
    customerKey: 'asha',
    addressKey: 'default',
    placedDaysAgo: 28,
    statusPath: orderToDelivered,
    couponCode: 'SAVE10',
    reviewRating: 5,
    shipments: [
      {
        warehouseCode: 'WH-BLR',
        statusPath: toDelivered,
        lines: [
          { sku: 'ELE023-BLACK', quantity: 1 },
          { sku: 'APP007-L-BLACK', quantity: 2 },
        ],
      },
    ],
  },
  {
    orderNumber: 'ORD-100003',
    customerKey: 'rahul',
    addressKey: 'default',
    placedDaysAgo: 27,
    statusPath: orderToDelivered,
    couponCode: null,
    reviewRating: 4,
    shipments: [
      {
        warehouseCode: 'WH-DEL',
        statusPath: toDelivered,
        lines: [
          { sku: 'FOO014-UK9-BROWN', quantity: 1 },
          { sku: 'ELE026-BLACK', quantity: 1 },
        ],
      },
    ],
  },
  {
    orderNumber: 'ORD-100004',
    customerKey: 'neha',
    addressKey: 'default',
    placedDaysAgo: 25,
    statusPath: orderToDelivered,
    couponCode: null,
    reviewRating: 3,
    shipments: [
      {
        warehouseCode: 'WH-BLR',
        statusPath: toDelivered,
        lines: [
          { sku: 'BEA031-100ML', quantity: 2 },
          { sku: 'BEA037-RUBY', quantity: 1 },
        ],
      },
    ],
  },
  {
    orderNumber: 'ORD-100005',
    customerKey: 'asha',
    addressKey: 'default',
    placedDaysAgo: 23,
    statusPath: orderToDelivered,
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-BLR',
        statusPath: toDelivered,
        lines: [{ sku: 'APP001-M-INDIGO', quantity: 1 }],
      },
      {
        warehouseCode: 'WH-DEL',
        statusPath: toDelivered,
        lines: [{ sku: 'FOO016-UK7-TAN', quantity: 1 }],
      },
    ],
  },
  {
    orderNumber: 'ORD-100006',
    customerKey: 'rahul',
    addressKey: 'default',
    placedDaysAgo: 21,
    statusPath: [...orderToShipped, 'RTO'],
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-DEL',
        statusPath: toRtoReceived,
        lines: [{ sku: 'ELE021-8GB-128GB-BLACK', quantity: 1 }],
      },
    ],
  },
  {
    orderNumber: 'ORD-100007',
    customerKey: 'neha',
    addressKey: 'default',
    placedDaysAgo: 19,
    statusPath: ['PLACED', 'CONFIRMED', 'CANCELLED'],
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-BLR',
        statusPath: ['PENDING', 'CANCELLED'],
        lines: [{ sku: 'APP005-M-YELLOW', quantity: 1 }],
      },
    ],
  },
  {
    orderNumber: 'ORD-100008',
    customerKey: 'asha',
    addressKey: 'secondary',
    placedDaysAgo: 16,
    statusPath: orderToDelivered,
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-BLR',
        statusPath: toDelivered,
        lines: [
          { sku: 'APP004-FREESIZE-MAROON', quantity: 1 },
          { sku: 'FOO020-UK6-TAN', quantity: 1 },
        ],
      },
    ],
  },
  {
    orderNumber: 'ORD-100009',
    customerKey: 'rahul',
    addressKey: 'default',
    placedDaysAgo: 14,
    statusPath: orderToDelivered,
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-DEL',
        statusPath: toDelivered,
        lines: [
          { sku: 'APP009-M-BLUE', quantity: 1 },
          { sku: 'APP008-L-WHITE', quantity: 1 },
        ],
      },
    ],
  },
  {
    orderNumber: 'ORD-100010',
    customerKey: 'neha',
    addressKey: 'default',
    placedDaysAgo: 12,
    statusPath: [...orderToShipped, 'PARTIALLY_DELIVERED'],
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-BLR',
        statusPath: toDelivered,
        lines: [{ sku: 'BEA034-50ML', quantity: 1 }],
      },
      {
        warehouseCode: 'WH-DEL',
        statusPath: toShipped,
        lines: [{ sku: 'FOO019-UK8-GREY', quantity: 1 }],
      },
    ],
  },
  {
    orderNumber: 'ORD-100011',
    customerKey: 'asha',
    addressKey: 'default',
    placedDaysAgo: 10,
    statusPath: ['PLACED', 'CANCELLED'],
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-BLR',
        statusPath: ['PENDING', 'CANCELLED'],
        lines: [{ sku: 'ELE022-6GB-64GB-WHITE', quantity: 1 }],
      },
    ],
  },
  {
    orderNumber: 'ORD-100012',
    customerKey: 'rahul',
    addressKey: 'secondary',
    placedDaysAgo: 8,
    statusPath: orderToShipped,
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-BLR',
        statusPath: toOutForDelivery,
        lines: [{ sku: 'FOO011-UK8-BLACK', quantity: 1 }],
      },
    ],
  },
  {
    orderNumber: 'ORD-100013',
    customerKey: 'neha',
    addressKey: 'default',
    placedDaysAgo: 7,
    statusPath: orderToShipped,
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-DEL',
        statusPath: toDeliveryFailed,
        lines: [
          { sku: 'APP002-L-RUST', quantity: 1 },
          { sku: 'BEA038-ROSE', quantity: 1 },
        ],
      },
    ],
  },
  {
    orderNumber: 'ORD-100014',
    customerKey: 'asha',
    addressKey: 'default',
    placedDaysAgo: 6,
    statusPath: orderToShipped,
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-BLR',
        statusPath: toRtoInitiated,
        lines: [{ sku: 'ELE024-BLUE', quantity: 1 }],
      },
    ],
  },
  {
    orderNumber: 'ORD-100015',
    customerKey: 'rahul',
    addressKey: 'default',
    placedDaysAgo: 5,
    statusPath: [...orderToProcessing, 'PARTIALLY_SHIPPED'],
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-BLR',
        statusPath: toShipped,
        lines: [{ sku: 'APP007-M-NAVY', quantity: 1 }],
      },
      {
        warehouseCode: 'WH-DEL',
        statusPath: toReadyToShip,
        lines: [{ sku: 'FOO012-UK9-WHITE', quantity: 1 }],
      },
    ],
  },
  {
    orderNumber: 'ORD-100016',
    customerKey: 'neha',
    addressKey: 'secondary',
    placedDaysAgo: 4,
    statusPath: orderToProcessing,
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-BLR',
        statusPath: ['PENDING', 'PACKED'],
        lines: [{ sku: 'BEA033-50ML', quantity: 2 }],
      },
    ],
  },
  {
    orderNumber: 'ORD-100017',
    customerKey: 'asha',
    addressKey: 'default',
    placedDaysAgo: 3,
    statusPath: orderToProcessing,
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-BLR',
        statusPath: toReadyToShip,
        lines: [
          { sku: 'ELE025-WHITE', quantity: 1 },
          { sku: 'BEA039-CORAL', quantity: 1 },
        ],
      },
    ],
  },
  {
    orderNumber: 'ORD-100018',
    customerKey: 'rahul',
    addressKey: 'default',
    placedDaysAgo: 2,
    statusPath: ['PLACED', 'CONFIRMED'],
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-DEL',
        statusPath: ['PENDING'],
        lines: [{ sku: 'APP006-S-BLACK', quantity: 2 }],
      },
    ],
  },
  {
    orderNumber: 'ORD-100019',
    customerKey: 'neha',
    addressKey: 'default',
    placedDaysAgo: 1,
    statusPath: ['PLACED'],
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-BLR',
        statusPath: ['PENDING'],
        lines: [{ sku: 'FOO015-UK6-WHITE', quantity: 1 }],
      },
    ],
  },
  {
    orderNumber: 'ORD-100020',
    customerKey: 'asha',
    addressKey: 'default',
    placedDaysAgo: 0,
    statusPath: ['PLACED'],
    couponCode: null,
    reviewRating: null,
    shipments: [
      {
        warehouseCode: 'WH-BLR',
        statusPath: ['PENDING'],
        lines: [{ sku: 'APP003-M-EMERALD', quantity: 1 }],
      },
      {
        warehouseCode: 'WH-DEL',
        statusPath: ['PENDING'],
        lines: [{ sku: 'ELE021-8GB-256GB-BLUE', quantity: 1 }],
      },
    ],
  },
];

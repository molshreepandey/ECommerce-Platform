import type { DatabaseClient } from '@/lib/db';

// First-order coupons (D45): any earlier order that was not cancelled counts.
export function countPlacedOrdersForCustomer(
  database: DatabaseClient,
  customerId: string,
): Promise<number> {
  return database.order.count({ where: { customerId, status: { not: 'CANCELLED' } } });
}

// D44: what the customer detail page shows about a customer's orders, in one aggregate.
export async function customerOrderStats(database: DatabaseClient, customerId: string) {
  const [row] = await database.$queryRaw<
    {
      order_count: bigint;
      lifetime_value_paise: bigint | null;
      rto_count: bigint;
      cancelled_count: bigint;
    }[]
  >`
    SELECT count(*) AS order_count,
           sum(total_paise) FILTER (WHERE status NOT IN ('CANCELLED', 'RTO')) AS lifetime_value_paise,
           count(*) FILTER (WHERE status = 'RTO') AS rto_count,
           count(*) FILTER (WHERE status = 'CANCELLED') AS cancelled_count
    FROM orders WHERE customer_id = ${customerId}::uuid`;
  return {
    orderCount: Number(row?.order_count ?? 0n),
    lifetimeValuePaise: Number(row?.lifetime_value_paise ?? 0n),
    rtoCount: Number(row?.rto_count ?? 0n),
    cancelledCount: Number(row?.cancelled_count ?? 0n),
  };
}

export function recentCustomerOrders(database: DatabaseClient, customerId: string, limit: number) {
  return database.order.findMany({
    where: { customerId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalPaise: true,
      placedAt: true,
      paymentMethod: true,
    },
    orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
}

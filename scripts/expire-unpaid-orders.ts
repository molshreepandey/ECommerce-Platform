// `npm run orders:expire-unpaid`: cancels online orders whose 30-minute payment window has ended and
// releases their stock. The app also does this after checkout and order-list requests.
import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { expireUnpaidOnlineOrders } from '@/modules/payment/payment.service';

let expired = 0;
for (;;) {
  const batch = await expireUnpaidOnlineOrders({ requestId: `script-${randomUUID()}`, limit: 50 });
  expired += batch;
  if (batch < 50) break;
}
console.log(`Expired ${String(expired)} unpaid online orders.`);
process.exit(0);

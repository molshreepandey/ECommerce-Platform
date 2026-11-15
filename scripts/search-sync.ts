// `npm run search:sync`: processes every queued search outbox row now (plan §10B), for scripts, a cron
// job or after a bulk change made outside a request. Uses APP_ENV / DATABASE_URL from the environment.
import 'dotenv/config';

import { drainSearchOutbox } from '@/modules/search/search-outbox.service';

let total = { processedRowCount: 0, indexedProductCount: 0, removedProductCount: 0 };
for (;;) {
  const result = await drainSearchOutbox();
  total = {
    processedRowCount: total.processedRowCount + result.processedRowCount,
    indexedProductCount: total.indexedProductCount + result.indexedProductCount,
    removedProductCount: total.removedProductCount + result.removedProductCount,
  };
  if (!result.hasMore) break;
}
console.log(
  `Search outbox drained: ${String(total.processedRowCount)} rows, ${String(total.indexedProductCount)} products indexed, ${String(total.removedProductCount)} removed.`,
);
process.exit(0);

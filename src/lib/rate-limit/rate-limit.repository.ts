import { z } from 'zod';

import { getDatabase } from '@/lib/db';

import type { RateLimitStore } from './rate-limit.types';

const incrementedRowsSchema = z.tuple([z.object({ request_count: z.int().min(1) })]);

export const postgresRateLimitStore: RateLimitStore = {
  storeName: 'postgres',
  async incrementWindowCount(window) {
    const rows = await getDatabase().$queryRaw`
      INSERT INTO rate_limit_counters (bucket_key, window_started_at, request_count)
      VALUES (${window.bucketKey}, ${new Date(window.windowStartedAtMilliseconds)}, 1)
      ON CONFLICT (bucket_key, window_started_at)
      DO UPDATE SET request_count = rate_limit_counters.request_count + 1
      RETURNING request_count`;
    const [incrementedRow] = incrementedRowsSchema.parse(rows);
    return incrementedRow.request_count;
  },
};

// Run by start-test-server.ts with APP_ENV=test and DATABASE_URL pointing at the *_test database.
// .env supplies the remaining variables (REDIS_URL, ELASTICSEARCH_URL) without overriding those two.
import 'dotenv/config';

import { deleteTestRedisKeys } from '../tests/integration/support/test-redis';
import { truncateAllTestTables } from '../tests/integration/support/test-database';
import { seedDemoIdentity } from '../tests/integration/support/identity-fixtures';

await truncateAllTestTables();
await deleteTestRedisKeys().catch((error: unknown) => {
  console.warn('Could not clear test Redis keys; rate-limit counters may carry over.', error);
});
await seedDemoIdentity();
console.log('Test database reset with the demo identity seed.');
process.exit(0);

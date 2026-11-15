// `npm run db:seed:catalogue`: loads the demo catalogue (products, categories, brands, collections,
// banners, warehouses, opening stock) into the database at DATABASE_URL. No accounts, passwords,
// customers, orders or payments. Idempotent: a second run writes nothing. Refuses production; refuses
// staging unless CONFIRM_DEMO_CATALOGUE_SEED=staging is set for this one command:
//
//   APP_ENV=staging CONFIRM_DEMO_CATALOGUE_SEED=staging DATABASE_URL='…' REDIS_URL='…' npm run db:seed:catalogue
//
// Run after `npm run db:deploy`. Afterwards it expires the storefront's cached category tree and home page
// merchandising in Redis, so the products appear without waiting for the cache to expire.
import 'dotenv/config';

import { assertCatalogueSeedAllowed } from '../prisma/seed/catalogue-seed-guard';

function databaseTarget(databaseUrl: string | undefined): string {
  if (databaseUrl === undefined || databaseUrl === '') return '(DATABASE_URL not set)';
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`; // never the user name or password
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

try {
  assertCatalogueSeedAllowed(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

// Imported only after the guard passed: these read the app configuration for APP_ENV.
const { expireCacheTags, cacheTags } = await import('@/lib/cache-tags');
const { createSeedClient } = await import('../prisma/seed/seed-client');
const { seedDemoCatalogue } = await import('../prisma/seed/demo-catalogue.seed');

console.log(
  `Loading the demo catalogue into ${databaseTarget(process.env['DATABASE_URL'])} (APP_ENV=${process.env['APP_ENV'] ?? ''}).`,
);
const client = createSeedClient();
let exitCode = 0;
try {
  const result = await seedDemoCatalogue(client);
  if (result.outcome === 'already-present') {
    console.log(
      `The demo catalogue is already loaded (${String(result.productCount)} products); nothing was written.`,
    );
  } else {
    console.log(
      `Loaded ${String(result.productCount)} products with ${String(result.variantCount)} variants, ` +
        'collections, banners, warehouses and opening stock.',
    );
    try {
      await expireCacheTags([
        cacheTags.categories,
        cacheTags.productTypes,
        cacheTags.merchandising,
        ...result.productIds.map((productId) => cacheTags.product(productId)),
      ]);
      console.log('Expired the cached category tree and home page merchandising.');
    } catch {
      console.warn(
        'Could not reach Redis to expire the storefront cache. The products are in the database; the ' +
          'category menu may take up to an hour to show them (or save any category in the admin to refresh it).',
      );
    }
  }
} catch (error) {
  // The message only: database errors carry no secrets here, but never the connection string.
  console.error(
    `Loading the demo catalogue failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  exitCode = 1;
} finally {
  await client.$disconnect();
}
process.exit(exitCode);

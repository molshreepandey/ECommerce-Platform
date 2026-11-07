import { config as loadDotenv } from 'dotenv';

import { prepareTestDatabase } from '../support/test-database-setup';

export default async function prepareIntegrationTestDatabase(): Promise<void> {
  loadDotenv({ quiet: true });
  await prepareTestDatabase({
    testDatabaseUrl: process.env['TEST_DATABASE_URL'],
    developmentDatabaseUrl: process.env['DATABASE_URL'],
  });
}

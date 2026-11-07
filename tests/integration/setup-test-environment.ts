import { config as loadDotenv } from 'dotenv';

import { assertTestDatabaseUrl } from '../support/test-target-guard';

loadDotenv({ quiet: true });

const developmentDatabaseUrl = process.env['DATABASE_URL'];
process.env['APP_ENV'] = 'test';
process.env['DATABASE_URL'] = assertTestDatabaseUrl(
  process.env['TEST_DATABASE_URL'],
  developmentDatabaseUrl,
);
process.env['INTEGRATION_DEVELOPMENT_DATABASE_URL'] = developmentDatabaseUrl ?? '';

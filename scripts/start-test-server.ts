import { spawn, spawnSync } from 'node:child_process';

import { config as loadDotenv } from 'dotenv';

import { testServerPort } from '../tests/support/test-app';
import { prepareTestDatabase } from '../tests/support/test-database-setup';

loadDotenv({ quiet: true });

const testDatabaseUrl = await prepareTestDatabase({
  testDatabaseUrl: process.env['TEST_DATABASE_URL'],
  developmentDatabaseUrl: process.env['DATABASE_URL'],
});

const testEnvironment = {
  ...process.env,
  APP_ENV: 'test',
  DATABASE_URL: testDatabaseUrl,
  INTEGRATION_DEVELOPMENT_DATABASE_URL: process.env['DATABASE_URL'] ?? '',
};

const identitySetup = spawnSync('npx', ['tsx', 'scripts/prepare-test-identity.ts'], {
  env: testEnvironment,
  stdio: 'inherit',
});
if (identitySetup.status !== 0) process.exit(identitySetup.status ?? 1);

// --dev runs the development server (next dev) instead of the production build, still on the test
// database and test configuration, so it can be smoke-tested without touching development data.
const nextCommand = process.argv.includes('--dev') ? 'dev' : 'start';
const server = spawn('npx', ['next', nextCommand, '--port', String(testServerPort)], {
  env: { ...process.env, APP_ENV: 'test', DATABASE_URL: testDatabaseUrl },
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.kill(signal);
  });
}
server.on('exit', (exitCode) => {
  process.exit(exitCode ?? 1);
});

import { spawn } from 'node:child_process';

import { config as loadDotenv } from 'dotenv';

import { testServerPort } from '../tests/support/test-app';
import { prepareTestDatabase } from '../tests/support/test-database-setup';

loadDotenv({ quiet: true });

const testDatabaseUrl = await prepareTestDatabase({
  testDatabaseUrl: process.env['TEST_DATABASE_URL'],
  developmentDatabaseUrl: process.env['DATABASE_URL'],
});

const server = spawn('npx', ['next', 'start', '--port', String(testServerPort)], {
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

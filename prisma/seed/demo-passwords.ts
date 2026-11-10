import { assertDemoCredentialsAllowed } from './demo-credentials';
import { applyDemoPasswordHashes } from './demo-passwords.seed';
import { createSeedClient } from './seed-client';

assertDemoCredentialsAllowed(process.env['APP_ENV']);
const client = createSeedClient();
try {
  const result = await applyDemoPasswordHashes(client);
  console.info(
    `Demo password hashes: ${String(result.updated.length)} updated, ${String(result.alreadyCurrent.length)} already current, ${String(result.missing.length)} missing.`,
  );
  if (result.missing.length > 0)
    console.info(`Missing demo accounts: ${result.missing.join(', ')}`);
} finally {
  await client.$disconnect();
}

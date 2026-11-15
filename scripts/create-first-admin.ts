// `npm run admin:create-first`: creates the first super admin of a fresh deployment database, once.
//
//   FIRST_ADMIN_NAME='…' FIRST_ADMIN_EMAIL='…' FIRST_ADMIN_PASSWORD='…' npm run admin:create-first
//
// Run after `npm run db:deploy`, with the deployment's APP_ENV and DATABASE_URL. It also creates the role
// and permission catalogue (the demo seed, which normally does that, refuses staging and production).
// Refused when any staff account already exists. Remove FIRST_ADMIN_PASSWORD from the environment after
// a successful run; the password is never printed.
import 'dotenv/config';

import { getDatabase } from '@/lib/db';
import {
  createFirstSuperAdmin,
  FirstAdminRefusedError,
  parseFirstAdminEnvironment,
} from '@/modules/identity/first-admin.service';

const database = getDatabase();
try {
  const input = parseFirstAdminEnvironment(process.env);
  const created = await createFirstSuperAdmin(database, input);
  console.log(
    `Created the first super admin ${created.email} (staff user ${created.staffUserId}).`,
  );
  console.log('Remove FIRST_ADMIN_PASSWORD from the environment now; sign in on the admin host.');
  process.exitCode = 0;
} catch (error) {
  if (error instanceof FirstAdminRefusedError) {
    console.error(error.message);
  } else {
    // Only the error's name and code: database error messages can echo query values (the password hash).
    const code = error instanceof Error && 'code' in error ? ` (${String(error.code)})` : '';
    console.error(
      `Creating the first super admin failed: ${error instanceof Error ? error.name : 'unknown error'}${code}. ` +
        'Check DATABASE_URL and that `npm run db:deploy` has run.',
    );
  }
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}

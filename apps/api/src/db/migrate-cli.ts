import { migrate, reset } from './migrate.ts';
import { seedUsers } from './seed.ts';
import { closeDb } from './connection.ts';

const args = process.argv.slice(2);
const shouldReset = args.includes('--reset');
const skipSeed = args.includes('--no-seed');

try {
  if (shouldReset) {
    reset();
    console.log('database reset: all tables dropped');
  }
  const applied = migrate();
  if (applied.length) {
    for (const name of applied) console.log(`applied ${name}`);
  } else {
    console.log('database up to date');
  }
  if (!skipSeed) {
    const result = seedUsers();
    console.log(
      `seeded users: ${result.users.map((user) => user.email).join(', ')} (workspaces: ${result.workspaces.join(', ')})`,
    );
  }
} finally {
  closeDb();
}

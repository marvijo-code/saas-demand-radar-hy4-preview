import { closeDb } from './connection.ts';
import { seedUsers } from './seed.ts';

try {
  const result = seedUsers();
  console.log(JSON.stringify(result, null, 2));
} finally {
  closeDb();
}

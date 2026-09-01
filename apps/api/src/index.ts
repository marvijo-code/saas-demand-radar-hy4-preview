import { createServer } from 'node:http';
import { config } from './config.ts';
import { createApp } from './app.ts';
import { closeDb, getDb } from './db/connection.ts';
import { migrate } from './db/migrate.ts';
import { seedUsers } from './db/seed.ts';
import { deleteExpiredSessions } from './repo/users.ts';
import { startScheduler, stopScheduler } from './services/scheduler.ts';

/**
 * API entry point.
 *
 * Boot order matters: migrate → seed → listen. The database file lives outside the process,
 * so all data survives a restart.
 */
function boot(): void {
  const applied = migrate();
  if (applied.length) {
    for (const name of applied) console.log(`[db] applied ${name}`);
  }
  const seeded = seedUsers();
  getDb();
  deleteExpiredSessions(new Date().toISOString());

  const app = createApp();
  const server = createServer(app);

  server.listen(config.port, '127.0.0.1', () => {
    console.log(`[api] listening on http://127.0.0.1:${config.port}`);
    console.log(
      `[api] seeded accounts: ${seeded.users.map((user) => user.email).join(', ')}`,
    );
    startScheduler();
  });

  const shutdown = (signal: string) => {
    console.log(`[api] ${signal} received, shutting down`);
    stopScheduler();
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    setTimeout(() => {
      closeDb();
      process.exit(0);
    }, 3_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

boot();

import { ensurePostgresReady } from '../storage/postgres/migrator';
import { closePostgresPool } from '../storage/postgres/client';

async function main(): Promise<void> {
  await ensurePostgresReady();
  console.log('[INFO] Postgres is ready');
  await closePostgresPool();
}

void main();

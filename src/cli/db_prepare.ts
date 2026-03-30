import { ensurePostgresReady } from '../storage/postgres/migrator';
import { closePostgresPool } from '../storage/postgres/client';
import { ConsoleLogger } from '../core/logger';

const logger = new ConsoleLogger();

async function main(): Promise<void> {
  await ensurePostgresReady();
  logger.info('Postgres is ready');
  await closePostgresPool();
}

void main().catch((error) => {
  logger.error('Failed to prepare Postgres', error);
  process.exitCode = 1;
});

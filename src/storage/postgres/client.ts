import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import { getPostgresConfig, type PostgresConfig } from './env';

let pool: Pool | null = null;

function sslForMode(sslMode: string | undefined): false | { rejectUnauthorized: boolean } {
  if (!sslMode || sslMode === 'disable') {
    return false;
  }

  return { rejectUnauthorized: sslMode === 'verify-full' };
}

export function getPostgresPool(config = getPostgresConfig()): Pool | null {
  if (!config) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: config.connectionString,
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: sslForMode(config.sslMode)
    });
  }

  return pool;
}

export async function closePostgresPool(): Promise<void> {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>, config?: PostgresConfig | null): Promise<T> {
  const pgPool = getPostgresPool(config ?? getPostgresConfig());
  if (!pgPool) {
    throw new Error('Postgres is not configured. Set DATABASE_URL or PGDATABASE/PGUSER in the environment.');
  }

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
  config?: PostgresConfig | null
): Promise<QueryResult<T>> {
  const pgPool = getPostgresPool(config ?? getPostgresConfig());
  if (!pgPool) {
    throw new Error('Postgres is not configured. Set DATABASE_URL or PGDATABASE/PGUSER in the environment.');
  }

  return pgPool.query<T>(text, values);
}

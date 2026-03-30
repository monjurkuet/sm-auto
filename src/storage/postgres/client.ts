import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import { getPostgresConfig } from './env';

let pool: Pool | null = null;

/**
 * Gets the maximum pool size from environment variable or uses default.
 * Default is 10 for CLI usage, can be overridden with PG_POOL_MAX.
 */
function getPoolMax(): number {
  const envValue = process.env.PG_POOL_MAX;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 10;
}

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
      ssl: sslForMode(config.sslMode),
      max: getPoolMax(),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
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

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>, maxRetries = 1): Promise<T> {
  const pgPool = getPostgresPool();
  if (!pgPool) {
    throw new Error('Postgres is not configured. Set DATABASE_URL or PGDATABASE/PGUSER in the environment.');
  }

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const result = await handler(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      lastError = error as Error;
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to rollback transaction', rollbackError);
      }
      if (attempt < maxRetries && isRetryableError(error)) {
        // Exponential backoff: 100ms, 200ms, 400ms, etc.
        await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt)));
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  throw lastError;
}

/**
 * Checks if an error is retryable based on error code or message.
 * Handles PostgreSQL serialization failures (40001, 40P01) and connection issues.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Check for PostgreSQL error codes (cast to access pg-specific properties)
    const pgError = error as Error & { code?: string };
    if (pgError.code === '40001' || pgError.code === '40P01') {
      return true;
    }
    // Check error message for connection-related issues
    if (pgError.message.includes('connection') || pgError.message.includes('timeout')) {
      return true;
    }
  }
  return false;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  const pgPool = getPostgresPool();
  if (!pgPool) {
    throw new Error('Postgres is not configured. Set DATABASE_URL or PGDATABASE/PGUSER in the environment.');
  }

  return pgPool.query<T>(text, values);
}

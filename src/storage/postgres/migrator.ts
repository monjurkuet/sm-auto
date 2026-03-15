import fs from 'node:fs/promises';
import path from 'node:path';

import { Client } from 'pg';

import { getPostgresConfig, type PostgresConfig } from './env';

let readyPromise: Promise<void> | null = null;

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function getMigrationsDir(cwd = process.cwd()): string {
  return path.join(cwd, 'db', 'migrations');
}

function getAdminConnectionString(config: PostgresConfig): string {
  const url = new URL(config.connectionString);
  url.pathname = '/postgres';
  return url.toString();
}

async function ensureDatabaseExists(config: PostgresConfig): Promise<void> {
  const client = new Client({ connectionString: getAdminConnectionString(config) });
  await client.connect();
  try {
    const exists = await client.query<{ exists: boolean }>('SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists', [config.database]);
    if (exists.rows[0]?.exists) {
      return;
    }
    await client.query(`CREATE DATABASE ${quoteIdentifier(config.database)}`);
  } finally {
    await client.end();
  }
}

async function ensureMigrationTable(config: PostgresConfig): Promise<void> {
  const client = new Client({ connectionString: config.connectionString });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS scraper.schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  } finally {
    await client.end();
  }
}

export async function applyPendingMigrations(cwd = process.cwd(), config = getPostgresConfig(cwd)): Promise<void> {
  if (!config) {
    throw new Error('Postgres is not configured. Set DATABASE_URL or PGDATABASE/PGUSER in the environment.');
  }

  await ensureDatabaseExists(config);
  const client = new Client({ connectionString: config.connectionString });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS scraper');
  } finally {
    await client.end();
  }
  await ensureMigrationTable(config);

  const files = (await fs.readdir(getMigrationsDir(cwd)))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const migrationClient = new Client({ connectionString: config.connectionString });
  await migrationClient.connect();
  try {
    const applied = await migrationClient.query<{ version: string }>('SELECT version FROM scraper.schema_migrations');
    const appliedVersions = new Set(applied.rows.map((row) => row.version));

    for (const file of files) {
      if (appliedVersions.has(file)) {
        continue;
      }

      const sql = await fs.readFile(path.join(getMigrationsDir(cwd), file), 'utf8');
      await migrationClient.query('BEGIN');
      try {
        await migrationClient.query(sql);
        await migrationClient.query('INSERT INTO scraper.schema_migrations (version) VALUES ($1)', [file]);
        await migrationClient.query('COMMIT');
      } catch (error) {
        await migrationClient.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await migrationClient.end();
  }
}

export async function ensurePostgresReady(cwd = process.cwd(), config = getPostgresConfig(cwd)): Promise<void> {
  if (!config) {
    throw new Error('Postgres is not configured. Set DATABASE_URL or PGDATABASE/PGUSER in the environment.');
  }

  if (!readyPromise) {
    readyPromise = applyPendingMigrations(cwd, config);
  }

  await readyPromise;
}

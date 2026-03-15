import fs from 'node:fs';
import path from 'node:path';

import { config as loadDotenv } from 'dotenv';

let loaded = false;

function tryLoadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  loadDotenv({ path: filePath, override: false });
}

export function loadPostgresEnv(cwd = process.cwd()): void {
  if (loaded) {
    return;
  }

  tryLoadEnvFile(path.join(cwd, '.env.local'));
  tryLoadEnvFile(path.join(cwd, '.env'));
  loaded = true;
}

export interface PostgresConfig {
  connectionString: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  sslMode?: string;
}

export function getPostgresConfig(cwd = process.cwd()): PostgresConfig | null {
  loadPostgresEnv(cwd);

  const connectionString = process.env.DATABASE_URL?.trim();
  const host = process.env.PGHOST?.trim() ?? '127.0.0.1';
  const port = Number(process.env.PGPORT ?? '5432');
  const database = process.env.PGDATABASE?.trim() ?? '';
  const user = process.env.PGUSER?.trim() ?? '';
  const password = process.env.PGPASSWORD;
  const sslMode = process.env.PGSSLMODE?.trim();

  if (connectionString) {
    const url = new URL(connectionString);
    return {
      connectionString,
      host: url.hostname || host,
      port: url.port ? Number(url.port) : port,
      database: decodeURIComponent(url.pathname.replace(/^\//, '') || database),
      user: decodeURIComponent(url.username || user),
      password: decodeURIComponent(url.password || password || ''),
      sslMode
    };
  }

  if (!database || !user) {
    return null;
  }

  const auth = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
  return {
    connectionString: `postgresql://${auth}@${host}:${port}/${database}`,
    host,
    port,
    database,
    user,
    password,
    sslMode
  };
}

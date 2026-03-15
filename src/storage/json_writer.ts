import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeJsonFile(directory: string, filename: string, value: unknown): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, filename), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

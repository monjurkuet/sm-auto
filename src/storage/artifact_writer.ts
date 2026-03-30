import fs from 'node:fs/promises';
import path from 'node:path';

import { writeJsonFile } from './json_writer';

export async function writeArtifacts(
  outputDir: string,
  jobName: string,
  artifacts: Record<string, unknown>
): Promise<void> {
  const artifactDir = path.join(outputDir, 'artifacts', jobName);
  await fs.rm(artifactDir, { recursive: true, force: true });
  await fs.mkdir(artifactDir, { recursive: true });

  await Promise.all(
    Object.entries(artifacts).map(([name, value]) => writeJsonFile(artifactDir, `${name}.json`, value))
  );
}

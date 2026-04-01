import path from 'node:path';

import { ConsoleLogger, type Logger } from './logger';
import type { ScraperRuntimeOptions } from '../types/contracts';

export interface ScraperContext {
  chromePort: number;
  timeoutMs: number;
  maxScrolls: number;
  scrollDelayMs: number;
  outputDir: string;
  includeArtifacts: boolean;
  persistDb: boolean;
  logger: Logger;
}

export function createScraperContext(options: ScraperRuntimeOptions = {}): ScraperContext {
  return {
    chromePort: options.chromePort ?? 9222,
    timeoutMs: options.timeoutMs ?? 90_000,
    maxScrolls: options.maxScrolls ?? 8,
    scrollDelayMs: options.scrollDelayMs ?? 2_000,
    outputDir: path.resolve(options.outputDir ?? path.join(process.cwd(), 'output')),
    includeArtifacts: options.includeArtifacts ?? false,
    persistDb: options.persistDb ?? true,
    logger: new ConsoleLogger()
  };
}

export function createChildScraperContext(parent: ScraperContext, outputDir: string): ScraperContext {
  return {
    chromePort: parent.chromePort,
    timeoutMs: parent.timeoutMs,
    maxScrolls: parent.maxScrolls,
    scrollDelayMs: parent.scrollDelayMs,
    outputDir: path.resolve(outputDir),
    includeArtifacts: parent.includeArtifacts,
    persistDb: parent.persistDb,
    logger: parent.logger
  };
}

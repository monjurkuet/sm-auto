export interface Logger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

export class ConsoleLogger implements Logger {
  info(message: string, details?: unknown): void {
    console.log(`[INFO] ${message}`, details ?? '');
  }

  warn(message: string, details?: unknown): void {
    console.warn(`[WARN] ${message}`, details ?? '');
  }

  error(message: string, details?: unknown): void {
    console.error(`[ERROR] ${message}`, details ?? '');
  }
}

import http from 'node:http';

import puppeteer, { type Browser } from 'puppeteer-core';

import { ChromeConnectionError } from '../core/errors';

const CONNECTION_TIMEOUT_MS = 10_000;
const CONNECTION_RETRY_DELAY_MS = 1_000;
const MAX_CONNECTION_RETRIES = 3;

export class ChromeClient {
  private browser: Browser | null = null;
  private connectionPromise: Promise<Browser> | null = null;

  constructor(private readonly port: number) {}

  async getWebSocketDebuggerUrl(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new ChromeConnectionError(`Timeout connecting to Chrome on port ${this.port}`));
      }, CONNECTION_TIMEOUT_MS);

      http
        .get(`http://127.0.0.1:${this.port}/json/version`, (response) => {
          let body = '';
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => {
            clearTimeout(timeoutId);
            try {
              const parsed = JSON.parse(body) as { webSocketDebuggerUrl?: string };
              if (!parsed.webSocketDebuggerUrl) {
                reject(new ChromeConnectionError('Chrome debugger response did not include webSocketDebuggerUrl'));
                return;
              }
              resolve(parsed.webSocketDebuggerUrl);
            } catch (error) {
              reject(
                new ChromeConnectionError(`Failed to parse Chrome debugger response: ${(error as Error).message}`)
              );
            }
          });
        })
        .on('error', (error) => {
          clearTimeout(timeoutId);
          reject(new ChromeConnectionError(`Failed to connect to Chrome on port ${this.port}: ${error.message}`));
        });
    });
  }

  async connect(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.connectWithRetry();
    return this.connectionPromise;
  }

  private async connectWithRetry(): Promise<Browser> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_CONNECTION_RETRIES; attempt++) {
      try {
        const browserWSEndpoint = await this.getWebSocketDebuggerUrl();
        this.browser = await puppeteer.connect({ browserWSEndpoint, defaultViewport: null });

        this.browser.once('disconnected', () => {
          this.browser = null;
          this.connectionPromise = null;
        });

        return this.browser;
      } catch (error) {
        lastError = error as Error;

        if (attempt < MAX_CONNECTION_RETRIES) {
          await this.delay(CONNECTION_RETRY_DELAY_MS * attempt);
        }
      }
    }

    this.connectionPromise = null;
    throw lastError || new ChromeConnectionError('Failed to connect to Chrome after retries');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async disconnect(): Promise<void> {
    if (!this.browser) {
      return;
    }

    try {
      await this.browser.disconnect();
    } finally {
      this.browser = null;
      this.connectionPromise = null;
    }
  }

  isConnected(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }
}

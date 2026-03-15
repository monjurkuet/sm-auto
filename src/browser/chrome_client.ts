import http from 'node:http';

import puppeteer, { type Browser } from 'puppeteer-core';

import { ChromeConnectionError } from '../core/errors';

export class ChromeClient {
  private browser: Browser | null = null;

  constructor(private readonly port: number) {}

  async getWebSocketDebuggerUrl(): Promise<string> {
    return new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${this.port}/json/version`, (response) => {
          let body = '';
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => {
            try {
              const parsed = JSON.parse(body) as { webSocketDebuggerUrl?: string };
              if (!parsed.webSocketDebuggerUrl) {
                reject(new ChromeConnectionError('Chrome debugger response did not include webSocketDebuggerUrl'));
                return;
              }
              resolve(parsed.webSocketDebuggerUrl);
            } catch (error) {
              reject(new ChromeConnectionError(`Failed to parse Chrome debugger response: ${(error as Error).message}`));
            }
          });
        })
        .on('error', (error) => {
          reject(new ChromeConnectionError(`Failed to connect to Chrome on port ${this.port}: ${error.message}`));
        });
    });
  }

  async connect(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }

    const browserWSEndpoint = await this.getWebSocketDebuggerUrl();
    this.browser = await puppeteer.connect({ browserWSEndpoint, defaultViewport: null });
    return this.browser;
  }

  async disconnect(): Promise<void> {
    if (!this.browser) {
      return;
    }

    await this.browser.disconnect();
    this.browser = null;
  }
}

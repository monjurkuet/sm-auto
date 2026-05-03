import type { Page, HTTPResponse } from 'puppeteer-core';

import { parseRequestMetadata } from './request_metadata';
import { ResponseRegistry } from './response_registry';
import type { GraphQLFragment } from '../types/contracts';

function parseResponseBody(body: string): unknown[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Strip Facebook's anti-JSON-hijacking prefix: "for(;;);" or "for (;;);"
      const stripped = line.replace(/^for\s*\(;;\);\s*/, '');
      try {
        return JSON.parse(stripped) as unknown;
      } catch {
        return { rawText: stripped, parseError: true };
      }
    });
}

export class GraphQLCapture {
  readonly registry = new ResponseRegistry();
  private boundHandler: ((response: HTTPResponse) => Promise<void>) | null = null;

  async attach(page: Page): Promise<void> {
    if (this.boundHandler) {
      return;
    }

    this.boundHandler = async (response: HTTPResponse) => {
      const url = response.url();
      if (!url.includes('/graphql/') && !url.includes('/api/graphql/')) {
        return;
      }

      const requestMetadata = parseRequestMetadata(response.request().postData() ?? undefined);
      let body: string;
      try {
        body = await response.text();
      } catch {
        return;
      }

      const fragment: GraphQLFragment = {
        url,
        status: response.status(),
        timestamp: new Date().toISOString(),
        request: requestMetadata,
        fragments: parseResponseBody(body)
      };

      this.registry.add(fragment);
    };

    page.on('response', this.boundHandler);
  }

  async detach(page: Page): Promise<void> {
    if (!this.boundHandler) {
      return;
    }

    page.off('response', this.boundHandler);
    this.boundHandler = null;
  }
}

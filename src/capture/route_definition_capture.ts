import type { HTTPResponse, Page } from 'puppeteer-core';

import type { RequestMetadata } from '../types/contracts';
import { parseRequestMetadata } from './request_metadata';
import {
  parseBulkRouteDefinitionsBody,
  type MarketplaceRouteDefinition
} from '../parsers/embedded/marketplace_embedded_parser';

export interface RouteDefinitionCaptureRecord {
  url: string;
  status: number;
  timestamp: string;
  request: RequestMetadata;
  routes: MarketplaceRouteDefinition[];
}

export class RouteDefinitionCapture {
  readonly records: RouteDefinitionCaptureRecord[] = [];
  private boundHandler: ((response: HTTPResponse) => Promise<void>) | null = null;

  async attach(page: Page): Promise<void> {
    if (this.boundHandler) {
      return;
    }

    this.boundHandler = async (response: HTTPResponse) => {
      const url = response.url();
      if (!url.includes('/ajax/bulk-route-definitions/')) {
        return;
      }

      let body: string;
      try {
        body = await response.text();
      } catch {
        return;
      }

      const routes = parseBulkRouteDefinitionsBody(body);
      this.records.push({
        url,
        status: response.status(),
        timestamp: new Date().toISOString(),
        request: parseRequestMetadata(response.request().postData() ?? undefined),
        routes
      });
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

import type { Page } from 'puppeteer-core';

import { enableRequestFiltering } from '../browser/request_filter';
import type { GraphQLFragment, MarketplaceRouteLocationContext } from '../types/contracts';

function hasMarketplaceSearchPath(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  const root = payload as Record<string, unknown>;
  const path = Array.isArray(root.path) ? root.path : [];
  return path.some((segment) => segment === 'marketplace_search');
}

function normalizeNumericVanityPageId(value: string | null | undefined): string | null {
  return value && /^\d+$/.test(value) ? value : null;
}

export function extractMarketplaceItemIdFromHref(href: string | null): string | null {
  if (!href) {
    return null;
  }

  return href.match(/\/marketplace\/item\/(\d+)/)?.[1] ?? null;
}

export function collectMarketplaceSearchFragments(fragments: GraphQLFragment[]): GraphQLFragment[] {
  return fragments.filter((fragment) => {
    const friendlyName = fragment.request.friendlyName ?? '';
    if (/MarketplaceSearch/i.test(friendlyName)) {
      return true;
    }

    return fragment.fragments.some((payload) => hasMarketplaceSearchPath(payload));
  });
}

export function mergeMarketplaceLocationContext(
  primary: MarketplaceRouteLocationContext | null,
  fallback: MarketplaceRouteLocationContext | null
): MarketplaceRouteLocationContext | null {
  if (!primary && !fallback) {
    return null;
  }

  return {
    radius: primary?.radius ?? fallback?.radius ?? null,
    latitude: primary?.latitude ?? fallback?.latitude ?? null,
    longitude: primary?.longitude ?? fallback?.longitude ?? null,
    vanityPageId:
      normalizeNumericVanityPageId(primary?.vanityPageId) ??
      normalizeNumericVanityPageId(fallback?.vanityPageId) ??
      null
  };
}

export async function enableMarketplaceRequestFiltering(page: Page): Promise<() => Promise<void>> {
  return enableRequestFiltering(page, ['image', 'media', 'font']);
}

export async function countMarketplaceItemLinks(page: Page): Promise<number> {
  return page.evaluate(() => {
    const itemIds = Array.from(document.querySelectorAll('a'))
      .map((anchor) => anchor.getAttribute('href'))
      .map((href) => href?.match(/\/marketplace\/item\/(\d+)/)?.[1] ?? null)
      .filter((itemId): itemId is string => Boolean(itemId));

    return new Set(itemIds).size;
  });
}

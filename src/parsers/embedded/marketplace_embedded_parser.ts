import type { GraphQLFragment, RequestMetadata } from '../../types/contracts';
import { getNumber, getString } from '../graphql/shared_graphql_utils';

export interface MarketplaceRouteLocation {
  radius: number | null;
  latitude: number | null;
  longitude: number | null;
  vanityPageId: string | null;
}

export interface MarketplaceRouteDefinition {
  routeUrl: string;
  canonicalRouteName: string | null;
  location: MarketplaceRouteLocation | null;
  raw: unknown;
}

export interface MarketplaceEmbeddedQueryContext {
  queryName: string;
  buyLocation: MarketplaceRouteLocation | null;
  targetId: string | null;
  sellerId: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function collectBboxResults(value: unknown, results: unknown[]): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectBboxResults(item, results);
    }
    return;
  }

  const node = value as Record<string, unknown>;
  const bbox = asRecord(node.__bbox);
  if (bbox && Object.prototype.hasOwnProperty.call(bbox, 'result')) {
    results.push(bbox.result);
  }

  for (const child of Object.values(node)) {
    collectBboxResults(child, results);
  }
}

function parseJsonString(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseHijackedJson(body: string): unknown | null {
  return parseJsonString(body.replace(/^for\s*\(;;\);\s*/, ''));
}

function collectMatchingNodes(value: unknown, predicate: (node: Record<string, unknown>) => boolean, results: Record<string, unknown>[]): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectMatchingNodes(item, predicate, results);
    }
    return;
  }

  const node = value as Record<string, unknown>;
  if (predicate(node)) {
    results.push(node);
  }

  for (const child of Object.values(node)) {
    collectMatchingNodes(child, predicate, results);
  }
}

function extractLocationFromRouteResult(result: Record<string, unknown>): MarketplaceRouteLocation | null {
  const exportsNode = asRecord(result.exports);
  const rootView = asRecord(exportsNode?.rootView) ?? asRecord(exportsNode?.hostableView);
  const props = asRecord(rootView?.props);
  const location = asRecord(props?.location);
  if (!location) {
    return null;
  }

  return {
    radius: getNumber(location.radius),
    latitude: getNumber(location.latitude),
    longitude: getNumber(location.longitude),
    vanityPageId: getString(location.vanityPageId)
  };
}

export function extractScheduledServerJsResults(html: string): unknown[] {
  const results: unknown[] = [];
  const scriptPattern = /<script type="application\/json"[^>]*data-sjs[^>]*>([\s\S]*?)<\/script>/g;

  for (const match of html.matchAll(scriptPattern)) {
    const parsed = parseJsonString(match[1]);
    if (!parsed) {
      continue;
    }
    collectBboxResults(parsed, results);
  }

  return results;
}

export function extractScheduledServerJsJsonPayloads(html: string): unknown[] {
  const payloads: unknown[] = [];
  const scriptPattern = /<script type="application\/json"[^>]*data-sjs[^>]*>([\s\S]*?)<\/script>/g;

  for (const match of html.matchAll(scriptPattern)) {
    const parsed = parseJsonString(match[1]);
    if (parsed) {
      payloads.push(parsed);
    }
  }

  return payloads;
}

export function createEmbeddedDocumentFragment(url: string, html: string, request: RequestMetadata = { rawFields: {} }): GraphQLFragment | null {
  const results = extractScheduledServerJsResults(html);
  if (results.length === 0) {
    return null;
  }

  return {
    url,
    status: 200,
    timestamp: new Date().toISOString(),
    request: {
      ...request,
      friendlyName: request.friendlyName ?? 'embedded_document'
    },
    fragments: results
  };
}

export function parseBulkRouteDefinitionsBody(body: string): MarketplaceRouteDefinition[] {
  const parsed = asRecord(parseHijackedJson(body));
  const payload = asRecord(parsed?.payload);
  const payloads = asRecord(payload?.payloads);
  if (!payloads) {
    return [];
  }

  const definitions: MarketplaceRouteDefinition[] = [];

  for (const [routeUrl, entry] of Object.entries(payloads)) {
    const result = asRecord(asRecord(entry)?.result);
    if (!result) {
      continue;
    }

    const redirectResult = asRecord(result.redirect_result);
    const selected = redirectResult ?? result;

    definitions.push({
      routeUrl,
      canonicalRouteName: getString(asRecord(selected.exports)?.canonicalRouteName),
      location: extractLocationFromRouteResult(selected),
      raw: entry
    });

    const backgroundResult = asRecord(selected.background_result);
    if (backgroundResult) {
      definitions.push({
        routeUrl: `${routeUrl}#background`,
        canonicalRouteName: getString(asRecord(asRecord(backgroundResult)?.exports)?.canonicalRouteName),
        location: extractLocationFromRouteResult(backgroundResult),
        raw: backgroundResult
      });
    }
  }

  return definitions;
}

export function selectRouteLocation(
  definitions: MarketplaceRouteDefinition[],
  routeNamePattern: RegExp
): MarketplaceRouteLocation | null {
  const matches = definitions.filter((definition) => definition.location && routeNamePattern.test(definition.canonicalRouteName ?? ''));
  const numericVanity = matches.find((definition) => /^\d+$/.test(definition.location?.vanityPageId ?? ''));
  return numericVanity?.location ?? matches[0]?.location ?? null;
}

export function selectRouteDefinition(
  definitions: MarketplaceRouteDefinition[],
  routeNamePattern: RegExp
): MarketplaceRouteDefinition | null {
  const matches = definitions.filter((definition) => routeNamePattern.test(definition.canonicalRouteName ?? ''));
  const withLocation = matches.filter((definition) => definition.location);
  const numericVanity = withLocation.find((definition) => /^\d+$/.test(definition.location?.vanityPageId ?? ''));
  return numericVanity ?? withLocation[0] ?? matches[0] ?? null;
}

function extractBuyLocation(value: unknown): MarketplaceRouteLocation | null {
  const buyLocation = asRecord(value);
  if (!buyLocation) {
    return null;
  }

  return {
    radius: getNumber(buyLocation.radius),
    latitude: getNumber(buyLocation.latitude),
    longitude: getNumber(buyLocation.longitude),
    vanityPageId: getString(buyLocation.vanityPageId)
  };
}

function extractSellerIdFromVariables(variables: Record<string, unknown>): string | null {
  return (
    getString(variables.sellerID) ??
    getString(variables.sellerId) ??
    getString(variables.seller_id) ??
    getString(variables.profile_id) ??
    getString(variables.profileID)
  );
}

export function extractMarketplaceQueryContextsFromHtml(html: string): MarketplaceEmbeddedQueryContext[] {
  const payloads = extractScheduledServerJsJsonPayloads(html);
  const matches: MarketplaceEmbeddedQueryContext[] = [];

  for (const payload of payloads) {
    const queryNodes: Record<string, unknown>[] = [];
    collectMatchingNodes(
      payload,
      (node) => typeof node.queryName === 'string',
      queryNodes
    );

    for (const node of queryNodes) {
      const variables = asRecord(node.variables) ?? {};
      matches.push({
        queryName: String(node.queryName),
        buyLocation: extractBuyLocation(variables.buyLocation),
        targetId: getString(variables.targetId) ?? getString(variables.listingId),
        sellerId: extractSellerIdFromVariables(variables)
      });
    }
  }

  return matches;
}

export function extractMarketplaceSearchContextFromHtml(html: string): MarketplaceRouteLocation | null {
  return (
    extractMarketplaceQueryContextsFromHtml(html).find(
      (query) => /MarketplaceSearch/i.test(query.queryName) && query.buyLocation != null
    )?.buyLocation ?? null
  );
}

import type { MarketplaceRouteDefinition } from './marketplace_embedded_parser';
import { asRecord, getString } from '../graphql/shared_graphql_utils';

export interface FacebookPageRouteIdentity {
  pageId: string | null;
  vanity: string | null;
  matchedRouteName: string | null;
  matchedRouteUrl: string | null;
}

function extractIdentityFromRoute(route: MarketplaceRouteDefinition): FacebookPageRouteIdentity | null {
  if (!route.canonicalRouteName?.includes('ProfileTimeline')) {
    return null;
  }

  const raw = asRecord(route.raw);
  const result = asRecord(raw?.result);
  const exportsNode = asRecord(result?.exports) ?? result;
  const rootView = asRecord(exportsNode?.rootView) ?? asRecord(exportsNode?.hostableView);
  const props = asRecord(rootView?.props) ?? rootView;
  const pageId = getString(props?.userID);

  if (!pageId) {
    return null;
  }

  return {
    pageId,
    vanity: getString(props?.userVanity),
    matchedRouteName: route.canonicalRouteName,
    matchedRouteUrl: route.routeUrl
  };
}

export function extractFacebookPageRouteIdentity(
  routes: MarketplaceRouteDefinition[]
): FacebookPageRouteIdentity | null {
  for (const route of routes) {
    const identity = extractIdentityFromRoute(route);
    if (identity) {
      return identity;
    }
  }

  return null;
}

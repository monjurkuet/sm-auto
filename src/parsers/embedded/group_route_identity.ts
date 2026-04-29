import type { RouteDefinitionCaptureRecord } from '../../capture/route_definition_capture';
import { asRecord, getString } from '../graphql/shared_graphql_utils';

const GROUP_ROUTE_PATTERNS = [
  /GroupComet/i,
  /CometGroup/i,
  /GroupsComet/i
];

function isGroupRoute(routeName: string | null): boolean {
  if (!routeName) {
    return false;
  }
  return GROUP_ROUTE_PATTERNS.some((pattern) => pattern.test(routeName));
}

function extractIdentityFromRoute(route: { canonicalRouteName: string | null; raw: unknown }): {
  groupId: string | null;
  vanitySlug: string | null;
} | null {
  if (!isGroupRoute(route.canonicalRouteName)) {
    return null;
  }

  const raw = asRecord(route.raw);
  const result = asRecord(raw?.result);
  const exportsNode = asRecord(result?.exports) ?? result;
  const rootView = asRecord(exportsNode?.rootView) ?? asRecord(exportsNode?.hostableView);
  const props = asRecord(rootView?.props) ?? rootView;

  const groupId =
    getString(props?.groupID) ??
    getString(props?.groupId) ??
    getString(props?.id);

  if (!groupId) {
    return null;
  }

  return {
    groupId,
    vanitySlug: getString(props?.vanitySlug) ?? getString(props?.vanity) ?? null
  };
}

export function extractGroupRouteIdentity(
  records: RouteDefinitionCaptureRecord[]
): { groupId: string | null; vanitySlug: string | null } {
  for (const record of records) {
    for (const route of record.routes) {
      const identity = extractIdentityFromRoute(route);
      if (identity) {
        return identity;
      }
    }
  }

  return { groupId: null, vanitySlug: null };
}

import type { GraphQLFragment } from '../types/contracts';
import { countBy } from '../core/utils';

export function summarizeGraphqlFragments(fragments: GraphQLFragment[]): Record<string, unknown> {
  return {
    responseCount: fragments.length,
    fragmentCount: fragments.reduce((sum, fragment) => sum + fragment.fragments.length, 0),
    statuses: countBy(fragments.map((fragment) => String(fragment.status))).slice(0, 10),
    friendlyNames: countBy(fragments.map((fragment) => fragment.request.friendlyName ?? '(unknown)')).slice(0, 20),
    docIds: countBy(fragments.map((fragment) => fragment.request.docId ?? '(none)')).slice(0, 20)
  };
}

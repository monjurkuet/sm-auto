import type { GraphQLFragment } from '../types/contracts';

function countBy(values: string[]): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([value, count]) => ({ value, count }));
}

export function summarizeGraphqlFragments(fragments: GraphQLFragment[]): Record<string, unknown> {
  return {
    responseCount: fragments.length,
    fragmentCount: fragments.reduce((sum, fragment) => sum + fragment.fragments.length, 0),
    statuses: countBy(fragments.map((fragment) => String(fragment.status))).slice(0, 10),
    friendlyNames: countBy(fragments.map((fragment) => fragment.request.friendlyName ?? '(unknown)')).slice(0, 20),
    docIds: countBy(fragments.map((fragment) => fragment.request.docId ?? '(none)')).slice(0, 20)
  };
}

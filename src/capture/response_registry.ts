import type { GraphQLFragment } from '../types/contracts';

export class ResponseRegistry {
  private readonly fragments: GraphQLFragment[] = [];

  add(fragment: GraphQLFragment): void {
    this.fragments.push(fragment);
  }

  all(): GraphQLFragment[] {
    return [...this.fragments];
  }

  byFriendlyName(friendlyName: string): GraphQLFragment[] {
    return this.fragments.filter((fragment) => fragment.request.friendlyName === friendlyName);
  }

  matching(predicate: (fragment: GraphQLFragment) => boolean): GraphQLFragment[] {
    return this.fragments.filter(predicate);
  }

  clear(): void {
    this.fragments.length = 0;
  }
}

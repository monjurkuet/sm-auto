import type { GraphQLFragment, PagePost } from '../../types/contracts';
import { deepVisit, getNumber, getString } from './shared_graphql_utils';

export interface TimelineIdentity {
  pageId: string | null;
  pageName: string | null;
}

function normalizeStory(node: Record<string, unknown>): PagePost {
  const authorNode = ((node.actors as unknown[])?.[0] ?? (node.feedback as Record<string, unknown> | undefined)?.owning_profile ?? {}) as Record<string, unknown>;
  const textCandidates: string[] = [];
  const hashtags = new Set<string>();
  const links = new Set<string>();
  const mentions = new Set<string>();
  const media: PagePost['media'] = [];
  let createdAt = getNumber(node.creation_time);

  deepVisit(node, (child) => {
    if (typeof child.text === 'string' && child.text.trim().length > 20) {
      textCandidates.push(child.text.trim());
    }

    if (!createdAt && child.creation_time) {
      createdAt = getNumber(child.creation_time);
    }

    if (child.entity && typeof child.entity === 'object') {
      const entity = child.entity as Record<string, unknown>;
      if (entity.__typename === 'Hashtag' && entity.name) {
        hashtags.add(String(entity.name));
      }
      if (entity.__typename === 'Group' && entity.name) {
        mentions.add(String(entity.name));
      }
    }

    if (typeof child.url === 'string' && child.url.includes('l.facebook.com/l.php')) {
      try {
        const realUrl = new URL(child.url).searchParams.get('u');
        if (realUrl) {
          links.add(realUrl);
        }
      } catch {
        return;
      }
    }

    if (typeof child.external_url === 'string') {
      links.add(child.external_url);
    }

    if (child.photo_image && typeof child.photo_image === 'object') {
      const image = child.photo_image as Record<string, unknown>;
      media.push({
        type: 'photo',
        id: getString(child.id),
        url: getString(image.uri),
        width: getNumber(image.width) ?? undefined,
        height: getNumber(image.height) ?? undefined
      });
    }

    if (child.__typename === 'Video') {
      media.push({
        type: 'video',
        id: getString(child.id),
        url: getString(child.browser_native_hd_url) ?? getString(child.playable_url),
        durationSec: getNumber(child.length_in_second) ?? undefined
      });
    }
  });

  const text = textCandidates.sort((left, right) => right.length - left.length)[0] ?? null;

  if (text) {
    for (const match of text.matchAll(/#(\w+)/g)) {
      hashtags.add(match[1]);
    }
  }

  const dedupedMedia = media.filter((entry, index, all) => {
    return index === all.findIndex((candidate) => candidate.id === entry.id && candidate.url === entry.url);
  });

  return {
    id: getString(node.id),
    postId: getString(node.post_id),
    permalink: getString(node.permalink_url) ?? getString(node.url),
    createdAt,
    text,
    hashtags: [...hashtags],
    mentions: [...mentions],
    links: [...links],
    media: dedupedMedia,
    metrics: {
      reactions: null,
      comments: null,
      shares: null
    },
    author: {
      id: getString(authorNode.id),
      name: getString(authorNode.name)
    }
  };
}

function scorePost(post: PagePost): number {
  let score = 0;
  if (post.text) score += 5;
  if (post.author.id || post.author.name) score += 3;
  if (post.createdAt) score += 2;
  score += post.media.length * 2;
  score += post.links.length;
  score += post.hashtags.length;
  return score;
}

export function parseTimelineFragments(fragments: GraphQLFragment[]): PagePost[] {
  const posts = new Map<string, PagePost>();

  for (const fragment of fragments) {
    for (const payload of fragment.fragments) {
      deepVisit(payload, (node) => {
        if (node.__typename !== 'Story' && node.__isFeedUnit !== 'Story') {
          return;
        }

        const post = normalizeStory(node);
        if (post.id) {
          const existing = posts.get(post.id);
          if (!existing || scorePost(post) >= scorePost(existing)) {
            posts.set(post.id, post);
          }
        }
      });
    }
  }

  return [...posts.values()];
}

export function parseTimelineIdentity(fragments: GraphQLFragment[]): TimelineIdentity {
  let identity: TimelineIdentity = {
    pageId: null,
    pageName: null
  };

  for (const fragment of fragments) {
    for (const payload of fragment.fragments) {
      deepVisit(payload, (node) => {
        if (identity.pageId && identity.pageName) {
          return;
        }

        if (node.__typename === 'Story' || node.__isFeedUnit === 'Story') {
          const actor = Array.isArray(node.actors) ? (node.actors[0] as Record<string, unknown> | undefined) : undefined;
          if (actor) {
            identity = {
              pageId: getString(actor.id) ?? identity.pageId,
              pageName: getString(actor.name) ?? identity.pageName
            };
            return;
          }
        }

        const feedbackOwner = (node.feedback as Record<string, unknown> | undefined)?.owning_profile as Record<string, unknown> | undefined;
        if (feedbackOwner) {
          identity = {
            pageId: getString(feedbackOwner.id) ?? identity.pageId,
            pageName: getString(feedbackOwner.name) ?? identity.pageName
          };
        }
      });
    }
  }

  return identity;
}

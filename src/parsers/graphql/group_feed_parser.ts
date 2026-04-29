import type { GraphQLFragment, GroupPost } from '../../types/contracts';
import { deepVisit, asRecord, getString, getNumber } from './shared_graphql_utils';

// ── Fragment collection ──

function payloadHasGroupFeedPath(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  const record = payload as Record<string, unknown>;
  const path = Array.isArray(record.path) ? record.path : [];
  return path.some(
    (segment) => segment === 'group_feed_units' || segment === 'feed_units'
  );
}

export function collectGroupFeedFragments(fragments: GraphQLFragment[]): GraphQLFragment[] {
  return fragments.filter((fragment) => {
    const friendlyName = fragment.request.friendlyName ?? '';
    if (/GroupCometFeed|GroupsCometFeed|GroupCometDiscussion/i.test(friendlyName)) {
      return true;
    }

    return fragment.fragments.some((payload) => payloadHasGroupFeedPath(payload));
  });
}

// ── Story normalisation ──

function normalizeGroupFeedStory(node: Record<string, unknown>): GroupPost | null {
  // Extract postId from several possible field names
  const postId =
    getString(node.story_key) ??
    getString(node.post_id) ??
    getString(node.id);

  if (!postId) {
    return null;
  }

  // ── Author ──
  const authorNode =
    (Array.isArray(node.actors) ? asRecord(node.actors[0]) : null) ??
    asRecord(node.actor) ??
    asRecord(node.author) ??
    (asRecord(node.feedback) != null
      ? asRecord((node.feedback as Record<string, unknown>).owning_profile)
      : null);

  const authorId = getString(authorNode?.id);
  const authorName = getString(authorNode?.name);

  // ── Text ──
  const textCandidates: string[] = [];

  const messageNode = asRecord(node.message);
  if (messageNode) {
    const messageText = getString(messageNode.text);
    if (messageText && messageText.trim().length > 0) {
      textCandidates.push(messageText.trim());
    }
  }

  const messageText = getString(node.message_text);
  if (messageText && messageText.trim().length > 0) {
    textCandidates.push(messageText.trim());
  }

  const debugText = getString(node.story_debug_info);
  if (debugText && debugText.trim().length > 0) {
    textCandidates.push(debugText.trim());
  }

  // Also walk sub-nodes for long text candidates
  deepVisit(node, (child) => {
    if (typeof child.text === 'string' && child.text.trim().length > 20) {
      textCandidates.push(child.text.trim());
    }
  });

  // Prefer the longest text candidate
  const text = textCandidates.sort((a, b) => b.length - a.length)[0] ?? null;

  // ── Media ──
  const media: GroupPost['media'] = [];

  deepVisit(node, (child) => {
    // Photo
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

    // Video
    if (child.__typename === 'Video') {
      media.push({
        type: 'video',
        id: getString(child.id),
        url: getString(child.browser_native_hd_url) ?? getString(child.playable_url),
        width: getNumber(child.original_width) ?? undefined,
        height: getNumber(child.original_height) ?? undefined
      });
    }

    // Attachments with media
    if (child.style_type_renderer && typeof child.style_type_renderer === 'object') {
      const renderer = asRecord(child.style_type_renderer);
      if (renderer) {
        const attachment = asRecord(renderer.attachment) ?? asRecord(renderer.media);
        if (attachment) {
          const mediaNode = asRecord(attachment.media) ?? attachment;
          if (mediaNode.photo_image && typeof mediaNode.photo_image === 'object') {
            const image = mediaNode.photo_image as Record<string, unknown>;
            media.push({
              type: 'photo',
              id: getString(mediaNode.id),
              url: getString(image.uri),
              width: getNumber(image.width) ?? undefined,
              height: getNumber(image.height) ?? undefined
            });
          }
        }
      }
    }
  });

  // Deduplicate media by id+url
  const dedupedMedia = media.filter(
    (entry, index, all) =>
      index === all.findIndex((c) => c.id === entry.id && c.url === entry.url)
  );

  // ── Metrics ──
  let reactions: number | null = null;
  let comments: number | null = null;
  let shares: number | null = null;

  const feedback = asRecord(node.feedback);
  if (feedback) {
    const reactionSummary = asRecord(feedback.reaction_summary);
    if (reactionSummary) {
      reactions = getNumber(reactionSummary.count) ?? getNumber(reactionSummary.total_count);
    }
    comments = getNumber(feedback.comment_count) ?? getNumber(feedback.total_comment_count);
    shares = getNumber(feedback.share_count);
  }

  // Fallback: direct fields on the story node
  if (reactions === null) {
    const reactionSummary = asRecord(node.reaction_summary);
    if (reactionSummary) {
      reactions = getNumber(reactionSummary.count) ?? getNumber(reactionSummary.total_count);
    }
  }
  if (comments === null) {
    comments = getNumber(node.comment_count) ?? getNumber(node.total_comment_count);
  }
  if (shares === null) {
    shares = getNumber(node.share_count);
  }

  // ── Created at ──
  const createdAtNum = getNumber(node.creation_time) ?? getNumber(node.created_time);
  const createdAt = createdAtNum != null ? new Date(createdAtNum * 1000).toISOString() : null;

  // ── Permalink ──
  const permalink = getString(node.permalink_url) ?? getString(node.url);

  return {
    id: getString(node.id) ?? postId,
    postId,
    permalink,
    createdAt,
    text,
    author: {
      id: authorId,
      name: authorName
    },
    media: dedupedMedia,
    metrics: {
      reactions,
      comments,
      shares
    },
    isApproved: null
  };
}

// ── Dedup scoring ──

function scoreGroupPost(post: GroupPost): number {
  let score = 0;
  if (post.postId) score += 10;
  if (post.permalink) score += 8;
  if (post.id) score += 4;
  if (post.text) score += 5;
  if (post.author.id || post.author.name) score += 3;
  if (post.createdAt) score += 2;
  if (post.metrics.reactions !== null) score += 2;
  if (post.metrics.comments !== null) score += 2;
  if (post.metrics.shares !== null) score += 2;
  score += post.media.length * 2;
  return score;
}

// ── Main parser ──

export function parseGroupFeedFragments(fragments: GraphQLFragment[]): GroupPost[] {
  const posts = new Map<string, GroupPost>();

  for (const fragment of fragments) {
    for (const payload of fragment.fragments) {
      deepVisit(payload, (node) => {
        if (node.__typename !== 'Story' && node.__isFeedUnit !== 'Story') {
          return;
        }

        const post = normalizeGroupFeedStory(node);
        if (!post) {
          return;
        }

        const dedupKey = post.postId ?? post.permalink ?? post.id;
        if (!dedupKey) {
          return;
        }

        const existing = posts.get(dedupKey);
        const existingScore = existing ? scoreGroupPost(existing) : -1;
        const candidateScore = scoreGroupPost(post);
        if (candidateScore >= existingScore) {
          posts.set(dedupKey, post);
        }
      });
    }
  }

  return [...posts.values()];
}

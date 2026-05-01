import type { GraphQLFragment, GroupPostComment } from '../../types/contracts';
import { deepVisit, asRecord, getString, getNumber } from './shared_graphql_utils';

// ── Fragment collection ──

function payloadHasCommentPath(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  const record = payload as Record<string, unknown>;
  const path = Array.isArray(record.path) ? record.path : [];
  return path.some(
    (segment) =>
      segment === 'all_comments' ||
      segment === 'top_level_comments' ||
      segment === 'comment_list'
  );
}

export function collectGroupCommentFragments(fragments: GraphQLFragment[]): GraphQLFragment[] {
  return fragments.filter((fragment) => {
    const friendlyName = fragment.request.friendlyName ?? '';
    if (/CometUFI|Feedback|CommentMutation|UFIFeedback/i.test(friendlyName)) {
      return true;
    }

    return fragment.fragments.some((payload) => payloadHasCommentPath(payload));
  });
}

// ── Base64 ID decoding ──

/**
 * Decode a base64 Facebook comment ID to a human-readable form.
 * Format: "comment:POSTID_COMMENTID" (base64-encoded).
 * Returns the decoded string (e.g., "1315106307381875_1315106457381860")
 * or the original ID if decoding fails.
 */
function decodeCommentId(rawId: string): string {
 try {
 const decoded = Buffer.from(rawId, 'base64').toString('utf-8');
 const match = decoded.match(/^comment:(.+)$/);
 if (match) return match[1];
 // If it decoded but doesn't match the pattern, still return decoded
 if (decoded && !/^[A-Za-z0-9+/=]+$/.test(decoded)) return decoded;
 } catch {
 // not base64, return as-is
 }
 return rawId;
}

// ── Comment normalisation ──

function normalizeComment(node: Record<string, unknown>): GroupPostComment | null {
 // Extract id from several possible field names
 const rawCommentId =
 getString(node.id) ??
 getString(node.comment_id);

 if (!rawCommentId) {
 return null;
 }

 const commentId = decodeCommentId(rawCommentId);

 // ── Parent ID ──
 // Facebook nests the parent comment under different keys depending on the surface.
 // For replies, the parent is the top-level comment they're replying to.
 const parentNode =
 asRecord(node.parent_comment) ??
 asRecord(node.parent);
 const rawParentId = getString(parentNode?.id) ?? null;
 const parentId = rawParentId ? decodeCommentId(rawParentId) : null;

  // ── Author ──
  const authorNode =
    asRecord(node.author) ??
    asRecord(node.actor);
  const authorId = getString(authorNode?.id);
  const authorName = getString(authorNode?.name);

  // ── Text ──
  const bodyNode = asRecord(node.body);
  const messageNode = asRecord(node.message);
  const text =
    getString(bodyNode?.text) ??
    getString(messageNode?.text) ??
    getString(node.comment_text) ??
    getString(node.text);

  // ── Created at ──
  const createdAtNum =
    getNumber(node.created_time) ??
    getNumber(node.created_at);
  const createdAt = createdAtNum != null ? new Date(createdAtNum * 1000).toISOString() : null;

  // ── Metrics ──
  let reactions: number | null = null;
  let replies: number | null = null;

  // reaction_summary on the comment node
  const reactionSummary = asRecord(node.reaction_summary);
  if (reactionSummary) {
    reactions = getNumber(reactionSummary.count) ?? getNumber(reactionSummary.total_count);
  }

  // feedback.reaction_count
  const feedback = asRecord(node.feedback);
  if (feedback) {
    if (reactions === null) {
      reactions = getNumber(feedback.reaction_count);
    }
  }

  // Fallback: direct fields
  if (reactions === null) {
    reactions = getNumber(node.reaction_count);
  }

  replies =
    getNumber(node.reply_count) ??
    getNumber(node.comment_count);

  return {
    id: commentId,
    parentId,
    author: {
      id: authorId,
      name: authorName
    },
    text,
    createdAt,
    metrics: {
      reactions,
      replies
    }
  };
}

// ── Dedup scoring ──

function scoreComment(comment: GroupPostComment): number {
  let score = 0;
  if (comment.id) score += 10;
  if (comment.parentId) score += 2;
  if (comment.author.id) score += 3;
  if (comment.author.name) score += 2;
  if (comment.text) score += 5;
  if (comment.createdAt) score += 3;
  if (comment.metrics.reactions !== null) score += 2;
  if (comment.metrics.replies !== null) score += 2;
  return score;
}

// ── Main parser ──

export function parseGroupCommentFragments(fragments: GraphQLFragment[]): GroupPostComment[] {
  const comments = new Map<string, GroupPostComment>();

  for (const fragment of fragments) {
    for (const payload of fragment.fragments) {
      deepVisit(payload, (node) => {
        // Identify comment nodes by __typename or by id + text + author pattern
        const isCommentTypename = node.__typename === 'Comment';
        const hasCommentPattern =
          !!getString(node.id) &&
          (!!getString(node.comment_text) ||
            !!getString((asRecord(node.body) ?? {}).text) ||
            !!getString((asRecord(node.message) ?? {}).text)) &&
          (asRecord(node.author) != null || asRecord(node.actor) != null);

        if (!isCommentTypename && !hasCommentPattern) {
          return;
        }

        const comment = normalizeComment(node);
        if (!comment) {
          return;
        }

        const dedupKey = comment.id;
        if (!dedupKey) {
          return;
        }

        const existing = comments.get(dedupKey);
        const existingScore = existing ? scoreComment(existing) : -1;
        const candidateScore = scoreComment(comment);
        if (candidateScore >= existingScore) {
          comments.set(dedupKey, comment);
        }
      });
    }
  }

  return Array.from(comments.values());
}

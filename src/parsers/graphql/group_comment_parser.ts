import type { GraphQLFragment, GroupPostComment } from '../../types/contracts';
import { deepVisit, asRecord, getString, getNumber, parseI18nCount } from './shared_graphql_utils';

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
 if (/CometUFI|Feedback|CommentMutation|UFIFeedback|embedded_document/i.test(friendlyName)) {
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

/**
 * Decode a base64 Facebook Feedback ID to extract the comment ID.
 * Format: "feedback:POSTID_COMMENTID" (base64-encoded).
 * Returns the decoded ID part (e.g., "1315106307381875_1315132400712599")
 * or null if decoding fails or doesn't match.
 */
function decodeFeedbackIdToCommentId(feedbackId: string): string | null {
 try {
 const decoded = Buffer.from(feedbackId, 'base64').toString('utf-8');
 const match = decoded.match(/^feedback:(.+)$/);
 if (match) return match[1];
 return null;
 } catch {
 return null;
 }
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
 // Facebook provides parent info under several different keys:
 // - parent_comment.id (GraphQL API responses)
 // - parent.id (alternate)
 // - comment_direct_parent.id (embedded document)
 const parentNode =
 asRecord(node.parent_comment) ??
 asRecord(node.parent) ??
 asRecord(node.comment_direct_parent);
 const rawParentId = getString(parentNode?.id) ?? null;
 const parentId = rawParentId ? decodeCommentId(rawParentId) : null;

 // ── Author ──
 const authorNode =
 asRecord(node.author) ??
 asRecord(node.actor);
 const authorId = getString(authorNode?.id);
 const authorName = getString(authorNode?.name);

 // ── Text ──
 // Facebook provides comment text in multiple paths:
 // - body.text (most common in embedded + GraphQL)
 // - message.text (alternate)
 // - comment_text (older format)
 // - text (simplest)
 // Some comments have body: null (emoji-only or attachment comments)
 const bodyNode = asRecord(node.body);
 const messageNode = asRecord(node.message);
 const text =
 getString(bodyNode?.text) ??
 getString(messageNode?.text) ??
 getString(node.comment_text) ??
 getString(node.text) ??
 null;

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

 // feedback.reaction_count (object with .count or raw number)
 const feedback = asRecord(node.feedback);
 if (feedback) {
 if (reactions === null) {
 const rc = asRecord(feedback.reaction_count);
 if (rc) {
 reactions = getNumber(rc.count);
 } else if (typeof feedback.reaction_count === 'number') {
 reactions = feedback.reaction_count;
 }
 }
 // feedback.comment_rendering_instance.comments.total_count for reply count
 const cri = asRecord(feedback.comment_rendering_instance);
 if (cri) {
 const criComments = asRecord(cri.comments);
 if (criComments && replies === null) {
 replies = getNumber(criComments.total_count);
 }
 }
 }

  // Fallback: direct fields
  if (reactions === null) {
    const rc = asRecord(node.reaction_count);
    if (rc) {
      reactions = getNumber(rc.count);
    } else {
      reactions = getNumber(node.reaction_count) ?? parseI18nCount(node.i18n_reaction_count);
    }
  }

  if (replies === null) {
    replies =
      getNumber(node.reply_count) ??
      getNumber(node.comment_count) ??
      parseI18nCount(node.i18n_comment_count);
  }

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
// Prefer comments with more data (text, author, metrics, timestamps)

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

// ── Feedback node metrics extraction ──
// Feedback nodes for comments may contain reply counts even when
// the Comment node itself doesn't have them.

interface FeedbackMetrics {
 reactions: number | null;
 replies: number | null;
}

function extractCommentMetricsFromFeedback(fb: Record<string, unknown>): FeedbackMetrics {
 let reactions: number | null = null;
 let replies: number | null = null;

 // UFI renderer path
 const ufi = asRecord(fb.comet_ufi_summary_and_actions_renderer);
 if (ufi) {
 const ufiFeedback = asRecord(ufi.feedback);
 if (ufiFeedback) {
 const rc = asRecord(ufiFeedback.reaction_count);
 if (rc) reactions = getNumber(rc.count);
 else if (typeof ufiFeedback.reaction_count === 'number') reactions = ufiFeedback.reaction_count;

 const cri = asRecord(ufiFeedback.comment_rendering_instance);
 if (cri) {
 const criComments = asRecord(cri.comments);
 if (criComments) replies = getNumber(criComments.total_count);
 }
 }
 }

 // comment_rendering_instance directly on Feedback node
 if (replies === null) {
 const cri = asRecord(fb.comment_rendering_instance);
 if (cri) {
 const criComments = asRecord(cri.comments);
 if (criComments) replies = getNumber(criComments.total_count);
 }
 }

 // Direct reaction_count
 if (reactions === null) {
 const rc = asRecord(fb.reaction_count);
 if (rc) reactions = getNumber(rc.count);
 else if (typeof fb.reaction_count === 'number') reactions = fb.reaction_count;
 }

 return { reactions, replies };
}

// ── Main parser ──

export function parseGroupCommentFragments(fragments: GraphQLFragment[]): GroupPostComment[] {
 const comments = new Map<string, GroupPostComment>();

 // Phase 1: Collect Feedback nodes for comments, indexed by comment ID
 const feedbackByCommentId = new Map<string, FeedbackMetrics>();

 for (const fragment of fragments) {
 for (const payload of fragment.fragments) {
 deepVisit(payload, (node) => {
 if (node.__typename !== 'Feedback') return;

 const feedbackId = getString(node.id);
 if (!feedbackId) return;

 const commentId = decodeFeedbackIdToCommentId(feedbackId);
 if (!commentId) return;

 // Only index Feedback nodes for comments (IDs containing underscore after the post ID)
 // Post-level Feedback IDs decode to just a number, comment-level have POSTID_COMMENTID
 if (!commentId.includes('_')) return;

 const metrics = extractCommentMetricsFromFeedback(node);
 const existing = feedbackByCommentId.get(commentId);
 if (!existing) {
 feedbackByCommentId.set(commentId, metrics);
 } else {
 // Merge: prefer non-null values
 if (metrics.reactions !== null && existing.reactions === null) {
 existing.reactions = metrics.reactions;
 }
 if (metrics.replies !== null && existing.replies === null) {
 existing.replies = metrics.replies;
 }
 }
 });
 }
 }

 // Phase 2: Parse Comment nodes and merge Feedback metrics
 for (const fragment of fragments) {
 for (const payload of fragment.fragments) {
 deepVisit(payload, (node) => {
 // Identify comment nodes by __typename (primary) or by pattern (fallback)
 const isCommentTypename = node.__typename === 'Comment';
 const hasCommentPattern =
 !!getString(node.id) &&
 (asRecord(node.author) != null || asRecord(node.actor) != null) &&
 (!!getString(node.comment_text) ||
 !!getString((asRecord(node.body) ?? {}).text) ||
 !!getString((asRecord(node.message) ?? {}).text));

 // Accept __typename=Comment even without text (emoji/attachment comments)
 // Also accept the pattern match for nodes without __typename
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

 // Merge metrics from standalone Feedback node
 const fbMetrics = feedbackByCommentId.get(dedupKey);
 if (fbMetrics) {
 if (comment.metrics.reactions === null && fbMetrics.reactions !== null) {
 comment.metrics.reactions = fbMetrics.reactions;
 }
 if (comment.metrics.replies === null && fbMetrics.replies !== null) {
 comment.metrics.replies = fbMetrics.replies;
 }
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

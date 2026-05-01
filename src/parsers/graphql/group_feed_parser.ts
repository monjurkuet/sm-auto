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
 if (/GroupCometFeed|GroupsCometFeed|GroupCometDiscussion|embedded_document/i.test(friendlyName)) {
 return true;
 }

 return fragment.fragments.some((payload) => payloadHasGroupFeedPath(payload));
 });
}

// ── Comet sections text extraction ──

function extractTextFromCometSections(cometSections: Record<string, unknown>): string | null {
 const contentSection = asRecord(cometSections.content);
 if (!contentSection) return null;

 const contentStory = asRecord(contentSection.story);
 if (!contentStory) return null;

 // Direct message on the content story
 const contentMessage = asRecord(contentStory.message);
 if (contentMessage) {
 const contentText = getString(contentMessage.text);
 if (contentText && contentText.trim().length > 0) {
 return contentText.trim();
 }
 }

 // Nested message rendering strategy
 // Path: content.story.comet_sections.message.story.message.text
 const nestedCometSections = asRecord(contentStory.comet_sections);
 if (nestedCometSections) {
 const messageSection = asRecord(nestedCometSections.message);
 if (messageSection) {
 const nestedStory = asRecord(messageSection.story);
 if (nestedStory) {
 const nestedMsg = asRecord(nestedStory.message);
 if (nestedMsg) {
 const nestedText = getString(nestedMsg.text);
 if (nestedText && nestedText.trim().length > 0) {
 return nestedText.trim();
 }
 }
 }
 }
 }

 // Also check message_container
 const messageContainer = asRecord(contentStory.message_container);
 if (messageContainer) {
 const mcStory = asRecord(messageContainer.story);
 if (mcStory) {
 const mcMsg = asRecord(mcStory.message);
 if (mcMsg) {
 const mcText = getString(mcMsg.text);
 if (mcText && mcText.trim().length > 0) {
 return mcText.trim();
 }
 }
 }
 }

 return null;
}

// ── Story normalisation ──

/**
 * Check if an ID looks like a base64-encoded Facebook entity ID
 * (e.g., "UzpfSTYxNTY2..." or "Y29tbWVudDo...").
 * These are NOT valid numeric post IDs and should not be used as postId.
 */
function isBase64EntityId(id: string): boolean {
 // Numeric post IDs are pure digits (possibly with underscores for compound keys)
 if (/^\d+(_\d+)?$/.test(id)) return false;
 // If it contains characters outside [0-9_] and looks like base64, reject it
 return /^[A-Za-z0-9+/=]{20,}$/.test(id);
}

/**
 * Try to extract a numeric post ID from a base64-encoded compound entity ID.
 * Facebook uses compound keys like "user:USERID:VK:POSTID" encoded in base64.
 * We decode and extract the trailing numeric segment as the postId.
 * Returns the numeric post ID string, or null if extraction fails.
 */
function extractPostIdFromBase64EntityId(id: string): string | null {
 if (!isBase64EntityId(id)) return null;
 try {
 const decoded = Buffer.from(id, 'base64').toString('utf-8');
 // Match trailing numeric ID in compound keys like "S:_I100089532218170:VK:1315106307381875"
 const match = decoded.match(/[:](\d{10,})$/);
 return match ? match[1] : null;
 } catch {
 return null;
 }
}

function normalizeGroupFeedStory(node: Record<string, unknown>): GroupPost | null {
 // Extract postId from several possible field names
 let postId =
 getString(node.story_key) ??
 getString(node.post_id) ??
 getString(node.id);

 if (!postId) {
 return null;
 }

 // Skip base64-encoded entity IDs — but first try to extract the numeric post ID
 // from compound keys like "user:USERID:VK:POSTID"
 if (isBase64EntityId(postId)) {
 const extracted = extractPostIdFromBase64EntityId(postId);
 if (extracted) {
 postId = extracted;
 } else {
 return null;
 }
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

 // Strategy 1: Direct fields on the story node
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

 // Strategy 2: Comet sections — text is nested inside rendering strategies
 const cometSections = asRecord(node.comet_sections);
 if (cometSections) {
 const cometText = extractTextFromCometSections(cometSections);
 if (cometText) {
 textCandidates.push(cometText);
 }
 }

 // Strategy 3: Walk sub-nodes for long text candidates (fallback)
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
 // Photo node with photo_image (standalone Photo __typename)
 if (child.photo_image && typeof child.photo_image === 'object') {
 const image = child.photo_image as Record<string, unknown>;
 const uri = getString(image.uri);
 if (uri) {
 media.push({
 type: 'photo',
 id: getString(child.id),
 url: uri,
 width: getNumber(image.width) ?? undefined,
 height: getNumber(image.height) ?? undefined
 });
 }
 }

 // Photo inside attachment sub-nodes: media.image.uri
 if (child.__typename === 'Photo' && child.image && typeof child.image === 'object') {
 const image = child.image as Record<string, unknown>;
 const uri = getString(image.uri);
 if (uri) {
 media.push({
 type: 'photo',
 id: getString(child.id),
 url: uri,
 width: getNumber(image.width) ?? undefined,
 height: getNumber(image.height) ?? undefined
 });
 }
 }

 // Photo with viewer_image (high-res fallback)
 if (child.__typename === 'Photo' && child.viewer_image && typeof child.viewer_image === 'object') {
 const image = child.viewer_image as Record<string, unknown>;
 const uri = getString(image.uri);
 if (uri && !media.some(m => m.id === getString(child.id))) {
 media.push({
 type: 'photo',
 id: getString(child.id),
 url: uri,
 width: getNumber(image.width) ?? undefined,
 height: getNumber(image.height) ?? undefined
 });
 }
 }

 // Video
 if (child.__typename === 'Video') {
 const url = getString(child.browser_native_hd_url) ?? getString(child.playable_url);
 if (url) {
 media.push({
 type: 'video',
 id: getString(child.id),
 url,
 width: getNumber(child.original_width) ?? undefined,
 height: getNumber(child.original_height) ?? undefined
 });
 }
 }

 // Attachments with media via style_type_renderer
 if (child.style_type_renderer && typeof child.style_type_renderer === 'object') {
 const renderer = asRecord(child.style_type_renderer);
 if (renderer) {
 const attachment = asRecord(renderer.attachment) ?? asRecord(renderer.media);
 if (attachment) {
 const mediaNode = asRecord(attachment.media) ?? attachment;
 if (mediaNode.photo_image && typeof mediaNode.photo_image === 'object') {
 const image = mediaNode.photo_image as Record<string, unknown>;
 const uri = getString(image.uri);
 if (uri) {
 media.push({
 type: 'photo',
 id: getString(mediaNode.id),
 url: uri,
 width: getNumber(image.width) ?? undefined,
 height: getNumber(image.height) ?? undefined
 });
 }
 }
 }
 }
 }
 });

 // Also extract media from top-level attachments array
 // Structure: attachments[].styles.attachment.all_subattachments.nodes[].media
 const attachments = Array.isArray(node.attachments) ? node.attachments : [];
 for (const att of attachments) {
 const styles = asRecord(att?.styles);
 if (!styles) continue;
 const attData = asRecord(styles.attachment);
 if (!attData) continue;
 const allSub = asRecord(attData.all_subattachments);
 if (!allSub || !Array.isArray(allSub.nodes)) continue;
 for (const subNode of allSub.nodes) {
 const subMedia = asRecord(subNode?.media);
 if (!subMedia) continue;
 const subImage = asRecord(subMedia.image);
 if (subImage) {
 const uri = getString(subImage.uri);
 if (uri) {
 media.push({
 type: 'photo',
 id: getString(subMedia.id),
 url: uri,
 width: getNumber(subImage.width) ?? undefined,
 height: getNumber(subImage.height) ?? undefined
 });
 }
 }
 if (subMedia.__typename === 'Video') {
 const url = getString(subMedia.browser_native_hd_url) ?? getString(subMedia.playable_url);
 if (url) {
 media.push({
 type: 'video',
 id: getString(subMedia.id),
 url,
 width: getNumber(subMedia.original_width) ?? undefined,
 height: getNumber(subMedia.original_height) ?? undefined
 });
 }
 }
 }
 }

 // Also extract from comet_sections.content.story.attachments (nested comet structure)
 if (cometSections) {
 const contentSection = asRecord(cometSections.content);
 if (contentSection) {
 const contentStory = asRecord(contentSection.story);
 if (contentStory) {
 const csAttachments = Array.isArray(contentStory.attachments) ? contentStory.attachments : [];
 for (const att of csAttachments) {
 const styles = asRecord(att?.styles);
 if (!styles) continue;
 const attData = asRecord(styles.attachment);
 if (!attData) continue;
 const allSub = asRecord(attData.all_subattachments);
 if (!allSub || !Array.isArray(allSub.nodes)) continue;
 for (const subNode of allSub.nodes) {
 const subMedia = asRecord(subNode?.media);
 if (!subMedia) continue;
 const subImage = asRecord(subMedia.image);
 if (subImage) {
 const uri = getString(subImage.uri);
 if (uri) {
 media.push({
 type: 'photo',
 id: getString(subMedia.id),
 url: uri,
 width: getNumber(subImage.width) ?? undefined,
 height: getNumber(subImage.height) ?? undefined
 });
 }
 }
 }
 }
 }
 }
 }

 // Deduplicate media by id (prefer first occurrence which may have better resolution)
 const seen = new Set<string>();
 const dedupedMedia = media.filter((entry) => {
 const key = entry.id ?? entry.url;
 if (!key || seen.has(key)) return false;
 seen.add(key);
 return true;
 });

 // ── Metrics ──
 let reactions: number | null = null;
 let comments: number | null = null;
 let shares: number | null = null;

 // Strategy 1: Direct feedback fields on the story node
 const feedback = asRecord(node.feedback);
 if (feedback) {
 // Check reaction_count.count (newer format)
 const reactionCount = asRecord(feedback.reaction_count);
 if (reactionCount) {
 reactions = getNumber(reactionCount.count);
 }

 // Fallback: reaction_summary
 if (reactions === null) {
 const reactionSummary = asRecord(feedback.reaction_summary);
 if (reactionSummary) {
 reactions = getNumber(reactionSummary.count) ?? getNumber(reactionSummary.total_count);
 }
 }

 // Comments: check comment_rendering_instance first (newer format)
 const commentRendering = asRecord(feedback.comment_rendering_instance);
 if (commentRendering) {
 const commentsNode = asRecord(commentRendering.comments);
 if (commentsNode) {
 comments = getNumber(commentsNode.total_count);
 }
 }

 // Fallback: direct comment count
 if (comments === null) {
 comments = getNumber(feedback.total_comment_count) ?? getNumber(feedback.comment_count);
 }

 // Shares: check share_count.count (newer format)
 const shareCount = asRecord(feedback.share_count);
 if (shareCount) {
 shares = getNumber(shareCount.count);
 }

 // Fallback: direct share count
 if (shares === null) {
 shares = getNumber(feedback.share_count);
 }
 }

 // Strategy 2: Check comet_sections.feedback for UFI summary metrics
 if (cometSections) {
 const feedbackSection = asRecord(cometSections.feedback);
 if (feedbackSection && postId) {
 // Path A: feedbackSection → story_ufi_container → story → feedback_context → feedback_target_with_context
 // (feed/listing page structure)
 const ufiContainer = asRecord(feedbackSection.story_ufi_container);
 if (ufiContainer) {
 const ufiStory = asRecord(ufiContainer.story);
 if (ufiStory) {
 const feedbackContext = asRecord(ufiStory.feedback_context);
 const feedbackTarget = asRecord(feedbackContext?.feedback_target_with_context);
 if (feedbackTarget) {
 if (reactions === null) {
 const rc = asRecord(feedbackTarget.reaction_count);
 if (rc) reactions = getNumber(rc.count);
 }
 if (comments === null) {
 const cri = asRecord(feedbackTarget.comment_rendering_instance);
 if (cri) {
 const cn = asRecord(cri.comments);
 if (cn) comments = getNumber(cn.total_count);
 }
 if (comments === null) {
 comments = getNumber(feedbackTarget.total_comment_count);
 }
 }
 if (shares === null) {
 const sc = asRecord(feedbackTarget.share_count);
 if (sc) shares = getNumber(sc.count);
 }

 // Nested UFI renderer: feedback_target_with_context.comet_ufi_summary_and_actions_renderer.feedback
 const targetUfi = asRecord(feedbackTarget.comet_ufi_summary_and_actions_renderer);
 if (targetUfi) {
 const targetUfiFeedback = asRecord(targetUfi.feedback);
 if (targetUfiFeedback) {
 if (reactions === null) {
 const turc = asRecord(targetUfiFeedback.reaction_count);
 if (turc) reactions = getNumber(turc.count);
 if (reactions === null) {
 reactions = getNumber(targetUfiFeedback.i18n_reaction_count);
 }
 }
 if (comments === null) {
 const tucri = asRecord(targetUfiFeedback.comment_rendering_instance);
 if (tucri) {
 const tucn = asRecord(tucri.comments);
 if (tucn) comments = getNumber(tucn.total_count);
 }
 }
 if (shares === null) {
 const tusc = asRecord(targetUfiFeedback.share_count);
 if (tusc) shares = getNumber(tusc.count);
 if (shares === null) {
 shares = getNumber(targetUfiFeedback.i18n_share_count);
 }
 }
 // Also check comments_count_summary_renderer.feedback
 const csr = asRecord(targetUfiFeedback.comments_count_summary_renderer);
 if (csr && comments === null) {
 const csrFeedback = asRecord(csr.feedback);
 if (csrFeedback) {
 const csrCri = asRecord(csrFeedback.comment_rendering_instance);
 if (csrCri) {
 const csrCn = asRecord(csrCri.comments);
 if (csrCn) comments = getNumber(csrCn.total_count);
 }
 }
 }
 }
 }
 }
 } // closes if (ufiStory)
 } // closes if (ufiContainer) — Path A done

 // Path B: feedbackSection → story → story_ufi_container → story → feedback_context → feedback_target_with_context
 // (detail page has an extra "story" layer wrapping the UFI container)
 const feedbackStory = asRecord(feedbackSection.story);
 if (feedbackStory) {
 // Try direct feedback on story
 const storyFeedback = asRecord(feedbackStory.feedback);
 if (storyFeedback) {
 if (reactions === null) {
 const rc = asRecord(storyFeedback.reaction_count);
 if (rc) reactions = getNumber(rc.count);
 }
 if (comments === null) {
 const cri = asRecord(storyFeedback.comment_rendering_instance);
 if (cri) {
 const cn = asRecord(cri.comments);
 if (cn) comments = getNumber(cn.total_count);
 }
 if (comments === null) {
 comments = getNumber(storyFeedback.total_comment_count);
 }
 }
 if (shares === null) {
 const sc = asRecord(storyFeedback.share_count);
 if (sc) shares = getNumber(sc.count);
 }
 }

 // Nested UFI container via story
 const nestedUfiContainer = asRecord(feedbackStory.story_ufi_container);
 if (nestedUfiContainer) {
 const nestedUfiStory = asRecord(nestedUfiContainer.story);
 if (nestedUfiStory) {
 const nestedContext = asRecord(nestedUfiStory.feedback_context);
 const nestedTarget = asRecord(nestedContext?.feedback_target_with_context);
 if (nestedTarget) {
 if (reactions === null) {
 const rc = asRecord(nestedTarget.reaction_count);
 if (rc) reactions = getNumber(rc.count);
 }
 if (comments === null) {
 const cri = asRecord(nestedTarget.comment_rendering_instance);
 if (cri) {
 const cn = asRecord(cri.comments);
 if (cn) comments = getNumber(cn.total_count);
 }
 }
 if (shares === null) {
 const sc = asRecord(nestedTarget.share_count);
 if (sc) shares = getNumber(sc.count);
 }

 // Also check UFI renderer on nested target
 const nestedTargetUfi = asRecord(nestedTarget.comet_ufi_summary_and_actions_renderer);
 if (nestedTargetUfi) {
 const nestedTargetUfiFeedback = asRecord(nestedTargetUfi.feedback);
 if (nestedTargetUfiFeedback) {
 if (reactions === null) {
 const nrc = asRecord(nestedTargetUfiFeedback.reaction_count);
 if (nrc) reactions = getNumber(nrc.count);
 if (reactions === null) {
 reactions = getNumber(nestedTargetUfiFeedback.i18n_reaction_count);
 }
 }
 if (comments === null) {
 const ncri = asRecord(nestedTargetUfiFeedback.comment_rendering_instance);
 if (ncri) {
 const ncn = asRecord(ncri.comments);
 if (ncn) comments = getNumber(ncn.total_count);
 }
 }
 if (shares === null) {
 const nsc = asRecord(nestedTargetUfiFeedback.share_count);
 if (nsc) shares = getNumber(nsc.count);
 if (shares === null) {
 shares = getNumber(nestedTargetUfiFeedback.i18n_share_count);
 }
 }
 }
 }
 }
 }
 }
 } // end Path B (if feedbackStory)
 } // end if (feedbackSection && postId)
 } // end Strategy 2

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
 // Check comet_sections.timestamp first (newer format)
 let createdAtNum: number | null = null;
 if (cometSections) {
 const timestampSection = asRecord(cometSections.timestamp);
 if (timestampSection) {
 const tsStory = asRecord(timestampSection.story);
 if (tsStory) {
 createdAtNum = getNumber(tsStory.creation_time);
 }
 }
 }
 if (createdAtNum === null) {
 createdAtNum = getNumber(node.creation_time) ?? getNumber(node.created_time);
 }
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

/**
 * Decode a base64 Facebook feedback ID to extract the post_id.
 * Format: "feedback:POST_ID" (base64-encoded)
 * Returns the post_id string, or null if decoding fails.
 */
function decodeFeedbackIdToPostId(feedbackId: string): string | null {
 try {
 const decoded = Buffer.from(feedbackId, 'base64').toString('utf-8');
 const match = decoded.match(/^feedback:(\d+)$/);
 return match ? match[1] : null;
 } catch {
 return null;
 }
}

/**
 * Extract metrics from a standalone Feedback node.
 * Handles two structures:
 * 1. Direct fields: feedback.reaction_count, feedback.share_count, etc.
 * 2. UFI wrapper: feedback.comet_ufi_summary_and_actions_renderer.feedback.{reaction_count, share_count, ...}
 */
function extractMetricsFromFeedbackNode(fb: Record<string, unknown>): { reactions: number | null; comments: number | null; shares: number | null } {
 let reactions: number | null = null;
 let comments: number | null = null;
 let shares: number | null = null;

 // Strategy 1: Direct fields on the Feedback node
 const rc = asRecord(fb.reaction_count);
 if (rc) reactions = getNumber(rc.count);
 if (reactions === null) {
 const rs = asRecord(fb.reaction_summary);
 if (rs) reactions = getNumber(rs.count) ?? getNumber(rs.total_count);
 }

 const cri = asRecord(fb.comment_rendering_instance);
 if (cri) {
 const cn = asRecord(cri.comments);
 if (cn) comments = getNumber(cn.total_count);
 }
 if (comments === null) {
 comments = getNumber(fb.total_comment_count) ?? getNumber(fb.comment_count);
 }

 const sc = asRecord(fb.share_count);
 if (sc) shares = getNumber(sc.count);
 if (shares === null) {
 const rawShare = fb.share_count;
 shares = typeof rawShare === 'number' ? rawShare : null;
 }

 // Strategy 2: UFI wrapper — metrics inside comet_ufi_summary_and_actions_renderer.feedback
 const ufiRenderer = asRecord(fb.comet_ufi_summary_and_actions_renderer);
 if (ufiRenderer) {
 const ufiFeedback = asRecord(ufiRenderer.feedback);
 if (ufiFeedback) {
 if (reactions === null) {
 const ufiRC = asRecord(ufiFeedback.reaction_count);
 if (ufiRC) reactions = getNumber(ufiRC.count);
 if (reactions === null) {
 reactions = getNumber(ufiFeedback.i18n_reaction_count);
 }
 }
 if (shares === null) {
 const ufiSC = asRecord(ufiFeedback.share_count);
 if (ufiSC) shares = getNumber(ufiSC.count);
 if (shares === null) {
 shares = getNumber(ufiFeedback.i18n_share_count);
 }
 }
 if (comments === null) {
 const ufiCri = asRecord(ufiFeedback.comment_rendering_instance);
 if (ufiCri) {
 const ufiCn = asRecord(ufiCri.comments);
 if (ufiCn) comments = getNumber(ufiCn.total_count);
 }
 if (comments === null) {
 comments = getNumber(ufiFeedback.total_comment_count) ?? getNumber(ufiFeedback.i18n_comment_count);
 }
 }
 }
 }

 // Strategy 3: Also check comments_count_summary_renderer.feedback
 const commentsRenderer = asRecord(fb.comments_count_summary_renderer);
 if (commentsRenderer) {
 const crFeedback = asRecord(commentsRenderer.feedback);
 if (crFeedback && comments === null) {
 const crCri = asRecord(crFeedback.comment_rendering_instance);
 if (crCri) {
 const crCn = asRecord(crCri.comments);
 if (crCn) comments = getNumber(crCn.total_count);
 }
 if (comments === null) {
 comments = getNumber(crFeedback.total_comment_count) ?? getNumber(crFeedback.i18n_comment_count);
 }
 }
 }

 return { reactions, comments, shares };
}

export function parseGroupFeedFragments(fragments: GraphQLFragment[]): GroupPost[] {
 const posts = new Map<string, GroupPost>();

 // Phase 1: Collect standalone Feedback nodes with metrics, indexed by post_id
 // Feedback IDs are base64-encoded "feedback:POST_ID", so we decode to get the post_id
 const feedbackByPostId = new Map<string, { reactions: number | null; comments: number | null; shares: number | null }>();
 for (const fragment of fragments) {
 for (const payload of fragment.fragments) {
 deepVisit(payload, (node) => {
 if (node.__typename === 'Feedback' && typeof node.id === 'string') {
 // Check for metrics either directly, via comment_rendering_instance, or inside UFI renderer
 const hasDirectMetrics = typeof node.total_comment_count === 'number' ||
 typeof node.comment_count === 'number' ||
 (typeof node.reaction_count === 'object' && node.reaction_count !== null) ||
 (typeof node.reaction_summary === 'object' && node.reaction_summary !== null);
 const hasCriMetrics = typeof node.comment_rendering_instance === 'object' && node.comment_rendering_instance !== null;
 const hasUfiMetrics = typeof node.comet_ufi_summary_and_actions_renderer === 'object' && node.comet_ufi_summary_and_actions_renderer !== null;
 if (hasDirectMetrics || hasCriMetrics || hasUfiMetrics) {
 const postId = decodeFeedbackIdToPostId(node.id);
 if (postId) {
 const metrics = extractMetricsFromFeedbackNode(node);
 // Only store if at least one metric is non-null
 if (metrics.reactions !== null || metrics.comments !== null || metrics.shares !== null) {
 feedbackByPostId.set(postId, metrics);
 }
 }
 }
 }
 });
 }
 }

 // Phase 2: Parse Story nodes and merge with Feedback data
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

 // Filter out junk/placeholder posts
 const text = post.text ?? '';
 if (/^anyone can see/i.test(text.trim())) {
 return;
 }
 if (/^anyone can find/i.test(text.trim())) {
 return;
 }

 // Merge metrics from standalone Feedback node (matched by post_id)
 if (post.metrics.reactions === null || post.metrics.comments === null || post.metrics.shares === null) {
 const fbMetrics = feedbackByPostId.get(post.postId ?? '');
 if (fbMetrics) {
 if (post.metrics.reactions === null) post.metrics.reactions = fbMetrics.reactions;
 if (post.metrics.comments === null) post.metrics.comments = fbMetrics.comments;
 if (post.metrics.shares === null) post.metrics.shares = fbMetrics.shares;
 }
 }

 // Filter out ghost posts: no text, no author, and no meaningful metrics
 // (catches both null and zero metrics since ghost posts have nothing useful)
 const isGhostPost = !post.text && !post.author.id && !post.author.name &&
 (post.metrics.reactions === 0 || post.metrics.reactions === null) &&
 (post.metrics.comments === 0 || post.metrics.comments === null) &&
 (post.metrics.shares === 0 || post.metrics.shares === null);
 if (isGhostPost) {
 return;
 }

 const existing = posts.get(dedupKey);
 const existingScore = existing ? scoreGroupPost(existing) : -1;
 const candidateScore = scoreGroupPost(post);
 // Only replace if strictly better, or if the candidate has metrics where existing doesn't
 const isStrictlyBetter = candidateScore > existingScore;
 const hasNewMetrics = existing && (
 (existing.metrics.reactions === null && post.metrics.reactions !== null) ||
 (existing.metrics.comments === null && post.metrics.comments !== null) ||
 (existing.metrics.shares === null && post.metrics.shares !== null)
 );
 if (isStrictlyBetter || hasNewMetrics || !existing) {
 posts.set(dedupKey, post);
 }
 });
 }
 }

 return Array.from(posts.values());
}

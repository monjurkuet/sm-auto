/**
 * DOM-based comment extraction for Facebook group post detail pages.
 * 
 * Facebook loads comments via SSR (initial ~10) and then via incremental
 * XHR/streaming responses that aren't captured by GraphQLCapture. This parser
 * extracts comments directly from the rendered DOM, which always reflects
 * the current page state regardless of how the data was loaded.
 */

import type { Page } from 'puppeteer-core';
import type { GroupPostComment } from '../../types/contracts';

export interface DomCommentResult {
  comments: GroupPostComment[];
  totalVisible: number;
}

/**
 * Extract comments from the rendered DOM of a group post detail page.
 * This is called AFTER scrolling has loaded comments into view.
 */
export async function extractCommentsFromDom(page: Page): Promise<DomCommentResult> {
  const rawComments = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('div[role="article"]'));
    
    return articles.map(article => {
      // Skip loading placeholders
      const loadingEl = article.querySelector('[aria-label="Loading..."]');
      if (loadingEl) return null;

      // ── Comment ID ──
      // Extract from links like ?comment_id=12345 or ?reply_comment_id=12345
      let commentId: string | null = null;
      let parentCommentId: string | null = null;
      let postId: string | null = null;
      
      const commentLink = article.querySelector('a[href*="comment_id"]');
      if (commentLink) {
        const href = commentLink.getAttribute('href') ?? '';
        const replyMatch = href.match(/reply_comment_id=(\d+)/);
        const commentMatch = href.match(/comment_id=(\d+)/);
        const postMatch = href.match(/posts\/(\d+)/);
        
        if (replyMatch) {
          commentId = replyMatch[1];
          if (commentMatch) parentCommentId = commentMatch[1];
        } else if (commentMatch) {
          commentId = commentMatch[1];
        }
        if (postMatch) postId = postMatch[1];
      }

      // Also check data-commentid attribute
      if (!commentId) {
        const dataId = article.getAttribute('data-commentid');
        if (dataId) commentId = dataId;
      }

      // ── Author ──
      let authorName: string | null = null;
      let authorId: string | null = null;
      
      // Author is typically in a link within the comment header
      const authorLinks = Array.from(article.querySelectorAll('a[role="link"]'));
      for (const link of authorLinks) {
        const span = link.querySelector('span');
        if (span) {
          const name = span.textContent?.trim();
          // Skip numeric-only texts, very short texts, and known non-author patterns
          if (name && name.length > 1 && name.length < 100 && 
              !/^\d+$/.test(name) && 
              !/^(Like|React|Reply|Comment|Share|more|View)/i.test(name)) {
            authorName = name;
            const href = link.getAttribute('href') ?? '';
            const profileMatch = href.match(/facebook\.com\/(?:profile\.php\?id=([^&]+)|people\/[^/]+\/(\d+)|([^/?&]+))/);
            if (profileMatch) {
              authorId = profileMatch[1] ?? profileMatch[2] ?? profileMatch[3] ?? null;
            }
            break;
          }
        }
      }

      // ── Comment text ──
      let text: string | null = null;
      
      // Primary: data-ad-preview="message" (most reliable for post/comment body)
      const messageEl = article.querySelector('[data-ad-preview="message"]');
      if (messageEl) {
        text = messageEl.textContent?.trim() ?? null;
      }
      
      // Fallback: dir="auto" divs (Facebook uses these for text content)
      if (!text) {
        const dirAutos = Array.from(article.querySelectorAll('div[dir="auto"]'));
        for (const dirAuto of dirAutos) {
          const content = dirAuto.textContent?.trim() ?? '';
          // Only take if it has substantial text and isn't just a button label
          if (content.length > 3 && !/^(Like|React|Reply|Comment|Share)$/i.test(content)) {
            text = content;
            break;
          }
        }
      }

      // ── Timestamp ──
      // Facebook comments show relative time ("2d", "5h") in links
      // There's no reliable absolute timestamp in the DOM
      let relativeTime: string | null = null;
      const timeLink = article.querySelector('a[href*="comment_id"]');
      if (timeLink) {
        // The timestamp text is usually the last meaningful text node
        const linkText = timeLink.textContent?.trim() ?? '';
        // Match patterns like "2d", "5h", "1w", "3m", "Just now"
        const timeMatch = linkText.match(/(\d+[mhdw]|Just now)/i);
        if (timeMatch) {
          relativeTime = timeMatch[1];
        } else if (linkText.length < 10 && /\d/.test(linkText)) {
          // Fallback: short text with a number is likely a timestamp
          relativeTime = linkText;
        }
      }

      // ── Reactions ──
      let reactions: number | null = null;
      // Look for reaction count in aria-labels
      const reactionElements = Array.from(article.querySelectorAll('[aria-label]'));
      for (const el of reactionElements) {
        const label = el.getAttribute('aria-label') ?? '';
        // Patterns: "2 reactions", "1 reaction", "5 Likes"
        const reactionMatch = label.match(/^(\d+)\s+(?:reactions?|likes?)/i);
        if (reactionMatch) {
          reactions = parseInt(reactionMatch[1], 10);
          break;
        }
      }

      // ── Reply count ──
      let replies: number | null = null;
      const replyButtons = Array.from(article.querySelectorAll('div[role="button"], span[role="button"]'));
      for (const btn of replyButtons) {
        const text = btn.textContent?.trim() ?? '';
        // "3 Replies", "1 Reply", "View 5 replies"
        const replyMatch = text.match(/(\d+)\s+repl/i);
        if (replyMatch) {
          replies = parseInt(replyMatch[1], 10);
          break;
        }
      }

      return {
        commentId,
        parentCommentId,
        postId,
        authorName,
        authorId,
        text,
        relativeTime,
        reactions,
        replies,
      };
    }).filter((c): c is NonNullable<typeof c> => c !== null && c.commentId !== null);
  });

  // Convert to GroupPostComment format with composite IDs, deduplicating by ID
  const seenIds = new Set<string>();
  const comments: GroupPostComment[] = rawComments
    .filter(c => c.commentId)
    .filter(c => {
      // Deduplicate: Facebook renders comments in multiple DOM locations (main + sidebar)
      const fullId = c.postId ? `${c.postId}_${c.commentId}` : c.commentId!;
      if (seenIds.has(fullId)) return false;
      seenIds.add(fullId);
      return true;
    })
    .map(c => {
      // Build the full composite ID: POSTID_COMMENTID
      const fullId = c.postId ? `${c.postId}_${c.commentId}` : c.commentId!;
      const fullParentId = c.parentCommentId && c.postId 
        ? `${c.postId}_${c.parentCommentId}` 
        : (c.parentCommentId ?? null);

      return {
        id: fullId,
        parentId: fullParentId,
        author: {
          id: c.authorId,
          name: c.authorName,
        },
        text: c.text,
        // DOM only gives relative time, not absolute timestamps
        createdAt: null,
        metrics: {
          reactions: c.reactions,
          replies: c.replies,
        },
      };
    });

  return {
    comments,
    totalVisible: rawComments.length,
  };
}

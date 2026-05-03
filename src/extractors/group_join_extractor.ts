import type { Page } from 'puppeteer-core';

import type { ExtractorResult, GroupJoinResult, MembershipStatus } from '../types/contracts';
import type { ScraperContext } from '../core/scraper_context';
import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { enableRequestFiltering } from '../browser/request_filter';
import { sleep } from '../core/sleep';

const GROUP_SIGNAL_WAIT_MS = 15_000;

async function waitForGroupSignals(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, GROUP_SIGNAL_WAIT_MS);

  while (Date.now() < deadline) {
    const hasContent = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const hasMembers = Array.from(document.querySelectorAll('span')).some(s =>
        /members/i.test(s.textContent ?? '')
      );
      return !!h1 || hasMembers;
    });

    if (hasContent) return;

    await sleep(250);
  }

  throw new Error('Timed out waiting for group page signals');
}

/**
 * Detect the current membership status by examining the DOM.
 */
async function detectMembershipStatus(page: Page): Promise<MembershipStatus> {
  return page.evaluate(() => {
    const allText = document.body.innerText ?? '';

    // Check for "declined" status first (most specific)
    if (/your\s+request\s+was\s+declined|declined\s+your\s+request|membership\s+declined/i.test(allText)) {
      return 'declined' as MembershipStatus;
    }

 // Check for pending status
 if (/membership\s+(is\s+)?pending|you'?ve?\s+requested\s+to\s+join|request\s+(is\s+)?pending|request\s+sent/i.test(allText)) {
 return 'pending' as MembershipStatus;
 }

    // Check for join / request-to-join button (means not joined)
    const buttons = Array.from(document.querySelectorAll('div[role="button"], span[role="button"]'));
    const hasJoinButton = buttons.some(btn =>
      /join\s+group|request\s+to\s+join/i.test(btn.textContent ?? '')
    );
    if (hasJoinButton) {
      return 'not_joined' as MembershipStatus;
    }

    // Check for indicators that the user is already a member:
    // - "Joined" button/label, or a "Write post" / composing area visible
    const hasJoinedIndicator = buttons.some(btn =>
      /^joined$/i.test(btn.textContent?.trim() ?? '')
    );
    const hasWritePost = Array.from(document.querySelectorAll('div[role="textbox"], div[contenteditable="true"]')).length > 0;
    const hasInviteButton = buttons.some(btn =>
      /invite/i.test(btn.textContent ?? '')
    );

    if (hasJoinedIndicator || hasWritePost || hasInviteButton) {
      return 'joined' as MembershipStatus;
    }

    return 'unknown' as MembershipStatus;
  });
}

/**
 * Check if a question/dialog appeared after clicking join and dismiss it.
 * Returns true if questions were detected (meaning we should skip).
 */
async function handleQuestionDialog(page: Page): Promise<boolean> {
  const hasQuestions = await page.evaluate(() => {
    // After clicking join, a dialog may appear with textareas or inputs for questions
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return false;

    const textareas = dialog.querySelectorAll('textarea');
    const inputs = dialog.querySelectorAll('input[type="text"], input[type="text"], input:not([type])');
    return textareas.length > 0 || inputs.length > 0;
  });

  if (hasQuestions) {
    // Dismiss the dialog by pressing Escape
    await page.keyboard.press('Escape').catch(() => undefined);
    await sleep(500);
    return true;
  }

  return false;
}

/**
 * Attempt to click the join/request-to-join button.
 * Returns the action taken.
 */
async function clickJoinButton(page: Page): Promise<'joined' | 'requested' | 'skipped_questions' | 'none'> {
  // Find and click the join button
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('div[role="button"], span[role="button"]'));
    const joinBtn = buttons.find(btn =>
      /join\s+group|request\s+to\s+join/i.test(btn.textContent ?? '')
    );
    if (joinBtn && joinBtn instanceof HTMLElement) {
      joinBtn.click();
      return true;
    }
    return false;
  });

  if (!clicked) {
    return 'none';
  }

  // Wait for potential dialog or status change
  await sleep(2500);

  // Check if a question dialog appeared
  const hasQuestions = await handleQuestionDialog(page);
  if (hasQuestions) {
    return 'skipped_questions';
  }

  // Determine if it was a "Join group" (public) or "Request to join" (private)
  const actionType = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('div[role="button"], span[role="button"]'));
    // After joining, the button may change to "Joined" or disappear
    const joinButtonStillVisible = buttons.some(btn =>
      /join\s+group|request\s+to\s+join/i.test(btn.textContent ?? '')
    );

    // Check for pending status text that appeared after click
    const allText = document.body.innerText ?? '';
    if (/membership\s+pending|you'?ve?\s+requested\s+to\s+join|request\s+pending|request\s+sent/i.test(allText)) {
      return 'requested' as const;
    }

 // If button disappeared or changed to "Joined", it was a direct join
 if (!joinButtonStillVisible) {
 return 'joined' as const;
 }

 // Button still visible — likely a private group where join didn't take effect
 // or needs more time. Don't claim 'joined' if the button is still there.
 return 'none' as const;
  });

  return actionType;
}

export async function extractGroupJoin(
  context: ScraperContext,
  groupUrl: string
): Promise<ExtractorResult<GroupJoinResult>> {
  const chrome = new ChromeClient(context.chromePort);
  const browser = await chrome.connect();
  const session = new PageSession(browser, context.timeoutMs);

  try {
    return await session.withPage(async (page) => {
      const disableRequestFiltering = await enableRequestFiltering(page, ['image', 'media', 'font']);

      try {
        // Navigate to group page
        await page.goto(groupUrl, { waitUntil: 'domcontentloaded' });
        await waitForGroupSignals(page, context.timeoutMs);
        await sleep(1500);

        // Detect initial membership status
        const previousStatus = await detectMembershipStatus(page);

 let actionTaken: GroupJoinResult['actionTaken'] = 'none';

 // Only attempt to join if not already a member and not pending
 // 'unknown' is treated like 'not_joined' — the page didn't show clear membership
 // indicators, so we should try to find and click the join button.
 if (previousStatus === 'not_joined' || previousStatus === 'unknown') {
 actionTaken = await clickJoinButton(page);
 } else if (previousStatus === 'declined') {
 // Don't attempt to re-join declined groups
 actionTaken = 'none';
 }
 // For 'joined', 'pending' — take no action

        // Wait a moment for any DOM updates after action
        if (actionTaken !== 'none') {
          await sleep(2000);
        }

        // Re-detect membership status after action
        const membershipStatus = await detectMembershipStatus(page);

        const result: GroupJoinResult = {
          url: groupUrl,
          membershipStatus,
          previousStatus: previousStatus !== membershipStatus ? previousStatus : previousStatus,
          actionTaken,
          scrapedAt: new Date().toISOString()
        };

        return {
          data: result,
          artifacts: {
            previousStatus,
            finalStatus: membershipStatus,
            actionTaken
          }
        };
      } finally {
        await disableRequestFiltering().catch(() => undefined);
      }
    });
  } finally {
    await chrome.disconnect();
  }
}

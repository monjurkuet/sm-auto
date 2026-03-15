import type { Page } from 'puppeteer-core';

import { sleep } from '../core/sleep';
import { buildTransparencyUrl } from '../routes/facebook_routes';

export interface TransparencyExtraction {
  creationDate: string | null;
  history: string[];
}

export async function extractPageTransparency(page: Page, pageUrl: string): Promise<TransparencyExtraction> {
  await page.goto(buildTransparencyUrl(pageUrl), { waitUntil: 'networkidle2' });
  await sleep(2_000);

  return page.evaluate(() => {
    const text = Array.from(document.querySelectorAll('span'))
      .map((element) => element.textContent?.trim() ?? '')
      .filter(Boolean);

    return {
      creationDate: text.find((entry) => /page created/i.test(entry)) ?? null,
      history: text
    };
  });
}

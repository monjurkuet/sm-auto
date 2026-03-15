import type { Browser, Page } from 'puppeteer-core';

export class PageSession {
  constructor(private readonly browser: Browser, private readonly timeoutMs: number) {}

  async withPage<T>(run: (page: Page) => Promise<T>): Promise<T> {
    const page = await this.browser.newPage();
    page.setDefaultTimeout(this.timeoutMs);
    page.setDefaultNavigationTimeout(this.timeoutMs);

    try {
      return await run(page);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}

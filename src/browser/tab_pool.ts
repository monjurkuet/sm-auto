import type { Browser, Page } from 'puppeteer-core';

export class TabPool {
  private pages: Page[] = [];

  constructor(
    private readonly browser: Browser,
    private readonly timeoutMs: number
  ) {}

  async acquire(): Promise<Page> {
    const page = this.pages.pop() ?? (await this.browser.newPage());
    page.setDefaultTimeout(this.timeoutMs);
    page.setDefaultNavigationTimeout(this.timeoutMs);
    return page;
  }

  async release(page: Page): Promise<void> {
    if (page.isClosed()) {
      return;
    }

    await page.goto('about:blank').catch(() => undefined);
    this.pages.push(page);
  }

  async drain(): Promise<void> {
    await Promise.all(this.pages.map((page) => page.close().catch(() => undefined)));
    this.pages = [];
  }
}

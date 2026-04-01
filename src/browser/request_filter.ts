import type { HTTPRequest, Page } from 'puppeteer-core';

export async function enableRequestFiltering(
  page: Page,
  blockedResourceTypes: Iterable<string>
): Promise<() => Promise<void>> {
  const blockedTypes = new Set(blockedResourceTypes);
  await page.setRequestInterception(true);

  const handler = async (request: HTTPRequest): Promise<void> => {
    if (blockedTypes.has(request.resourceType())) {
      await request.abort().catch(() => undefined);
      return;
    }

    await request.continue().catch(() => undefined);
  };

  page.on('request', handler);

  return async () => {
    page.off('request', handler);
    await page.setRequestInterception(false).catch(() => undefined);
  };
}

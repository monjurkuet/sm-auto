export function normalizeFacebookPageUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function buildDirectoryContactUrl(pageUrl: string): string {
  return `${normalizeFacebookPageUrl(pageUrl)}/directory_contact_info`;
}

export function buildDirectoryBasicInfoUrl(pageUrl: string): string {
  return `${normalizeFacebookPageUrl(pageUrl)}/directory_basic_info`;
}

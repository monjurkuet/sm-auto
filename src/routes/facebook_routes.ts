export function normalizeFacebookPageUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function buildAboutContactUrl(pageUrl: string): string {
  return `${normalizeFacebookPageUrl(pageUrl)}/about_contact_and_basic_info`;
}

export function buildTransparencyUrl(pageUrl: string): string {
  return `${normalizeFacebookPageUrl(pageUrl)}/about_profile_transparency`;
}

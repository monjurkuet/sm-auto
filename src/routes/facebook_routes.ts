export function normalizeFacebookPageUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function buildDirectoryContactUrl(pageUrl: string): string {
  return `${normalizeFacebookPageUrl(pageUrl)}/directory_contact_info`;
}

export function buildDirectoryBasicInfoUrl(pageUrl: string): string {
 return `${normalizeFacebookPageUrl(pageUrl)}/directory_basic_info`;
}

export function buildGroupUrl(groupId: string): string {
 return `https://www.facebook.com/groups/${encodeURIComponent(groupId)}/`;
}

export function buildGroupPostUrl(groupId: string, postId: string): string {
 return `https://www.facebook.com/groups/${encodeURIComponent(groupId)}/posts/${encodeURIComponent(postId)}/`;
}

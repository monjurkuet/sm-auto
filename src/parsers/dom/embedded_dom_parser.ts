const PROFILE_TILE_SECTIONS_MARKER = '"profile_tile_sections":';

export function extractBalancedJsonSegment(source: string, marker: string): string | null {
  const startIdx = source.indexOf(marker);
  if (startIdx === -1) {
    return null;
  }

  let braceCount = 0;
  let jsonEnd = -1;
  let inString = false;
  let escaped = false;
  let started = false;

  for (let index = startIdx + marker.length - 1; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      if (!started) {
        started = true;
        braceCount = 1;
      } else {
        braceCount += 1;
      }
      continue;
    }

    if (char === '}') {
      braceCount -= 1;
      if (started && braceCount === 0) {
        jsonEnd = index + 1;
        break;
      }
    }
  }

  if (jsonEnd === -1) {
    return null;
  }

  return source.slice(startIdx, jsonEnd);
}

/**
 * Capture embedded profile tile data from the current page HTML.
 * Facebook embeds page profile data under the profile_tile_sections key.
 */
export async function captureEmbeddedProfileData(page: import('puppeteer-core').Page): Promise<string> {
  const html = await page.content();
  return extractBalancedJsonSegment(html, PROFILE_TILE_SECTIONS_MARKER) ?? '';
}

/**
 * Extract item_subtitle.text.text values from embedded profile tile JSON.
 */
export function extractProfileTileItems(html: string): string[] {
  const jsonStr = extractBalancedJsonSegment(html, PROFILE_TILE_SECTIONS_MARKER);
  if (!jsonStr) {
    return [];
  }

  const itemSubtitleRegex = /"item_subtitle"\s*:\s*\{\s*"text"\s*:\s*\{\s*"text"\s*:\s*"([^"]+)"/g;
  const results: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = itemSubtitleRegex.exec(jsonStr)) !== null) {
    results.push(match[1]);
  }

  return results;
}

/**
 * Extract location from embedded profile_tile_sections data.
 * This is the primary source for location on Facebook page profiles.
 */
export function extractLocationFromEmbeddedData(itemSubtitles: string[]): string | null {
  for (const text of itemSubtitles) {
    if (text.includes('% recommend')) {
      continue;
    }
    if (text === 'Closed now' || text === 'Open now') {
      continue;
    }
    if (/^\d{5,6}$/.test(text)) {
      continue;
    }
    if (/^\d+\s+(people|Reviews?)/.test(text)) {
      continue;
    }
    if (/^Open\s*/.test(text) || /^Closed\s*/.test(text)) {
      continue;
    }

    if (text.includes(',')) {
      return text
        .replace(/\s*\+\s*\d+$/, '')
        .replace(/\s*·\s*.+$/, '')
        .replace(/\\u00b7/g, '·')
        .trim();
    }
  }

  return null;
}

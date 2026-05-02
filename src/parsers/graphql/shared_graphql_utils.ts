export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function deepVisit(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  const node = value as Record<string, unknown>;
  visit(node);

  for (const child of Object.values(node)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        deepVisit(item, visit);
      }
      continue;
    }
    deepVisit(child, visit);
  }
}

export function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function getNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/**
 * Parse i18n-formatted count strings (e.g., "42", "1,234", "3K") into numbers.
 * These appear on Feedback nodes as `i18n_comment_count`, `i18n_share_count`, etc.
 * Removes commas, spaces, and non-numeric prefixes before parsing.
 */
export function parseI18nCount(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // Remove commas, spaces, and non-numeric prefixes
    const cleaned = value.replace(/[,\s]/g, '').replace(/^[^\d]*/, '');
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? null : num;
  }
  return null;
}

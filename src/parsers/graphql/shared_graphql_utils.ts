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

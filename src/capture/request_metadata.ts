import type { RequestMetadata } from '../types/contracts';

const REDACTED_FIELDS = new Set(['fb_dtsg', 'lsd', '__user', 'av', 'jazoest']);

export function parseRequestMetadata(postData: string | undefined): RequestMetadata {
  if (!postData) {
    return { rawFields: {} };
  }

  const params = new URLSearchParams(postData);
  const rawFields: Record<string, string> = {};

  for (const [key, value] of params.entries()) {
    rawFields[key] = REDACTED_FIELDS.has(key) ? '[redacted]' : value;
  }

  let variables: unknown;
  const rawVariables = params.get('variables');
  if (rawVariables) {
    try {
      variables = JSON.parse(rawVariables);
    } catch {
      variables = rawVariables;
    }
  }

  return {
    friendlyName: params.get('fb_api_req_friendly_name') ?? undefined,
    docId: params.get('doc_id') ?? undefined,
    variables,
    rawFields
  };
}

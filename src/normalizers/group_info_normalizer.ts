import type { GroupInfoResult, DataProvenance } from '../types/contracts';

interface GroupInfoInput {
  groupId: string | null;
  url: string;
  name: string | null;
  vanitySlug: string | null;
  privacyType: string | null;
  groupType: string | null;
  memberCount: number | null;
  description: string | null;
  coverPhotoUrl: string | null;
  admins: Array<{ id: string | null; name: string | null; adminType: string | null }>;
  rules: string[];
  tags: string[];
  provenance?: Record<string, DataProvenance>;
}

export function normalizeGroupInfo(input: GroupInfoInput): GroupInfoResult {
  return {
    groupId: input.groupId,
    url: input.url,
    name: input.name,
    vanitySlug: input.vanitySlug,
    privacyType: input.privacyType,
    groupType: input.groupType,
    memberCount: input.memberCount,
    description: input.description,
    coverPhotoUrl: input.coverPhotoUrl,
    admins: input.admins,
    rules: input.rules,
    tags: input.tags,
    scrapedAt: new Date().toISOString(),
    provenance: input.provenance,
  };
}

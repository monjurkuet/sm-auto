import type { GroupAdmin } from '../../types/contracts';
import { deepVisit, asRecord, getString } from '../graphql/shared_graphql_utils';
import { extractScheduledServerJsResults } from './marketplace_embedded_parser';

/**
 * Parse group admins, rules, tags, groupType, and coverPhotoUrl from
 * the embedded data (data-sjs JSON) of a Facebook group page.
 *
 * Facebook embeds group metadata in __bbox.result objects inside
 * <script type="application/json" data-sjs> tags.  We walk the tree
 * with deepVisit and look for known __typename / key patterns.
 */

// ── Admins ──────────────────────────────────────────────────────────

interface AdminAccumulator {
  id: string | null;
  name: string | null;
  adminType: string | null;
}

function extractAdminsFromNode(node: Record<string, unknown>): AdminAccumulator | null {
  const typename = getString(node.__typename);

  // User nodes that carry a group-membership role
  if (typename === 'User' || typename === 'Viewer') {
 const role =
 getString(asRecord(node.group_membership)?.role) ??
 getString(node.role) ??
 getString(node.membership_type);

    // Only keep if there is an explicit admin/moderator role marker
    if (role && /admin|moderator/i.test(role)) {
      return {
        id: getString(node.id),
        name: getString(node.name),
        adminType: role
      };
    }
  }

  // Some embedded payloads nest admin info under an admin_list key
  if (Array.isArray(node.admin_list) || Array.isArray(node.admins)) {
    // Handled by the caller in the deepVisit walk — individual items
    // will be visited separately. No inline extraction needed here.
  }

  // Profile-like objects that appear in GroupCometAboutApp admin sections
  if (typename === 'Profile' || typename === 'Page') {
    const role = getString(node.role) ?? getString(node.membership_type);
    if (role && /admin|moderator/i.test(role)) {
      return {
        id: getString(node.id),
        name: getString(node.name) ?? getString(node.title),
        adminType: role
      };
    }
  }

  return null;
}

// ── Rules ───────────────────────────────────────────────────────────

function extractRuleFromNode(node: Record<string, unknown>): string | null {
  // Direct rule_text field
  const ruleText = getString(node.rule_text);
  if (ruleText) return ruleText;

  // GroupRule __typename
  if (getString(node.__typename) === 'GroupRule') {
    return getString(node.text) ?? getString(node.rule_text) ?? getString(node.description);
  }

  return null;
}

// ── Tags ────────────────────────────────────────────────────────────

function extractTagFromNode(node: Record<string, unknown>): string | null {
  // GroupTag / GroupInterest __typename
  const typename = getString(node.__typename);
  if (typename === 'GroupTag' || typename === 'GroupInterest' || typename === 'GroupTopicTag') {
    return getString(node.name) ?? getString(node.text) ?? getString(node.label);
  }

  // Nodes with an explicit tag_type or topic field
  const tagType = getString(node.tag_type) ?? getString(node.topic);
  if (tagType) {
    return getString(node.name) ?? getString(node.text) ?? tagType;
  }

  return null;
}

// ── Group type & cover photo ────────────────────────────────────────

function extractGroupTypeFromNode(node: Record<string, unknown>): string | null {
  const typename = getString(node.__typename);

  if (typename === 'Group' || typename === 'FacebookGroup') {
    return getString(node.group_type) ?? getString(node.type);
  }

  // Some payloads nest it under a group sub-object
  const group = asRecord(node.group);
  if (group) {
    const gt = getString(group.group_type) ?? getString(group.type);
    if (gt) return gt;
  }

  return null;
}

function extractCoverPhotoFromNode(node: Record<string, unknown>): string | null {
  const typename = getString(node.__typename);

 if (typename === 'Group' || typename === 'FacebookGroup') {
 // Direct uri via asRecord
 const cpRec = asRecord(node.cover_photo);
 const uri = cpRec ? (getString(cpRec.uri) ?? getString(cpRec.url)) : null;
 if (uri) return uri;

    // Nested photo object
    const photo = asRecord(node.cover_photo);
    if (photo) {
      return getString(photo.uri) ?? getString(photo.url) ?? getString(photo.image_uri);
    }
  }

  // Some payloads put cover_photo at the top level
  const coverPhoto = asRecord(node.cover_photo);
  if (coverPhoto) {
    return getString(coverPhoto.uri) ?? getString(coverPhoto.url) ?? getString(coverPhoto.image_uri);
  }

  // Separate CoverPhoto __typename
  if (typename === 'CoverPhoto' || typename === 'GroupCoverPhoto') {
    return getString(node.uri) ?? getString(node.url) ?? getString(node.image_uri);
  }

  // photo.image which appears in some FB structures
  const image = asRecord(node.image) ?? asRecord(node.photo_image);
  if (image) {
    const uri = getString(image.uri) ?? getString(image.url);
    if (uri && /cover|photo/i.test(node.__typename as string ?? '')) return uri;
  }

  return null;
}

// ── Public API ──────────────────────────────────────────────────────

export interface GroupEmbeddedInfo {
  admins: GroupAdmin[];
  rules: string[];
  tags: string[];
  groupType: string | null;
  coverPhotoUrl: string | null;
  provenance: Record<string, 'embedded_document'>;
}

/**
 * Parse group metadata from embedded data-sjs script tags in the
 * HTML of a Facebook group page (main or /about/).
 */
export function parseGroupEmbeddedInfo(html: string): GroupEmbeddedInfo {
  const results = extractScheduledServerJsResults(html);

  const adminMap = new Map<string, GroupAdmin>();
  const ruleSet = new Set<string>();
  const tagSet = new Set<string>();
  let groupType: string | null = null;
  let coverPhotoUrl: string | null = null;

  for (const result of results) {
    deepVisit(result, (node) => {
      // ── Admins ──
      const admin = extractAdminsFromNode(node);
      if (admin) {
        const key = admin.id ?? admin.name ?? '';
        if (key && !adminMap.has(key)) {
          adminMap.set(key, admin);
        }
      }

      // Also handle inline admin arrays (e.g. node.admins = [{id, name, role}, ...])
      const adminArray = Array.isArray(node.admins)
        ? node.admins
        : Array.isArray(node.admin_list)
          ? node.admin_list
          : undefined;
      if (adminArray) {
        for (const entry of adminArray) {
          const rec = asRecord(entry);
          if (!rec) continue;
          const role =
            getString(rec.role) ??
            getString(rec.membership_type) ??
            getString(rec.admin_type);
          if (role && /admin|moderator/i.test(role)) {
            const id = getString(rec.id);
            const name = getString(rec.name) ?? getString(rec.title);
            const key = id ?? name ?? '';
            if (key && !adminMap.has(key)) {
              adminMap.set(key, { id, name, adminType: role });
            }
          }
        }
      }

      // ── Rules ──
      const rule = extractRuleFromNode(node);
      if (rule) ruleSet.add(rule);

      // Also handle rules arrays
      const rulesArray = Array.isArray(node.rules) ? node.rules : undefined;
      if (rulesArray) {
        for (const entry of rulesArray) {
          const rec = asRecord(entry);
          if (!rec) continue;
          const text =
            getString(rec.rule_text) ??
            getString(rec.text) ??
            getString(rec.description);
          if (text) ruleSet.add(text);
        }
      }

      // ── Tags ──
      const tag = extractTagFromNode(node);
      if (tag) tagSet.add(tag);

      // Also handle tags / topics arrays
      const tagsArray = Array.isArray(node.tags)
        ? node.tags
        : Array.isArray(node.topics)
          ? node.topics
          : undefined;
      if (tagsArray) {
        for (const entry of tagsArray) {
          const rec = asRecord(entry);
          if (!rec) continue;
          const text =
            getString(rec.name) ??
            getString(rec.text) ??
            getString(rec.label);
          if (text) tagSet.add(text);
        }
      }

      // ── Group type ──
      const gt = extractGroupTypeFromNode(node);
      if (gt && !groupType) groupType = gt;

      // ── Cover photo ──
      const cp = extractCoverPhotoFromNode(node);
      if (cp && !coverPhotoUrl) coverPhotoUrl = cp;
    });
  }

 // Order rules by preserving insertion order (Set preserves order)
 const rules = Array.from(ruleSet);
 const tags = Array.from(tagSet);
 const admins = Array.from(adminMap.values());

  const provenance: Record<string, 'embedded_document'> = {};
  if (admins.length > 0) provenance.admins = 'embedded_document';
  if (rules.length > 0) provenance.rules = 'embedded_document';
  if (tags.length > 0) provenance.tags = 'embedded_document';
  if (groupType) provenance.groupType = 'embedded_document';
  if (coverPhotoUrl) provenance.coverPhotoUrl = 'embedded_document';

  return { admins, rules, tags, groupType, coverPhotoUrl, provenance };
}

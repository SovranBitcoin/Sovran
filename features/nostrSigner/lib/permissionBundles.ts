/**
 * @fileoverview Capability bundles — one human concept per permission
 *
 * "Encrypting a message" and "signing a DM" are the same decision to a
 * person: send private messages. The bundles below are the top-level
 * permission vocabulary: the editor shows one tri-state row per bundle, and
 * the approval sheet's Always Allow grants the WHOLE bundle of the request's
 * grant key (per-action precision lives on the fine-grained page).
 *
 * SECURITY INVARIANTS:
 *   - No bundle ever contains a critical grant key (decrypt methods, NIP-60
 *     wallet kinds, kind-5 deletions) — those concepts stay precise and
 *     always-ask. Pinned by test.
 *   - Kinds 14/15/1059 are deliberately excluded: NIP-17 rumors and gift
 *     wraps must never be signed by the user's key (see requestSummary's
 *     anomaly list) — an Always bundle must not auto-sign them. Kind 13
 *     (seal) IS what NIP-17 clients legitimately ask to sign.
 */

import type { GrantKey } from './nip46Types';

/** Identical to the catalog's PermissionEditorGroup (lib must not import components). */
export type PermissionBundleGroup = 'public' | 'account' | 'signin' | 'private' | 'wallet';

export interface PermissionBundle {
  id: string;
  /** Editor row label. */
  label: string;
  /** "Always Allow lets ‹app› ‹verbPhrase› without asking." */
  alwaysVerbPhrase: string;
  /** Registered monicon glyph. */
  icon: string;
  group: PermissionBundleGroup;
  grantKeys: readonly GrantKey[];
}

export const PERMISSION_BUNDLES: readonly PermissionBundle[] = [
  {
    id: 'postPublicly',
    label: 'Post publicly',
    alwaysVerbPhrase: 'post publicly',
    icon: 'lucide:pencil-line',
    group: 'public',
    grantKeys: ['sign_event:1', 'sign_event:1111', 'sign_event:30023'],
  },
  {
    id: 'reactRepost',
    label: 'React & repost',
    alwaysVerbPhrase: 'react and repost',
    icon: 'iconamoon:heart-fill',
    group: 'public',
    grantKeys: ['sign_event:7', 'sign_event:6', 'sign_event:16'],
  },
  {
    id: 'zaps',
    label: 'Zap posts',
    alwaysVerbPhrase: 'zap posts',
    icon: 'mdi:lightning-bolt',
    group: 'public',
    grantKeys: ['sign_event:9734'],
  },
  {
    id: 'account',
    label: 'Manage account & settings',
    alwaysVerbPhrase: 'manage your account and settings',
    icon: 'mdi:account-circle',
    group: 'account',
    grantKeys: ['sign_event:0', 'sign_event:3', 'sign_event:10002', 'sign_event:30078'],
  },
  {
    id: 'signin',
    label: 'Log in to services',
    alwaysVerbPhrase: 'log in to services',
    icon: 'mdi:shield-check',
    group: 'signin',
    grantKeys: ['sign_event:22242', 'sign_event:27235'],
  },
  {
    id: 'privateMessages',
    label: 'Send private messages',
    alwaysVerbPhrase: 'send private messages',
    icon: 'mdi:email',
    group: 'private',
    grantKeys: ['sign_event:4', 'sign_event:13', 'nip04_encrypt', 'nip44_encrypt'],
  },
];

const BUNDLE_BY_GRANT_KEY: ReadonlyMap<GrantKey, PermissionBundle> = (() => {
  const map = new Map<GrantKey, PermissionBundle>();
  for (const bundle of PERMISSION_BUNDLES) {
    for (const grantKey of bundle.grantKeys) {
      if (map.has(grantKey)) {
        throw new Error(`permissionBundles: ${grantKey} appears in two bundles`);
      }
      map.set(grantKey, bundle);
    }
  }
  return map;
})();

/** The bundle a grant key belongs to; null for unbundled/locked concepts. */
export function bundleForGrantKey(grantKey: GrantKey): PermissionBundle | null {
  return BUNDLE_BY_GRANT_KEY.get(grantKey) ?? null;
}

export type BundleTriState = 'ask' | 'allow' | 'block' | 'mixed';

/**
 * Derived editor state for a bundle: uniform member verdicts map directly;
 * any disagreement is 'mixed' (rendered as no chip selected + "Custom").
 */
export function bundleTriState(
  verdictFor: (grantKey: GrantKey) => 'always' | 'deny' | undefined,
  bundle: PermissionBundle
): BundleTriState {
  let sawAlways = false;
  let sawDeny = false;
  let sawAsk = false;
  for (const grantKey of bundle.grantKeys) {
    const verdict = verdictFor(grantKey);
    if (verdict === 'always') sawAlways = true;
    else if (verdict === 'deny') sawDeny = true;
    else sawAsk = true;
  }
  const kinds = Number(sawAlways) + Number(sawDeny) + Number(sawAsk);
  if (kinds > 1) return 'mixed';
  if (sawAlways) return 'allow';
  if (sawDeny) return 'block';
  return 'ask';
}

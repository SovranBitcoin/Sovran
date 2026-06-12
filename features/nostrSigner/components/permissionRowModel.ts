/**
 * @fileoverview Headless row model for the permission editors — the canonical
 * base keys ∪ an app's stored grant keys, each with catalog presentation and
 * a per-kind subtitle. Kept free of component imports so registry tests and
 * future surfaces can consume it without a native test environment.
 */

import {
  alwaysAllowEligible,
  permissionEntryForGrantKey,
  type PermissionEditorGroup,
} from '@/features/nostrSigner/components/permissionCatalog';
import type { Nip46Connection } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import type {
  Nip46SessionAllow,
  Nip46SessionGrant,
} from '@/features/nostrSigner/data/nip46RequestsStore';
import type { GrantKey } from '@/features/nostrSigner/lib/nip46Types';
import { parseGrantKey } from '@/features/nostrSigner/lib/permissionPolicy';

/**
 * Friendly per-kind notes — deliberately plainer than the NIPs' own naming;
 * the "kind N" suffix carries the exact protocol identity.
 */
const KIND_NOTES: Record<number, string> = {
  1: 'Text note',
  1111: 'Comment on articles & media',
  6: 'Repost a note',
  16: 'Repost articles & media',
  7: 'Reaction',
  0: 'Profile details',
  3: 'Follow list',
  5: 'Delete request',
  10002: 'Relay list',
  30023: 'Long-form article',
  30078: 'App settings data',
  9734: 'Zap request',
  22242: 'Relay login',
  27235: 'Website login',
  4: 'Legacy direct message',
  13: 'Sealed private message',
  17375: 'Cashu wallet info',
  7375: 'Cashu wallet balance',
  7374: 'Cashu mint quote',
  7376: 'Cashu spending history',
  9321: 'Nutzap payment',
  10019: 'Nutzap settings',
};

const METHOD_NOTES: Partial<Record<string, string>> = {
  nip04_encrypt: 'Legacy encryption (NIP-04)',
  nip44_encrypt: 'Modern encryption (NIP-44)',
  nip04_decrypt: 'Legacy encryption (NIP-04)',
  nip44_decrypt: 'Modern encryption (NIP-44)',
};

/** Kind/method subtitle so rows sharing a catalog label stay distinguishable. */
function grantKeySubtitle(grantKey: GrantKey): string {
  const { method, kind } = parseGrantKey(grantKey);
  if (method === 'sign_event' && kind !== undefined) {
    const note = KIND_NOTES[kind];
    return note !== undefined ? `${note} · kind ${kind}` : `Event kind ${kind}`;
  }
  return METHOD_NOTES[method] ?? method;
}

/**
 * Live session-state status line for a permission row, or undefined when no
 * session access covers `grantKey`. Decrypt keys are allowed per PERSON
 * (peer-scoped session grants), so their label carries the people count;
 * every other key is a plain session allow. evaluate() lets a persisted
 * 'deny' win over session state, so callers must only show this on rows
 * whose persisted state is 'ask'.
 */
export function sessionStatusFor(
  grantKey: GrantKey,
  appSessionGrants: readonly Pick<Nip46SessionGrant, 'grantKey' | 'peerPubkey'>[],
  appSessionAllows: readonly Pick<Nip46SessionAllow, 'grantKey'>[]
): string | undefined {
  const peers = new Set(
    appSessionGrants.filter((grant) => grant.grantKey === grantKey).map((g) => g.peerPubkey)
  );
  if (peers.size > 0) {
    return `Allowed this session · ${peers.size} ${peers.size === 1 ? 'person' : 'people'}`;
  }
  if (appSessionAllows.some((allow) => allow.grantKey === grantKey)) return 'Allowed this session';
  return undefined;
}

/**
 * Bundle-level session status: 'approve_session' mints allows over the
 * request's whole bundle, so "every key allowed" is the natural (and
 * non-overstating) condition. Partial coverage stays unlabeled — the
 * per-key Advanced rows carry the detail.
 */
export function bundleSessionStatus(
  bundleKeys: readonly GrantKey[],
  appSessionAllows: readonly Pick<Nip46SessionAllow, 'grantKey'>[]
): string | undefined {
  if (bundleKeys.length === 0) return undefined;
  const allowed = new Set(appSessionAllows.map((allow) => allow.grantKey));
  return bundleKeys.every((key) => allowed.has(key)) ? 'Allowed this session' : undefined;
}

export interface PermissionKeyRowModel {
  grantKey: GrantKey;
  /** Kind/method note ("Event kind 1111") when the label alone is ambiguous. */
  subtitle?: string;
  displayLabel: string;
  allowEligible: boolean;
  group: PermissionEditorGroup;
}

/**
 * Per-key rows for an app's grants: the canonical base keys ∪ every stored
 * grant key, label-deduped. Unknown-kind extras ALWAYS carry the kind
 * subtitle — without it two odd-kind grants are indistinguishable.
 */
export function buildPermissionKeyRows(
  baseKeys: readonly GrantKey[],
  grants: Nip46Connection['grants'],
  group?: PermissionEditorGroup
): PermissionKeyRowModel[] {
  const keys: GrantKey[] = [...baseKeys];
  const extras = (Object.keys(grants) as GrantKey[]).filter((key) => !keys.includes(key)).sort();
  keys.push(...extras);

  const base = keys.map((grantKey) => ({
    grantKey,
    entry: permissionEntryForGrantKey(grantKey),
    allowEligible: alwaysAllowEligible(parseGrantKey(grantKey)),
  }));
  return base
    .filter((row) => group === undefined || row.entry.permissionEditorGroup === group)
    .map((row) => ({
      grantKey: row.grantKey,
      allowEligible: row.allowEligible,
      group: row.entry.permissionEditorGroup,
      displayLabel: row.entry.permissionEditorLabel,
      // Advanced is the precise surface: every row carries its exact kind.
      subtitle: grantKeySubtitle(row.grantKey),
    }));
}

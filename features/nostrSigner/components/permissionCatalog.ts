/**
 * @fileoverview Permission catalog — single copy/icon/tier source for signer UI
 *
 * Every signer surface (approval sheet, requests page, activity log, app
 * permission editor, pairing sheet) reads request presentation from here, so
 * the same NIP-46 method/kind always renders the same headline, body, icon,
 * and sensitivity tier everywhere.
 *
 * Tier is DERIVED from `classifyRequest` — this module owns no kind table.
 * Mapping: auto/normal → 'standard', sensitive → 'protected', critical →
 * 'wallet'; sign_event kinds without a copy row get the 'unknown'
 * presentation. The wallet tier never offers Always Allow (the approval
 * sheet renders SlideToConfirm instead), and `alwaysAllowEligible` also
 * consults `isCriticalGrantKey` so kinds whose GRANT KEY is critical (e.g.
 * deletions, whose paramless classification fails closed) never show the
 * affordance even when one specific request classified lower.
 *
 * Display strings derived from request params (app names, peer keys, relay
 * hosts) are untrusted: everything is length-bounded here, at the single
 * choke point, and never logged.
 */

import { isCriticalGrantKey } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import {
  boundDisplay,
  MAX_APP_NAME_DISPLAY,
  MAX_CONTEXT_LABEL_DISPLAY,
  UNNAMED_APP_LABEL,
} from '@/features/nostrSigner/lib/boundedDisplay';
import type { ActivityVerdict, GrantKey, Nip46Method } from '@/features/nostrSigner/lib/nip46Types';
import {
  classifyRequest,
  grantKeyFor,
  parseGrantKey,
  type SensitivityClass,
} from '@/features/nostrSigner/lib/permissionPolicy';

// ── Public shapes ───────────────────────────────────────────────

export type PermissionTier = 'standard' | 'protected' | 'wallet' | 'unknown';
export type PermissionEditorGroup = 'public' | 'account' | 'signin' | 'private' | 'wallet';

/** One run of copy; the UI bolds `bold` segments (app names in templates). */
export interface CopySegment {
  text: string;
  bold?: boolean;
}

/** Caller-resolved display labels — already human, still untrusted. */
export interface PermissionCopyContext {
  appName: string;
  /** Encrypt peer display label (e.g. shortened pubkey). */
  peerLabel?: string;
  /** Login target for kind 22242/27235 (relay/url tag value). */
  relayLabel?: string;
}

export interface PermissionCatalogEntry {
  headline: string;
  body: (ctx: PermissionCopyContext) => CopySegment[];
  alwaysVerbPhrase: string;
  /** Registered monicon glyph (must stay inside assets/icons `icons` list). */
  icon: string;
  tier: PermissionTier;
  permissionEditorLabel: string;
  permissionEditorGroup: PermissionEditorGroup;
}

export interface PermissionLookup {
  method: Nip46Method;
  kind?: number;
  /** Raw sign_event params — lets kind-5 deletions classify by scope. */
  params?: string[];
}

// ── Untrusted-display bounds ────────────────────────────────────
// boundDisplay lives in lib/boundedDisplay so the headless summary layer can
// share the same choke point; re-exported here for existing importers.

export { boundDisplay, UNNAMED_APP_LABEL };

function boundedAppName(ctx: PermissionCopyContext): string {
  const trimmed = ctx.appName.trim();
  return trimmed.length === 0 ? UNNAMED_APP_LABEL : boundDisplay(trimmed, MAX_APP_NAME_DISPLAY);
}

function boundedLabel(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? boundDisplay(trimmed, MAX_CONTEXT_LABEL_DISPLAY) : fallback;
}

/** Bounded display name for a connection-ish record; "Unnamed app" fallback. */
export function appDisplayName(source: { name?: string } | undefined): string {
  const trimmed = source?.name?.trim();
  return trimmed ? boundDisplay(trimmed, MAX_APP_NAME_DISPLAY) : UNNAMED_APP_LABEL;
}

// ── Row definitions (plan copy table, verbatim) ─────────────────

interface CatalogRow {
  headline: string | ((kind: number | undefined) => string);
  /** Plain suffix after the bolded app name, or a ctx-aware builder. */
  body: string | ((ctx: PermissionCopyContext) => string);
  alwaysVerbPhrase: string;
  icon: string;
  permissionEditorLabel: string | ((kind: number | undefined) => string);
  permissionEditorGroup: PermissionEditorGroup;
}

const UNKNOWN_SIGN_ROW: CatalogRow = {
  headline: 'Unrecognized Action',
  body: " wants to do something Sovran doesn't recognize. Review the details before allowing.",
  alwaysVerbPhrase: 'perform this action',
  icon: 'mdi:help-circle',
  permissionEditorLabel: 'Unrecognized action',
  permissionEditorGroup: 'public',
};

const SIGN_ROWS_BY_NAME = {
  post: {
    headline: 'Publish a Post',
    body: ' wants to sign a public post as you.',
    alwaysVerbPhrase: 'sign posts',
    icon: 'lucide:pencil-line',
    permissionEditorLabel: 'Publish posts',
    permissionEditorGroup: 'public',
  },
  repost: {
    headline: 'Repost a Note',
    body: ' wants to repost a note as you.',
    alwaysVerbPhrase: 'repost notes',
    icon: 'garden:arrow-retweet-fill-16',
    permissionEditorLabel: 'Repost notes',
    permissionEditorGroup: 'public',
  },
  // NIP-18 kind 16: reposts any event kind EXCEPT text notes.
  genericRepost: {
    headline: 'Repost Content',
    body: ' wants to repost content (articles, media) as you.',
    alwaysVerbPhrase: 'repost content',
    icon: 'garden:arrow-retweet-fill-16',
    permissionEditorLabel: 'Repost other content',
    permissionEditorGroup: 'public',
  },
  // NIP-22 kind 1111: a comment threaded under non-note content.
  comment: {
    headline: 'Publish a Comment',
    body: ' wants to comment on content as you.',
    alwaysVerbPhrase: 'publish comments',
    icon: 'iconamoon:comment-fill',
    permissionEditorLabel: 'Comment on other content',
    permissionEditorGroup: 'public',
  },
  react: {
    headline: 'React to a Post',
    body: ' wants to react with "+" as you.',
    alwaysVerbPhrase: 'react to posts',
    icon: 'iconamoon:heart-fill',
    permissionEditorLabel: 'React to posts',
    permissionEditorGroup: 'public',
  },
  privateMessage: {
    headline: 'Send a Private Message',
    body: ' wants to sign an encrypted message from you.',
    alwaysVerbPhrase: 'sign private messages',
    icon: 'mdi:email',
    permissionEditorLabel: 'Send private messages',
    permissionEditorGroup: 'private',
  },
  profile: {
    headline: 'Update Your Profile',
    body: ' wants to change your public profile — name, picture, and bio.',
    alwaysVerbPhrase: 'update your profile',
    icon: 'mdi:account-circle',
    permissionEditorLabel: 'Update profile',
    permissionEditorGroup: 'account',
  },
  follows: {
    headline: 'Change Your Follows',
    body: ' wants to update who you follow. This replaces your entire follow list.',
    alwaysVerbPhrase: 'change your follows',
    icon: 'mdi:account-multiple',
    permissionEditorLabel: 'Change follows',
    permissionEditorGroup: 'account',
  },
  deletion: {
    headline: 'Delete Your Content',
    body: ' wants to permanently request deletion of your events.',
    alwaysVerbPhrase: 'delete your content',
    icon: 'mdi:trash-can-outline',
    permissionEditorLabel: 'Delete content',
    permissionEditorGroup: 'account',
  },
  relays: {
    headline: 'Change Your Relays',
    body: ' wants to update where your data is published and read.',
    alwaysVerbPhrase: 'change your relays',
    icon: 'mdi:broadcast',
    permissionEditorLabel: 'Change relays',
    permissionEditorGroup: 'account',
  },
  login: {
    headline: 'Log In to a Service',
    body: (ctx: PermissionCopyContext) =>
      ` wants to prove your identity to ${boundedLabel(ctx.relayLabel, 'a service')}.`,
    alwaysVerbPhrase: 'log in to services',
    icon: 'mdi:shield-check',
    permissionEditorLabel: 'Log in to services',
    permissionEditorGroup: 'signin',
  },
  appData: {
    headline: 'Save App Data',
    body: ' wants to store app settings under your identity.',
    alwaysVerbPhrase: 'save app data',
    icon: 'fluent:apps-16-filled',
    permissionEditorLabel: 'Save app data',
    permissionEditorGroup: 'account',
  },
  article: {
    headline: 'Publish an Article',
    body: ' wants to publish a long-form article as you.',
    alwaysVerbPhrase: 'publish articles',
    icon: 'lucide:pencil-line',
    permissionEditorLabel: 'Publish articles',
    permissionEditorGroup: 'public',
  },
  zapRequest: {
    headline: 'Approve a Zap Request',
    body: ' wants to request a zap. Payment still happens in your lightning wallet.',
    alwaysVerbPhrase: 'send zap requests',
    icon: 'mdi:lightning-bolt',
    permissionEditorLabel: 'Send zap requests',
    permissionEditorGroup: 'public',
  },
  wallet: {
    headline: 'Wallet Access Request',
    body: ' wants to sign a Cashu wallet event. This can move or expose your ecash.',
    alwaysVerbPhrase: 'sign wallet events',
    icon: 'fluent:wallet-24-filled',
    permissionEditorLabel: 'Sign wallet events',
    permissionEditorGroup: 'wallet',
  },
} as const satisfies Record<string, CatalogRow>;

type SignRowName = keyof typeof SIGN_ROWS_BY_NAME;

/**
 * Kind → copy row. NOT a sensitivity table (policy owns that) — purely which
 * words/icon a recognized kind gets. Sibling kinds get their own rows so the
 * editor and prompts stay distinct: 1111 comments ≠ kind-1 notes, kind-16
 * generic reposts ≠ kind-6 note reposts (NIP-18/22).
 */
const SIGN_ROW_BY_KIND: Record<number, SignRowName> = {
  1: 'post',
  1111: 'comment',
  6: 'repost',
  16: 'genericRepost',
  7: 'react',
  4: 'privateMessage',
  13: 'privateMessage',
  14: 'privateMessage',
  1059: 'privateMessage',
  0: 'profile',
  3: 'follows',
  5: 'deletion',
  10002: 'relays',
  22242: 'login',
  27235: 'login',
  30078: 'appData',
  30023: 'article',
  9734: 'zapRequest',
  17375: 'wallet',
  7375: 'wallet',
  7374: 'wallet',
  7376: 'wallet',
  9321: 'wallet',
  10019: 'wallet',
};

const METHOD_ROWS: Record<Exclude<Nip46Method, 'sign_event'>, CatalogRow> = {
  get_public_key: {
    headline: 'Share Public Key',
    body: " wants to see your public key (npub). This identifies you but can't post or spend.",
    alwaysVerbPhrase: 'share your public key',
    icon: 'mdi:key-variant',
    permissionEditorLabel: 'Share public key',
    permissionEditorGroup: 'signin',
  },
  // connect/ping are auto-class: they never prompt, so these rows only back
  // activity rows (connect) and catalog completeness (ping is never logged).
  connect: {
    headline: 'Connect App',
    body: ' connected to your signer.',
    alwaysVerbPhrase: 'connect',
    icon: 'lucide:link',
    permissionEditorLabel: 'Connect',
    permissionEditorGroup: 'signin',
  },
  ping: {
    headline: 'Ping',
    body: ' checked the connection.',
    alwaysVerbPhrase: 'check the connection',
    icon: 'feather:wifi',
    permissionEditorLabel: 'Ping',
    permissionEditorGroup: 'signin',
  },
  nip04_encrypt: {
    headline: 'Encrypt a Message',
    body: (ctx: PermissionCopyContext) =>
      ` wants to encrypt a message to ${boundedLabel(ctx.peerLabel, 'them')} so only they can read it.`,
    alwaysVerbPhrase: 'encrypt messages',
    icon: 'mdi:shield',
    permissionEditorLabel: 'Encrypt messages',
    permissionEditorGroup: 'private',
  },
  nip44_encrypt: {
    headline: 'Encrypt a Message',
    body: (ctx: PermissionCopyContext) =>
      ` wants to encrypt a message to ${boundedLabel(ctx.peerLabel, 'them')} so only they can read it.`,
    alwaysVerbPhrase: 'encrypt messages',
    icon: 'mdi:shield',
    permissionEditorLabel: 'Encrypt messages',
    permissionEditorGroup: 'private',
  },
  nip04_decrypt: {
    headline: 'Decrypt Your Data',
    body: ' wants to read messages sent to you.',
    alwaysVerbPhrase: 'decrypt your data',
    icon: 'majesticons:eye',
    permissionEditorLabel: 'Decrypt your data',
    permissionEditorGroup: 'private',
  },
  nip44_decrypt: {
    headline: 'Decrypt Your Data',
    body: ' wants to read messages sent to you.',
    alwaysVerbPhrase: 'decrypt your data',
    icon: 'majesticons:eye',
    permissionEditorLabel: 'Decrypt your data',
    permissionEditorGroup: 'private',
  },
};

// ── Tier derivation ─────────────────────────────────────────────

function tierFromSensitivity(sensitivity: SensitivityClass): PermissionTier {
  switch (sensitivity) {
    case 'auto':
    case 'normal':
      return 'standard';
    case 'sensitive':
      return 'protected';
    case 'critical':
      return 'wallet';
    case 'forbidden':
      // Never prompts (engine auto-denies); presented as unrecognized if it
      // ever surfaces in a passive list.
      return 'unknown';
  }
}

function isUnknownSignKind(lookup: PermissionLookup): boolean {
  if (lookup.method !== 'sign_event') return false;
  return lookup.kind === undefined || SIGN_ROW_BY_KIND[lookup.kind] === undefined;
}

/** Sensitivity tier for a request — drives banner, buttons, and ceilings. */
export function permissionTierFor(lookup: PermissionLookup): PermissionTier {
  const { class: sensitivity } = classifyRequest(lookup);
  if (isUnknownSignKind(lookup) && sensitivity !== 'critical' && sensitivity !== 'forbidden') {
    return 'unknown';
  }
  return tierFromSensitivity(sensitivity);
}

// ── Entry resolution ────────────────────────────────────────────

function rowFor(lookup: PermissionLookup): CatalogRow {
  if (lookup.method !== 'sign_event') return METHOD_ROWS[lookup.method];
  if (lookup.kind === undefined) return UNKNOWN_SIGN_ROW;
  const name = SIGN_ROW_BY_KIND[lookup.kind];
  return name === undefined ? UNKNOWN_SIGN_ROW : SIGN_ROWS_BY_NAME[name];
}

function resolveBody(row: CatalogRow, ctx: PermissionCopyContext): CopySegment[] {
  const suffix = typeof row.body === 'string' ? row.body : row.body(ctx);
  return [{ text: boundedAppName(ctx), bold: true }, { text: suffix }];
}

/** Every surface's presentation lookup. Total: every method/kind resolves. */
export function permissionEntryFor(lookup: PermissionLookup): PermissionCatalogEntry {
  const row = rowFor(lookup);
  return {
    headline: typeof row.headline === 'string' ? row.headline : row.headline(lookup.kind),
    body: (ctx) => resolveBody(row, ctx),
    alwaysVerbPhrase: row.alwaysVerbPhrase,
    icon: row.icon,
    tier: permissionTierFor(lookup),
    permissionEditorLabel:
      typeof row.permissionEditorLabel === 'string'
        ? row.permissionEditorLabel
        : row.permissionEditorLabel(lookup.kind),
    permissionEditorGroup: row.permissionEditorGroup,
  };
}

/** Presentation for a stored grant key (app permission editor rows). */
export function permissionEntryForGrantKey(grantKey: GrantKey): PermissionCatalogEntry {
  return permissionEntryFor(parseGrantKey(grantKey));
}

/**
 * Whether the approval sheet may offer Always Allow. Wallet tier never; and
 * any request whose GRANT KEY is critical (kind-5 deletions classify per
 * scope but their key fails closed) is excluded too — the store would reject
 * the write, so the affordance must not exist.
 */
export function alwaysAllowEligible(lookup: PermissionLookup): boolean {
  const tier = permissionTierFor(lookup);
  if (tier === 'wallet') return false;
  const grantKey = grantKeyFor(lookup.method, lookup.kind);
  if (grantKey === null) return false;
  return !isCriticalGrantKey(grantKey);
}

// ── Tier banners (plan copy, verbatim) ──────────────────────────

interface TierBanner {
  tone: 'warning' | 'danger';
  segments: CopySegment[];
}

/** Danger/warning banner for a tier; null for the standard tier. */
export function tierBannerFor(tier: PermissionTier, appName: string): TierBanner | null {
  switch (tier) {
    case 'standard':
      return null;
    case 'protected':
      return {
        tone: 'warning',
        segments: [{ text: 'Sensitive permission — this changes or reveals core account data.' }],
      };
    case 'wallet':
      return {
        tone: 'danger',
        segments: [
          {
            text: 'Highly sensitive — this touches your wallet. Only approve if you started this action in ',
          },
          { text: boundedAppName({ appName }), bold: true },
          { text: ' just now.' },
        ],
      };
    case 'unknown':
      return {
        tone: 'warning',
        segments: [{ text: "Unrecognized event type. If you didn't expect this, deny it." }],
      };
  }
}

// ── Decrypt preview label (content is NEVER previewed) ──────────

export function encryptedPayloadLabel(ciphertextLength: number): string {
  return `Encrypted payload · ${ciphertextLength} chars`;
}

// ── Activity verdict display ────────────────────────────────────

interface ActivityVerdictDisplay {
  label: string;
  /** Registered monicon glyph. */
  icon: string;
  tone: 'success' | 'danger' | 'warning';
  /** Accent line under auto-signed rows ("Auto-signed — Always Allow"). */
  accentLine?: string;
}

const SIGNED_BY_YOU: Pick<ActivityVerdictDisplay, 'icon' | 'tone'> = {
  icon: 'mdi:check-circle',
  tone: 'success',
};
const AUTO_SIGNED: Pick<ActivityVerdictDisplay, 'icon' | 'tone'> = {
  icon: 'mdi:check-decagram',
  tone: 'success',
};
const DENIED: Pick<ActivityVerdictDisplay, 'icon' | 'tone'> = {
  icon: 'mdi:close-circle',
  tone: 'danger',
};

export const ACTIVITY_VERDICT_DISPLAY: Record<ActivityVerdict, ActivityVerdictDisplay> = {
  approved_once: { ...SIGNED_BY_YOU, label: 'Approved' },
  approved_pairing: { ...SIGNED_BY_YOU, label: 'Approved at Pairing' },
  auto_approved_grant: {
    ...AUTO_SIGNED,
    label: 'Auto-signed',
    accentLine: 'Auto-signed — Always Allow',
  },
  auto_approved_session: {
    ...AUTO_SIGNED,
    label: 'Auto-approved',
    accentLine: 'Auto-approved — for this session',
  },
  auto_approved_peer_grant: {
    ...AUTO_SIGNED,
    label: 'Auto-approved',
    accentLine: 'Auto-approved — always for this person',
  },
  auto_approved_method: { ...AUTO_SIGNED, label: 'Auto-approved' },
  denied_once: { ...DENIED, label: 'Denied' },
  auto_denied_blocked: { ...DENIED, label: 'Blocked' },
  auto_denied_grant: { ...DENIED, label: 'Auto-denied' },
  auto_denied_forbidden: { ...DENIED, label: 'Denied — Forbidden' },
  auto_denied_unauthorized: { ...DENIED, label: 'Denied — Not Connected' },
  auto_denied_rate_limited: { ...DENIED, label: 'Denied — Rate Limited' },
  auto_denied_malformed: { ...DENIED, label: 'Denied — Malformed' },
  expired: { label: 'Expired', icon: 'mdi:clock-outline', tone: 'warning' },
};

// ── Approval-sheet fixed copy ───────────────────────────────────

export const APPROVAL_BUTTON_LABELS = {
  allowSession: 'Allow This Session',
  alwaysAllow: 'Always Allow',
  approveOnce: 'Approve',
  deny: 'Deny',
} as const;

export const BLOCK_APP_LABEL = 'Block this app';

/** Confirm copy for the sheet's Block link. */
export function blockAppConfirmTitle(appName: string): string {
  return `Block ${boundedAppName({ appName })}? It won't be able to send requests until you unblock it in Connected Apps.`;
}

/**
 * Banner for peer≠self decrypts. The generic wallet-tier banner ("touches
 * your wallet") is wrong for a DM read — the accurate risk is conversation
 * privacy. Self-decrypts keep the wallet banner (NIP-60 payloads live there).
 */
export function peerDecryptBanner(appName: string): {
  tone: 'danger';
  segments: CopySegment[];
} {
  return {
    tone: 'danger',
    segments: [
      { text: 'Private — approving reveals this conversation to ' },
      { text: boundedAppName({ appName }), bold: true },
      { text: '.' },
    ],
  };
}

export const VIEW_ALL_LABEL = 'View All';

export const SHOW_FULL_EVENT_LABEL = 'Show full event';
export const HIDE_FULL_EVENT_LABEL = 'Hide full event';

/** Counts DECISIONS (consolidated groups), not raw spam requests. */
export function queueStripLabel(position: number, total: number): string {
  return `Request ${position} of ${total}`;
}

// ── Toast/notice copy builders ──────────────────────────────────

interface ToastCopy {
  label: string;
  description: string;
}

/** Dismiss-without-verdict defers the batch. */
export function requestsWaitingToastCopy(pendingCount: number): ToastCopy {
  return {
    label: 'Requests waiting',
    description:
      pendingCount === 1
        ? '1 request is in your queue. Open Signer to review.'
        : `${pendingCount} requests are in your queue. Open Signer to review.`,
  };
}

/** Final summary once the open batch is fully handled. */
export function allHandledToastCopy(allowed: number, denied: number): ToastCopy {
  return {
    label: 'All requests handled',
    description: `${allowed} allowed · ${denied} denied`,
  };
}

/** In-sheet notice when the visible request expires (1.5s, then advance). */
export function expiredNoticeCopy(appName: string): string {
  return `This request expired. ${boundedAppName({ appName })} stopped waiting for a response.`;
}

/** Quiet 2s toast for grant-based auto-signs. */
export function autoSignedToastCopy(appName: string, headline: string): ToastCopy {
  return {
    label: `Auto-signed for ${boundedAppName({ appName })}`,
    description: `${headline} · change in Connected Apps`,
  };
}

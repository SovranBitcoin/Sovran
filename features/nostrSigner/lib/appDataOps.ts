/**
 * @fileoverview NIP-78 (kind 30078) app-data copy — generic, not per-app
 *
 * NIP-78's `d` tag is "some reference to the app name and context — or any
 * other arbitrary string": there is NO operation-naming convention, and no
 * shipping signer humanizes 30078 below the kind level (Amber, noauth, and
 * Primal's own signer all show a flat "Application-specific Data" + raw
 * JSON). Instead of a per-app operation table, this module derives copy
 * structurally so it keeps working when apps rename or add operations:
 *
 *   1. verb_object heuristic over the d-tag operation (Primal-style
 *      `["d", "<app>", "get_app_settings"]`) — `get_*` → "Load …",
 *      `set_*` → "Save …", etc.; unknown verbs read as "Sync …".
 *   2. content `subkey` / `description` fields (Primal envelope shape).
 *   3. NIP-31 `alt` tag — the only cross-signer humanization convention
 *      (the requesting app self-describes the event; Amber honors it too).
 *   4. Coracle-style namespaced d tags ("coracle/last_checked/v1").
 *
 * RISK never depends on exact keys: any operation/subkey mentioning NWC or
 * wallet escalates `wallet_credential`, so a renamed op can't silently drop
 * the banner.
 *
 * Everything here renders from attacker-controllable strings: every output
 * passes `boundDisplay`, and nothing is ever logged.
 */

import { boundDisplay, MAX_CONTEXT_LABEL_DISPLAY } from './boundedDisplay';
import { safeJsonParse } from './json';

export interface AppDataOperation {
  /** Sheet headline override, e.g. "Load App Settings". */
  headline: string;
  /**
   * Body suffix after the bolded app name, lowercase verb start, no period:
   * "load app settings".
   */
  verbPhrase: string;
  /** Escalation: NWC/wallet-touching data can carry connection secrets. */
  risk?: 'wallet_credential';
}

/** Leading-verb map: machine prefix → (headline verb, phrase verb). */
const VERBS: Record<string, { headline: string; phrase: string }> = {
  get: { headline: 'Load', phrase: 'load' },
  fetch: { headline: 'Load', phrase: 'load' },
  load: { headline: 'Load', phrase: 'load' },
  set: { headline: 'Save', phrase: 'save' },
  save: { headline: 'Save', phrase: 'save' },
  store: { headline: 'Save', phrase: 'save' },
  update: { headline: 'Update', phrase: 'update' },
  change: { headline: 'Update', phrase: 'update' },
  reset: { headline: 'Reset', phrase: 'reset' },
  clear: { headline: 'Clear', phrase: 'clear' },
  mark: { headline: 'Mark', phrase: 'mark' },
  delete: { headline: 'Delete', phrase: 'delete' },
  remove: { headline: 'Remove', phrase: 'remove' },
  report: { headline: 'Report', phrase: 'report' },
};

/** Word-level cleanups so machine names read human. */
const WORD_REWRITES: Record<string, string> = {
  subsettings: 'settings',
  dms: 'messages',
  dm: 'message',
  nwc: 'wallet (NWC)',
  laste: 'last', // Primal's verbatim typo
  config: 'configuration',
};

const MAX_OPERATION_WORDS = 8;
const WALLET_RISK_RE = /nwc|wallet/i;

function riskFor(...sources: Array<string | undefined>): { risk?: 'wallet_credential' } {
  return sources.some((source) => source !== undefined && WALLET_RISK_RE.test(source))
    ? { risk: 'wallet_credential' }
    : {};
}

function cleanWords(value: string): string[] {
  return value
    .split(/[_\-\s]+/)
    .filter((word) => word.length > 0)
    .slice(0, MAX_OPERATION_WORDS)
    .map((word) => WORD_REWRITES[word.toLowerCase()] ?? word.toLowerCase());
}

function titleCase(text: string): string {
  return text
    .split(' ')
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/**
 * verb_object heuristic: "get_app_settings" → headline "Load App Settings",
 * phrase "load app settings". Unknown leading verbs read as "Sync …".
 * Returns null for single-word/empty operations.
 */
function humanizeOperation(operation: string): AppDataOperation | null {
  const words = cleanWords(operation);
  if (words.length < 2) return null;

  const verb = VERBS[words[0]!];
  const object = boundDisplay((verb ? words.slice(1) : words).join(' '), MAX_CONTEXT_LABEL_DISPLAY);
  if (verb === undefined) {
    return {
      headline: boundDisplay(`Sync ${titleCase(object)}`, MAX_CONTEXT_LABEL_DISPLAY),
      verbPhrase: `sync ${object} with your account`,
      ...riskFor(operation),
    };
  }
  return {
    headline: boundDisplay(`${verb.headline} ${titleCase(object)}`, MAX_CONTEXT_LABEL_DISPLAY),
    verbPhrase: `${verb.phrase} ${object}`,
    ...riskFor(operation),
  };
}

function contentField(content: string, field: 'description' | 'subkey'): string | undefined {
  const parsed = safeJsonParse(content);
  if (parsed.isErr()) return undefined;
  const value = (parsed.value as Record<string, unknown> | null)?.[field];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** "user-home-feeds" → "load your home feeds settings" (user- is the scope). */
function subkeyOperation(subkey: string, isSet: boolean): AppDataOperation {
  const words = cleanWords(subkey);
  const scoped = words[0] === 'user' ? words.slice(1) : words;
  const noun =
    scoped.length > 0
      ? `your ${boundDisplay(scoped.join(' '), MAX_CONTEXT_LABEL_DISPLAY)} settings`
      : `your '${boundDisplay(subkey, 32)}' settings`;
  return {
    headline: isSet ? 'Save App Settings' : 'Load App Settings',
    verbPhrase: `${isSet ? 'save' : 'load'} ${noun}`,
    ...riskFor(subkey),
  };
}

/** NIP-31: the requesting app's own one-line summary of the event. */
function altTagOperation(tags: readonly string[][]): AppDataOperation | null {
  const alt = tags.find((tag) => tag[0] === 'alt' && typeof tag[1] === 'string')?.[1]?.trim();
  if (alt === undefined || alt.length === 0) return null;
  // App-controlled text: bounded and quoted so it can't impersonate our copy.
  return {
    headline: 'Sync App Data',
    verbPhrase: `sync app data ("${boundDisplay(alt, MAX_CONTEXT_LABEL_DISPLAY)}")`,
  };
}

/**
 * Resolve copy for a kind-30078 unsigned event. Total — always returns an
 * operation; unrecognized shapes fall back to a bounded generic line.
 */
export function appDataOperationFor(tags: readonly string[][], content: string): AppDataOperation {
  const dTag = tags.find((tag) => tag[0] === 'd' && typeof tag[1] === 'string');
  const dValue = dTag?.[1] ?? '';
  const dOperation = dTag?.[2];

  // ── Operation element (Primal-style ["d", "<app>", "<operation>"]) ──
  if (typeof dOperation === 'string' && dOperation.length > 0) {
    // A content subkey names the data more precisely than the op words
    // ("get_app_subsettings" + "user-home-feeds" → "your home feeds settings").
    if (dOperation.includes('subsettings')) {
      const subkey = contentField(content, 'subkey');
      if (subkey) {
        return {
          ...subkeyOperation(subkey, dOperation.startsWith('set')),
          ...riskFor(dOperation, subkey),
        };
      }
    }
    const humanized = humanizeOperation(dOperation);
    if (humanized) return humanized;
    // Single-word operation: the app named it — show it bounded.
    return {
      headline: 'Sync App Data',
      verbPhrase: `sync app data ('${boundDisplay(dOperation, MAX_CONTEXT_LABEL_DISPLAY)}') with your account`,
      ...riskFor(dOperation),
    };
  }

  // ── Subkey-only content (no operation element) ──
  const subkey = contentField(content, 'subkey');
  if (subkey) return subkeyOperation(subkey, false);

  // ── App-described action (content {"description": "..."}) ──
  const description = contentField(content, 'description');
  if (description) {
    return {
      headline: 'Sync App Data',
      verbPhrase: `sync app data ("${boundDisplay(description, MAX_CONTEXT_LABEL_DISPLAY)}")`,
      ...riskFor(description),
    };
  }

  // ── NIP-31 alt tag (the cross-signer convention) ──
  const alt = altTagOperation(tags);
  if (alt) return alt;

  // ── Coracle-style namespaced d tag ("coracle/last_checked/v1") ──
  const slash = dValue.indexOf('/');
  if (slash > 0) {
    return {
      headline: 'Sync App Data',
      verbPhrase: `sync ${boundDisplay(dValue.slice(0, slash), 32)} data with your account`,
    };
  }

  if (dValue) {
    return {
      headline: 'Sync App Data',
      verbPhrase: `sync app data ('${boundDisplay(dValue, MAX_CONTEXT_LABEL_DISPLAY)}') with your account`,
      ...riskFor(dValue),
    };
  }

  return { headline: 'Save App Data', verbPhrase: 'store app settings under your identity' };
}

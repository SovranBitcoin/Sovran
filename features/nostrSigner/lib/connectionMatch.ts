/**
 * @fileoverview Client-identity resolution across re-pairs
 *
 * Clients like Primal mint an EPHEMERAL client keypair per browser profile,
 * so a re-pair arrives under a brand-new clientPubkey. `findPreviousConnection`
 * recognizes "same app, new key" from the connection's claimed identity so the
 * connect sheet can offer the Reconnect variant, and `connectionForClient`
 * resolves pre-replacement history (activity rows) to the live record via the
 * `previousClientPubkeys` chain.
 *
 * SECURITY: name/url are app-supplied and claimable by ANYONE. A match here is
 * only ever a UX offer — inheritance happens through the user-confirmed
 * Reconnect sheet, and the engine re-runs this matcher inside
 * completeNostrconnectPairing so a forged "replaces X" can never transfer
 * grants to a record this matcher would not pick. Matching rules are
 * deliberately conservative:
 *   - url (hostname) beats name: equal names with DIFFERENT hostnames never
 *     match — that is exactly the impersonation shape.
 *   - Asymmetric fallback: name-only matching is allowed only when the
 *     PREVIOUS record has no parseable url. A url-less forged URI can never
 *     name-match a record that has one (legit clients always send url).
 */

import type { Nip46Connection } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import type { ParsedNostrConnectUri } from '@/features/nostrSigner/lib/nip46Uri';

import { safeHostname } from './boundedDisplay';

export type PreviousConnectionMatch =
  | { kind: 'none' }
  | { kind: 'active'; connection: Nip46Connection }
  | { kind: 'blocked'; connection: Nip46Connection };

type ParsedIdentity = Pick<ParsedNostrConnectUri, 'clientPubkey' | 'name' | 'url'>;

function hostnameOf(url: string | undefined): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  const host = safeHostname(trimmed);
  return host.isOk() ? host.value.toLowerCase() : undefined;
}

function normalizedName(name: string | undefined): string | undefined {
  const trimmed = name?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

function matchesIdentity(
  candidate: Nip46Connection,
  parsedHost: string | undefined,
  parsedName: string | undefined
): boolean {
  const candidateHost = hostnameOf(candidate.url);
  // url wins over name: when both sides have a parseable url, hostnames must
  // agree — equal names with different hostnames never match.
  if (candidateHost !== undefined && parsedHost !== undefined) {
    return candidateHost === parsedHost;
  }
  // Asymmetric fallback: a record WITH a url can only be matched via url.
  if (candidateHost !== undefined) return false;
  const candidateName = normalizedName(candidate.name);
  return candidateName !== undefined && parsedName !== undefined && candidateName === parsedName;
}

function mostRecent(connections: readonly Nip46Connection[]): Nip46Connection | undefined {
  let best: Nip46Connection | undefined;
  for (const connection of connections) {
    const recency = connection.lastUsedAt ?? connection.pairedAt;
    const bestRecency = best === undefined ? -1 : (best.lastUsedAt ?? best.pairedAt);
    if (recency > bestRecency) best = connection;
  }
  return best;
}

/**
 * The previous connection a fresh nostrconnect pairing appears to revisit.
 * Active matches beat blocked ones (a blocked record only surfaces when no
 * active record matches — the sheet warns instead of inheriting); within a
 * tier the most recently used wins. Bunker-origin records never match.
 */
export function findPreviousConnection(
  apps: Record<string, Nip46Connection>,
  parsed: ParsedIdentity
): PreviousConnectionMatch {
  const parsedHost = hostnameOf(parsed.url);
  const parsedName = normalizedName(parsed.name);
  if (parsedHost === undefined && parsedName === undefined) return { kind: 'none' };

  const selfKey = parsed.clientPubkey.toLowerCase();
  const active: Nip46Connection[] = [];
  const blocked: Nip46Connection[] = [];
  for (const candidate of Object.values(apps)) {
    if (candidate.origin !== 'nostrconnect') continue;
    if (candidate.clientPubkey.toLowerCase() === selfKey) continue;
    if (!matchesIdentity(candidate, parsedHost, parsedName)) continue;
    (candidate.status === 'active' ? active : blocked).push(candidate);
  }

  const activeBest = mostRecent(active);
  if (activeBest !== undefined) return { kind: 'active', connection: activeBest };
  const blockedBest = mostRecent(blocked);
  if (blockedBest !== undefined) return { kind: 'blocked', connection: blockedBest };
  return { kind: 'none' };
}

/**
 * Live record for a client key, following `previousClientPubkeys` so
 * pre-replacement activity history still resolves to the right app. The live
 * key always wins over a chain entry.
 */
export function connectionForClient(
  apps: Record<string, Nip46Connection>,
  clientPubkey: string
): Nip46Connection | undefined {
  const direct = apps[clientPubkey];
  if (direct !== undefined) return direct;
  return Object.values(apps).find((connection) =>
    connection.previousClientPubkeys.includes(clientPubkey)
  );
}

import { useMemo, useState } from 'react';

import { useBalanceContext } from '@cashu/coco-react';
import { routstrMintKey, spendableMintBalances } from '@/shared/lib/routstr/payingMint';
import {
  cachedProbe,
  resolveProviderStatus,
  type ProviderStatus,
} from '@/shared/lib/routstr/providerHealth';
import type { ServerProvider } from '@/shared/lib/routstr/providers';
import type { StatusSource } from '../lib/providerListLog';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

/**
 * Every known provider, with what the user needs to choose between them.
 *
 * Two derived figures do the work. **Spendable** is the sum of what the wallet
 * holds across the mints this provider will actually redeem — not the wallet
 * total, which says nothing about whether a given provider can be paid. And
 * **encrypted models**, which is a count and not a property: a provider whose
 * catalog holds sealed models is worth finding, but on the one node that
 * badges itself end-to-end encrypted, 9 models of 582 are actually sealed —
 * so "this provider is E2EE" is a claim the evidence does not support.
 *
 * Who ranks the list has changed. nagg discovers and probes the whole network
 * continuously and serves it best-first; re-deriving that order here from the
 * same fields would be a second opinion on the same evidence, so the server's
 * order is rendered as given. What this hook still decides is what the server
 * cannot know: whether the wallet can pay a provider at all, and what this
 * device has seen for itself since the server last looked. Providers nagg
 * never heard of — one the user typed in, one only a relay announced — fall
 * back to the local ranking and sort after the directory.
 *
 * Health updates never move a row under the user's finger.
 */

export interface ProviderRow {
  baseUrl: string;
  name: string;
  description: string | null;
  version: string | null;
  mints: string[];
  e2ee: boolean | null;
  pubkey: string | null;
  status: ProviderStatus;
  /** Which of the three answers about reachability `status` came from. The
   *  row hook asks them in a fixed order and only it knows which one replied,
   *  so a status that looks wrong on screen can be traced to its author. */
  statusSource: StatusSource;
  /** True when `name` is this provider's hostname rather than a name it
   *  published. Not recoverable downstream: the store manufactures a hostname
   *  when it has none, so a nameless provider and one named after its host are
   *  the same string by the time a row reads it. */
  nameIsHost: boolean;
  /** How many of this provider's models are sealed to an enclave, per nagg's
   *  catalog read. `null` when nobody has counted. Never a provider-level
   *  "is encrypted" flag — see the note above. */
  encryptedModelCount: number | null;
  /** Models the provider serves, per nagg. `null` when unknown. */
  modelCount: number | null;
  /** The operator's follower count as nagg aggregated it — a stand-in until
   *  the row's own Nostr profile loads, so the pill isn't blank on first paint. */
  followers: number | null;
  /** Sats the wallet holds across the mints this provider accepts. A provider
   *  that publishes no mint list accepts any, so it gets the wallet total. */
  spendableSats: number;
  /** Why this provider cannot be chosen, or `null` when it can. */
  blockedReason: string | null;
}

const host = (baseUrl: string) => baseUrl.replace(/^https:\/\//, '');

/** Reachable first, not-yet-checked next, down last — the same three-way split
 *  nagg sorts by, recomputed here from the RESOLVED status so a row this
 *  device has just contradicted lands where its real state belongs. */
const STATUS_RANK: Record<ProviderStatus, number> = { online: 0, unknown: 1, offline: 2 };

export function useProviderRows(
  probed: Record<string, ProviderStatus> = {},
  directory: readonly ServerProvider[] = []
): ProviderRow[] {
  const knownProviders = useRoutstrStore((s) => s.knownProviders);
  const { balances } = useBalanceContext();

  const byMint = useMemo(() => {
    const out = new Map<string, number>();
    for (const [url, sats] of Object.entries(spendableMintBalances(balances.byMint))) {
      const key = routstrMintKey(url);
      if (key && sats > 0) out.set(key, sats);
    }
    return out;
  }, [balances]);

  const walletTotal = useMemo(
    () => [...byMint.values()].reduce((sum, sats) => sum + sats, 0),
    [byMint]
  );

  const server = useMemo(
    () => new Map(directory.map((row, index) => [row.baseUrl, { row, rank: index }])),
    [directory]
  );

  const ranked = useMemo(() => {
    const rows: ProviderRow[] = Object.entries(knownProviders).map(([baseUrl, provider]) => {
      const fromServer = server.get(baseUrl);
      // First-hand evidence — this viewing's probe, or a still-fresh one from
      // earlier — beats the directory's cached claim. `resolveProviderStatus`
      // is the single place that rule lives.
      const local = probed[baseUrl] ?? cachedProbe(baseUrl)?.status;
      const status = resolveProviderStatus(local, fromServer?.row.status);
      const decided = (value: ProviderStatus | undefined) =>
        value === 'online' || value === 'offline';
      const statusSource: StatusSource = decided(probed[baseUrl])
        ? 'probe'
        : decided(local)
          ? 'cache'
          : decided(fromServer?.row.status)
            ? 'directory'
            : 'none';
      const accepted = new Set(provider.mints.map(routstrMintKey).filter((url) => url !== null));
      // No published list means no restriction, so every sat is spendable
      // there. An empty intersection means none of it is.
      const spendableSats = provider.mints.length
        ? [...accepted].reduce((sum, mint) => sum + (byMint.get(mint) ?? 0), 0)
        : walletTotal;
      // A provider is unusable for exactly two reasons, and they are asked in
      // that order deliberately. The first — "there is no mint here I can pay
      // it from" — is a comparison between two lists this device already
      // holds, so it is decided in the first frame and never waits on a
      // probe. Only if the wallet CAN pay does reachability get to have an
      // opinion, and `unknown` is not one: a row nobody has reached yet stays
      // choosable rather than being accused of being down.
      const blockedReason =
        provider.mints.length > 0 && spendableSats <= 0
          ? `Redeems ecash only from ${accepted.size === 1 ? 'a mint' : 'mints'} you do not hold`
          : status === 'offline'
            ? 'Not answering right now'
            : null;
      return {
        baseUrl,
        name: provider.name || host(baseUrl),
        nameIsHost: !provider.name || provider.name === host(baseUrl),
        description: provider.description,
        version: provider.version,
        mints: provider.mints,
        e2ee: provider.e2ee,
        pubkey: provider.pubkey,
        status,
        statusSource,
        encryptedModelCount: fromServer?.row.encryptedModelCount ?? null,
        modelCount: fromServer?.row.modelCount ?? null,
        followers: fromServer?.row.followers ?? null,
        spendableSats,
        blockedReason,
      };
    });

    return rows.sort((a, b) => {
      // A provider the wallet cannot pay is not a candidate, whatever the
      // server thinks of it. This is local evidence the directory never had.
      const blocked = Number(a.spendableSats <= 0) - Number(b.spendableSats <= 0);
      if (blocked !== 0) return blocked;
      const reachable = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (reachable !== 0) return reachable;
      const aRank = server.get(a.baseUrl)?.rank;
      const bRank = server.get(b.baseUrl)?.rank;
      // Inside a status band, keep nagg's order verbatim — it already broke
      // ties by encrypted models and by followers.
      if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
      if (aRank !== undefined) return -1;
      if (bRank !== undefined) return 1;
      const e2ee = Number(b.e2ee === true) - Number(a.e2ee === true);
      if (e2ee !== 0) return e2ee;
      if (b.spendableSats !== a.spendableSats) return b.spendableSats - a.spendableSats;
      return a.name.localeCompare(b.name) || a.baseUrl.localeCompare(b.baseUrl);
    });
  }, [knownProviders, byMint, walletTotal, probed, server]);

  // Rank on entry. Discovery may append providers, but asynchronous metadata
  // must not move an existing choice while the user is reaching for it. The
  // one exception is the directory's first arrival: it is the ordering the
  // list is supposed to show, so it re-seats rows once rather than leaving a
  // stale local ranking pinned for the whole session.
  //
  // The seat is adjusted DURING RENDER, not in an effect. An effect commits a
  // frame in which the new directory is paired with the previous order and
  // then immediately replaces it — which is precisely the "it shows something,
  // then the content changes" the list was reported for. React re-runs this
  // component before painting instead, so the re-seat is never on screen.
  // With the directory persisted, the common case does not reach it at all:
  // `server` is already populated on the first render and the initial seat is
  // the server's order.
  const [seat, setSeat] = useState(() => ({
    fromServer: server.size > 0,
    order: ranked.map((row) => row.baseUrl),
  }));
  let seated = seat;
  if (server.size > 0 && !seat.fromServer) {
    seated = { fromServer: true, order: ranked.map((row) => row.baseUrl) };
    setSeat(seated);
  } else {
    const seen = new Set(seat.order);
    const additions = ranked.filter((row) => !seen.has(row.baseUrl)).map((row) => row.baseUrl);
    if (additions.length > 0) {
      seated = { fromServer: seat.fromServer, order: [...seat.order, ...additions] };
      setSeat(seated);
    }
  }
  const order = seated.order;
  const positions = new Map(order.map((url, index) => [url, index]));
  return [...ranked].sort(
    (a, b) =>
      (positions.get(a.baseUrl) ?? order.length) - (positions.get(b.baseUrl) ?? order.length)
  );
}

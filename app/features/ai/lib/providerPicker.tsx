import Icon from 'assets/icons';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { aiLog } from '@/shared/lib/logger';
import { buildProviderInfoHref } from '@/shared/lib/nav/providerInfoRoutes';
import {
  actionMenuPopup,
  dismissActionMenuPopup,
  paramPopup,
  replaceActionMenuPopup,
  type ActionMenuItem,
} from '@/shared/lib/popup';
import { discoverProviders } from '@/shared/lib/routstr/discovery';
import {
  cachedProbe,
  probeProviders,
  type ProviderStatus,
} from '@/shared/lib/routstr/providerHealth';
import { normalizeNodeUrl } from '@/shared/lib/routstr/providers';
import { useRoutstrStore, type KnownProvider } from '@/shared/stores/profile/routstrStore';
import { Pressable } from '@/shared/ui/primitives/Pressable';

import { ProviderAvatar } from '../components/ProviderAvatar';

/**
 * Pick which Routstr provider to pay.
 *
 * A heroui Menu, per the repo's pick-one-of-N convention, built to read like
 * the mint selector's list: a face, a name, what it costs you to use, and a
 * way into its details.
 *
 * Four things make this list trustworthy rather than decorative:
 *
 *  - **It is the whole network.** Providers announce themselves on Nostr as
 *    kind-38421 events and every routstr client reads that kind; asking one
 *    node's `/v1/providers/` was a strictly smaller question, and when that
 *    node was unreachable it returned nothing — which is how a picker that
 *    should list dozens listed one.
 *  - **It does not shrink.** What discovery finds is remembered, so a failed
 *    refresh costs freshness and never the menu.
 *  - **The dot is a real answer.** Each row is probed against `/v1/info` while
 *    the sheet is open; a row nobody has heard from stays unmarked rather than
 *    being drawn as healthy.
 *  - **An unusable row says why.** A provider that takes none of your mints,
 *    or that is not answering, is dimmed with the reason underneath — the same
 *    contract every other disabled option in this app follows. It is never
 *    silently dropped, because "it is not in the list" is not an explanation.
 *
 * There is no "Automatic" row and no recommendation. Choosing who gets paid
 * for AI is not this app's call to make on the user's behalf, so nothing is
 * selected until they select it.
 */

interface Row {
  baseUrl: string;
  name: string;
  description: string | null;
  version: string | null;
  mints: string[];
  e2ee: boolean | null;
  status: ProviderStatus;
}

const host = (baseUrl: string) => baseUrl.replace(/^https:\/\//, '');

const canonicalMint = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();

/** Why a row cannot be chosen, or `null` when it can. Ordered by what the user
 *  can do about it: a mint they could add, then a provider that is simply down. */
function blockedReason(row: Row, heldMints: Set<string>): string | null {
  if (row.mints.length > 0 && !row.mints.some((mint) => heldMints.has(canonicalMint(mint)))) {
    return `Only redeems ecash from ${row.mints.length === 1 ? 'a mint' : 'mints'} you do not hold`;
  }
  if (row.status === 'offline') return 'Not answering right now';
  return null;
}

/** What to say under a usable provider's name — ordered by what changes a
 *  decision: that your money works there, then whether it can answer
 *  privately, then who it is. */
function describeRow(row: Row): string {
  const parts: string[] = [];
  if (row.mints.length > 0) parts.push('Accepts your mint');
  if (row.e2ee) parts.push('End-to-end encrypted models');
  if (parts.length === 0 && row.description) parts.push(row.description);
  if (parts.length === 0) parts.push(host(row.baseUrl));
  return parts.join(' · ');
}

function openDetails(row: Row): void {
  dismissActionMenuPopup();
  router.navigate(buildProviderInfoHref(row.baseUrl, { seedName: row.name }));
}

/**
 * The row's own way in.
 *
 * Present on every row including the dimmed ones — a provider you cannot use
 * yet is exactly the one whose accepted mints you want to read.
 */
function DetailsButton({ row }: { row: Row }) {
  return (
    <Pressable
      testID={`ai-provider-details:${row.baseUrl}`}
      accessibilityLabel={`${row.name} details`}
      accessibilityHint="Opens this provider's details"
      hitSlop={12}
      onPress={() => openDetails(row)}>
      <Icon name="tabler:dots" size={20} />
    </Pressable>
  );
}

function toButton(row: Row, active: string, heldMints: Set<string>): ActionMenuItem {
  const blocked = blockedReason(row, heldMints);
  return {
    text: row.name,
    // `reason` is what the menu renders for a disabled row, and it is why the
    // row is disabled rather than absent.
    ...(blocked ? { disabled: true, reason: blocked } : { description: describeRow(row) }),
    iconNode: <ProviderAvatar name={row.name} baseUrl={row.baseUrl} status={row.status} />,
    selected: row.baseUrl === active,
    suffix: <DetailsButton row={row} />,
    testID: `ai-provider-row:${row.baseUrl}`,
    onPress: (close: () => void) => {
      useRoutstrStore.getState().setUserNode(row.baseUrl);
      paramPopup('ai-provider-switched', { providerName: row.name });
      close();
    },
  };
}

/**
 * Usable providers first, then the ones that need something from the user.
 *
 * Within each group: answering before unproven, then by name. Sorting rather
 * than filtering, so the dimmed rows stay reachable — their details page is
 * where the user learns which mint to add.
 */
function orderRows(rows: Row[], heldMints: Set<string>): Row[] {
  const rank = (row: Row) =>
    (blockedReason(row, heldMints) ? 2 : 0) + (row.status === 'online' ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function rowsFromStore(known: Record<string, KnownProvider>): Row[] {
  return Object.entries(known).map(([baseUrl, provider]) => ({
    baseUrl,
    name: provider.name || host(baseUrl),
    description: provider.description,
    version: provider.version,
    mints: provider.mints,
    e2ee: provider.e2ee,
    status: cachedProbe(baseUrl)?.status ?? 'unknown',
  }));
}

/**
 * The mints the wallet holds, reached lazily.
 *
 * A static import would pull the Coco manager — and the wallet graph behind it
 * — into the picker's module graph for one set of URLs. An empty answer is
 * fine: no row is then blocked on mint grounds, which is better than claiming
 * something false about the user's wallet.
 */
async function heldMintUrls(): Promise<string[]> {
  try {
    const { cocoWalletAdapter } = await import('@/shared/lib/routstr/sdk/walletAdapter');
    const balances = await cocoWalletAdapter.getBalances();
    return Object.entries(balances)
      .filter(([, sats]) => sats > 0)
      .map(([mintUrl]) => mintUrl);
  } catch {
    return [];
  }
}

export async function openProviderPicker(): Promise<void> {
  const state = useRoutstrStore.getState();
  const active = normalizeNodeUrl(state.userNodeBaseUrl ?? '');
  const heldMints = new Set((await heldMintUrls()).map(canonicalMint));

  let rows = rowsFromStore(useRoutstrStore.getState().knownProviders);
  const render = (next: Row[], replace: boolean) => {
    const payload = {
      title: 'AI provider',
      buttons: orderRows(next, heldMints).map((row) => toButton(row, active, heldMints)),
    };
    if (replace) replaceActionMenuPopup(payload);
    else actionMenuPopup(payload);
  };

  aiLog.info('ai.provider_picker.opened', { rows: rows.length, chosen: active !== '' });
  render(rows, false);

  // Everything below refines a menu that is already on screen. Discovery adds
  // providers, probing marks them live; neither is allowed to hold the sheet.
  const seeds = [
    state.nodeBaseUrl,
    state.userNodeBaseUrl,
    ...Object.keys(state.knownProviders),
  ].filter((url): url is string => typeof url === 'string' && url.length > 0);
  const discovered = await discoverProviders(seeds);
  if (discovered.length > 0) {
    useRoutstrStore.getState().rememberProviders(
      Object.fromEntries(
        discovered.map((provider) => [
          provider.baseUrl,
          {
            name: provider.name,
            description: provider.description ?? null,
            version: provider.version ?? null,
            mints: provider.mints,
          },
        ])
      )
    );
    rows = rowsFromStore(useRoutstrStore.getState().knownProviders);
    render(rows, true);
  }

  await probeProviders(
    rows.map((row) => row.baseUrl),
    {
      onResult: (probe) => {
        const index = rows.findIndex((row) => row.baseUrl === probe.baseUrl);
        if (index < 0) return;
        rows = [...rows];
        rows[index] = {
          ...rows[index],
          status: probe.status,
          name: probe.info?.name || rows[index].name,
          version: probe.info?.version ?? rows[index].version,
          mints: probe.info?.mints ?? rows[index].mints,
        };
        // Persist what the probe learned so the next open starts warm, and so
        // a provider's accepted mints survive an announcement that omits them.
        if (probe.info) {
          useRoutstrStore.getState().rememberProviders({
            [probe.baseUrl]: {
              name: probe.info.name,
              description: probe.info.description ?? null,
              version: probe.info.version ?? null,
              mints: probe.info.mints,
            },
          });
        }
        render(rows, true);
      },
    }
  );
}

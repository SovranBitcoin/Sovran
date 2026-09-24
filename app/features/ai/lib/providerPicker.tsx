import { Pressable } from '@/shared/ui/primitives/Pressable';

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
import {
  probeProviders,
  cachedProbe,
  type ProviderStatus,
} from '@/shared/lib/routstr/providerHealth';
import { fetchProviderDirectory, normalizeNodeUrl } from '@/shared/lib/routstr/providers';
import { useRoutstrStore, type KnownProvider } from '@/shared/stores/profile/routstrStore';

import { ProviderAvatar } from '../components/ProviderAvatar';

/**
 * Pick which Routstr provider to pay.
 *
 * A heroui Menu, per the repo's pick-one-of-N convention, built to read like
 * the mint selector's list: a face, a name, what it costs you to use, and a
 * way into its details.
 *
 * Three things make this list trustworthy rather than decorative:
 *
 *  - **It does not shrink.** Providers are remembered in the store, so a
 *    directory fetch that fails loses freshness, not the menu. A picker that
 *    listed twenty-eight and then two is worse than one that never listed any.
 *  - **The dot is a real answer.** Each row is probed against `/v1/info` as
 *    the sheet is open, streaming in; a row nobody has heard from stays
 *    unmarked rather than being drawn as healthy.
 *  - **It says whether you can pay.** A node redeems tokens only from the
 *    mints it publishes. A provider that takes none of yours is shown as
 *    such, because picking it would fail at send time with nothing on screen
 *    to explain why.
 *
 * There is no "Automatic" row. Choosing a provider pins it — nagg's pick is
 * the default until the user expresses one, and handing that default back is
 * a detail that belongs on the provider's own screen, not a permanent entry
 * in a list of real providers.
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

/**
 * What to say under a provider's name.
 *
 * Ordered by what changes a decision: whether your money works there, then
 * whether it can answer privately, then who it is. Version last — it matters
 * to the person debugging, not the person choosing.
 */
function describeRow(row: Row, heldMints: Set<string>): string {
  const parts: string[] = [];
  if (row.mints.length > 0) {
    const accepted = row.mints.filter((mint) => heldMints.has(canonicalMint(mint)));
    parts.push(accepted.length > 0 ? 'Accepts your mint' : 'Accepts none of your mints');
  }
  if (row.e2ee) parts.push('End-to-end encrypted models');
  if (row.status === 'offline') parts.push('Not responding');
  if (parts.length === 0 && row.description) parts.push(row.description);
  if (parts.length === 0) parts.push(host(row.baseUrl));
  return parts.join(' · ');
}

function openDetails(row: Row): void {
  dismissActionMenuPopup();
  router.navigate(buildProviderInfoHref(row.baseUrl, { seedName: row.name }));
}

/** The row's own way in, so details are reachable for every provider rather
 *  than only the one currently selected. */
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
  return {
    text: row.name,
    description: describeRow(row, heldMints),
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

function rowsFromStore(known: Record<string, KnownProvider>): Row[] {
  return Object.entries(known)
    .map(([baseUrl, provider]) => ({
      baseUrl,
      name: provider.name || host(baseUrl),
      description: provider.description,
      version: provider.version,
      mints: provider.mints,
      e2ee: provider.e2ee,
      status: cachedProbe(baseUrl)?.status ?? 'unknown',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The mints the wallet holds, reached lazily.
 *
 * A static import would pull the Coco manager — and the wallet graph behind it
 * — into the picker's module graph for one set of URLs. An empty answer is
 * fine: the rows then simply say nothing about mint compatibility rather than
 * claiming something false.
 */
async function heldMintUrls(): Promise<string[]> {
  try {
    const { cocoWalletAdapter } = await import('@/shared/lib/routstr/sdk/walletAdapter');
    return Object.keys(await cocoWalletAdapter.getBalances());
  } catch {
    return [];
  }
}

export async function openProviderPicker(): Promise<void> {
  const state = useRoutstrStore.getState();
  const active = normalizeNodeUrl(state.userNodeBaseUrl ?? state.nodeBaseUrl ?? '');
  const pinned = state.userNodeBaseUrl != null;

  // The node in use is always a row, even before any directory answers: the
  // provider you are paying must be visible in the list of providers.
  if (state.nodeBaseUrl) {
    const url = normalizeNodeUrl(state.nodeBaseUrl);
    if (!state.knownProviders[url]) state.rememberProviders({ [url]: { name: host(url) } });
  }

  const heldMints = new Set((await heldMintUrls()).map(canonicalMint));

  let rows = rowsFromStore(useRoutstrStore.getState().knownProviders);
  const render = (next: Row[], replace: boolean) => {
    const payload = {
      title: 'AI provider',
      buttons: next.map((row) => toButton(row, active, heldMints)),
      footerButtons: pinned
        ? [
            {
              text: 'Use the recommended provider',
              description: 'Follow whichever provider Sovran currently recommends.',
              icon: 'mdi:brain',
              testID: 'ai-provider-auto',
              onPress: (close: () => void) => {
                useRoutstrStore.getState().setUserNode(null);
                close();
              },
            },
          ]
        : [],
    };
    if (replace) replaceActionMenuPopup(payload);
    else actionMenuPopup(payload);
  };

  aiLog.info('ai.provider_picker.opened', { rows: rows.length, pinned });
  render(rows, false);

  // Everything below refines a menu that is already on screen. Discovery adds
  // providers, probing marks them live; neither is allowed to hold the sheet.
  const discovered = state.nodeBaseUrl ? await fetchProviderDirectory(state.nodeBaseUrl) : [];
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
        // Persist what the probe learned so the next open starts warm, and
        // so a provider's accepted mints survive a directory that omits them.
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

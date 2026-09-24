import { useCallback, useEffect, useMemo, useState } from 'react';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { aiLog } from '@/shared/lib/logger';
import { buildProviderInfoHref } from '@/shared/lib/nav/providerInfoRoutes';
import { paramPopup } from '@/shared/lib/popup';
import { discoverProviders } from '@/shared/lib/routstr/discovery';
import {
  cachedProbe,
  probeProviders,
  type ProviderStatus,
} from '@/shared/lib/routstr/providerHealth';
import { normalizeNodeUrl } from '@/shared/lib/routstr/providers';
import { useRoutstrStore, type KnownProvider } from '@/shared/stores/profile/routstrStore';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { ContactRow, providerIdentity } from '@/shared/ui/composed/ContactRow';
import { List } from '@/shared/ui/composed/List';
import { Screen } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';

import { useHeldMints } from '../hooks/useHeldMints';

/**
 * Choose which Routstr provider to pay.
 *
 * The structural twin of `MintListScreen`, because it answers the same
 * question about the same kind of counterparty: a pushed page of rows, each a
 * face, a name and a subtitle, each with a three-dot button into its details.
 * It used to be a bottom sheet, which meant dismissing one surface to open
 * another every time the user wanted to read about a provider before choosing
 * it — exactly the thing they come here to do.
 *
 * Three properties make the list trustworthy rather than decorative:
 *
 *  - **It is the whole network.** Providers announce themselves on Nostr as
 *    kind-38421 events; asking one node's `/v1/providers/` was a strictly
 *    smaller question, and when that node was down it returned nothing.
 *  - **The dot is a real answer.** Each row is probed against `/v1/info`,
 *    streaming in; a row nobody has heard from stays unmarked rather than
 *    being drawn as healthy.
 *  - **An unusable row says why, and stays.** A provider that redeems ecash
 *    only from mints you do not hold is dimmed with that reason underneath —
 *    the same contract every other disabled row in this app follows. Dropping
 *    it would be the same as refusing to explain.
 *
 * Nothing is selected by default and nothing is recommended. Choosing who gets
 * paid for AI is not this app's decision to make on the user's behalf.
 */

interface Row {
  baseUrl: string;
  name: string;
  description: string | null;
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
    return `Redeems ecash only from ${row.mints.length === 1 ? 'a mint' : 'mints'} you do not hold`;
  }
  if (row.status === 'offline') return 'Not answering right now';
  return null;
}

/** What to say under a usable provider's name — ordered by what changes a
 *  decision: that your money works there, then whether it can answer privately. */
function describeRow(row: Row): string {
  const parts: string[] = [];
  if (row.mints.length > 0) parts.push('Accepts your mint');
  if (row.e2ee) parts.push('End-to-end encrypted models');
  if (parts.length === 0 && row.description) parts.push(row.description);
  if (parts.length === 0) parts.push(host(row.baseUrl));
  return parts.join(' · ');
}

function rowsFromStore(known: Record<string, KnownProvider>): Row[] {
  return Object.entries(known).map(([baseUrl, provider]) => ({
    baseUrl,
    name: provider.name || host(baseUrl),
    description: provider.description,
    mints: provider.mints,
    e2ee: provider.e2ee,
    status: cachedProbe(baseUrl)?.status ?? 'unknown',
  }));
}

const keyExtractor = (row: Row) => row.baseUrl;

export function ProviderListScreen() {
  const background = useThemeColor('background');
  const chosen = useRoutstrStore((s) => s.userNodeBaseUrl);
  const knownProviders = useRoutstrStore((s) => s.knownProviders);
  const nodeBaseUrl = useRoutstrStore((s) => s.nodeBaseUrl);
  const heldMints = useHeldMints();

  const [probed, setProbed] = useState<Record<string, ProviderStatus>>({});

  const rows = useMemo(() => {
    const base = rowsFromStore(knownProviders).map((row) => ({
      ...row,
      status: probed[row.baseUrl] ?? row.status,
    }));
    // Usable first, then answering, then by name. Sorting rather than
    // filtering: a dimmed row's details page is where the user learns which
    // mint to add.
    const rank = (row: Row) =>
      (blockedReason(row, heldMints) ? 2 : 0) + (row.status === 'online' ? 0 : 1);
    return base.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [knownProviders, probed, heldMints]);

  // Discovery and probing both refine a list that is already on screen.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      const state = useRoutstrStore.getState();
      const seeds = [nodeBaseUrl, chosen, ...Object.keys(state.knownProviders)].filter(
        (url): url is string => typeof url === 'string' && url.length > 0
      );
      const discovered = await discoverProviders(seeds);
      if (cancelled) return;
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
      }
      await probeProviders(Object.keys(useRoutstrStore.getState().knownProviders), {
        signal: controller.signal,
        onResult: (probe) => {
          if (cancelled) return;
          setProbed((current) => ({ ...current, [probe.baseUrl]: probe.status }));
          // Persist what the probe learned so the next open starts warm, and
          // so accepted mints survive an announcement that omits them.
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
        },
      });
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [chosen, nodeBaseUrl]);

  const onChoose = useCallback((row: Row) => {
    useRoutstrStore.getState().setUserNode(row.baseUrl);
    aiLog.info('ai.provider.chosen', { status: row.status, mints: row.mints.length });
    paramPopup('ai-provider-switched', { providerName: row.name });
    router.back();
  }, []);

  const onInspect = useCallback((row: Row) => {
    router.navigate(buildProviderInfoHref(row.baseUrl, { seedName: row.name }));
  }, []);

  const activeUrl = normalizeNodeUrl(chosen ?? '');

  const renderItem = ({ item }: { item: Row }) => {
    const blocked = blockedReason(item, heldMints);
    return (
      <ContactRow
        identity={providerIdentity({ baseUrl: item.baseUrl, displayName: item.name })}
        subtitle={blocked ?? describeRow(item)}
        disabled={blocked != null}
        disabledReason={blocked ?? undefined}
        selected={item.baseUrl === activeUrl}
        trailing={
          <CircleActionButton
            icon="tabler:dots"
            systemIcon="ellipsis"
            onPress={() => onInspect(item)}
            testID={`ai-provider-inspect:${item.baseUrl}`}
            accessibilityLabel="Open provider page"
          />
        }
        trailingInteractive
        onPress={() => onChoose(item)}
        testID={`contact-row:provider:${item.baseUrl}`}
      />
    );
  };

  return (
    <Screen
      name="ProviderListScreen"
      scroll="custom"
      bgColor={background}
      footer={
        <BottomButtons>
          <ButtonHandler
            buttons={[
              {
                text: 'Close',
                variant: 'secondary',
                onPress: () => router.back(),
                testID: 'ai-provider-list-close',
              },
            ]}
          />
        </BottomButtons>
      }>
      <List
        screen
        data={rows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerClassName="pt-3"
        ListEmptyComponent={
          <VStack className="items-center px-8 pt-12">
            <Text className="text-center" color="muted">
              Looking for AI providers on the Nostr network…
            </Text>
          </VStack>
        }
      />
    </Screen>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { aiLog } from '@/shared/lib/logger';
import { buildProviderInfoHref } from '@/shared/lib/nav/providerInfoRoutes';
import { paramPopup } from '@/shared/lib/popup';
import { discoverProviders } from '@/shared/lib/routstr/discovery';
import { probeProviders, type ProviderStatus } from '@/shared/lib/routstr/providerHealth';
import { normalizeNodeUrl } from '@/shared/lib/routstr/providers';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { ContactRow, providerIdentity, nostrIdentity } from '@/shared/ui/composed/ContactRow';
import { List } from '@/shared/ui/composed/List';
import { Screen } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';

import { useNostrProfile } from '@/shared/hooks/useNostrProfile';

import { describeProvider, useProviderRows, type ProviderRow } from '../hooks/useProviderRows';

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

const keyExtractor = (row: ProviderRow) => row.baseUrl;

/**
 * One provider.
 *
 * Its own component because each row reads the operator's Nostr profile, and
 * a hook cannot be called inside a list's `renderItem`. The profile is what
 * turns a hostname into a counterparty: the same reputation score and follower
 * count the mint rows carry, from the same cache, so "who is this" is answered
 * the same way everywhere in the app.
 */
function ProviderListRow({
  row,
  selected,
  onChoose,
  onInspect,
}: {
  row: ProviderRow;
  selected: boolean;
  onChoose: (row: ProviderRow) => void;
  onInspect: (row: ProviderRow) => void;
}) {
  const { data: profile } = useNostrProfile(row.pubkey);

  return (
    <ContactRow
      identity={[
        providerIdentity({
          baseUrl: row.baseUrl,
          displayName: row.name,
          spendableSats: row.spendableSats,
          e2ee: row.e2ee === true,
          status: row.status,
        }),
        // Composite, exactly as a mint row pairs its mint with its operator:
        // the provider supplies the face and the name, the operator supplies
        // the reputation.
        ...(row.pubkey ? [nostrIdentity(row.pubkey, profile ?? undefined)] : []),
      ]}
      title={row.name}
      subtitle={row.blockedReason ?? describeProvider(row)}
      disabled={row.blockedReason != null}
      disabledReason={row.blockedReason ?? undefined}
      selected={selected}
      accentPosition="below"
      trailing={
        <CircleActionButton
          icon="tabler:dots"
          systemIcon="ellipsis"
          onPress={() => onInspect(row)}
          testID={`ai-provider-inspect:${row.baseUrl}`}
          accessibilityLabel="Open provider page"
        />
      }
      trailingInteractive
      onPress={() => onChoose(row)}
      testID={`contact-row:provider:${row.baseUrl}`}
    />
  );
}

export function ProviderListScreen() {
  const background = useThemeColor('background');
  const chosen = useRoutstrStore((s) => s.userNodeBaseUrl);
  const nodeBaseUrl = useRoutstrStore((s) => s.nodeBaseUrl);

  const [probed, setProbed] = useState<Record<string, ProviderStatus>>({});
  // The native header floats over the list, so the first rows sit under it
  // unless the list reserves its height. Same spacer the mint list uses.
  const [headerHeight, setHeaderHeight] = useState(0);

  const rows = useProviderRows(probed);

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
                pubkey: provider.pubkey ?? null,
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
                pubkey: probe.info.pubkey ?? null,
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

  const onChoose = useCallback((row: ProviderRow) => {
    useRoutstrStore.getState().setUserNode(row.baseUrl);
    aiLog.info('ai.provider.chosen', {
      status: row.status,
      mints: row.mints.length,
      e2ee: row.e2ee === true,
      spendableSats: row.spendableSats,
    });
    paramPopup('ai-provider-switched', { providerName: row.name });
    router.back();
  }, []);

  const onInspect = useCallback((row: ProviderRow) => {
    router.navigate(buildProviderInfoHref(row.baseUrl, { seedName: row.name }));
  }, []);

  const activeUrl = normalizeNodeUrl(chosen ?? '');

  const renderItem = ({ item }: { item: ProviderRow }) => (
    <ProviderListRow
      row={item}
      selected={item.baseUrl === activeUrl}
      onChoose={onChoose}
      onInspect={onInspect}
    />
  );

  return (
    <Screen
      name="ProviderListScreen"
      scroll="custom"
      bgColor={background}
      onHeaderHeightChange={setHeaderHeight}
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
        extraData={activeUrl}
        // FlashList v2 inserts its scroll anchor before the header component,
        // so a tall spacer over a short list mis-anchors the initial offset.
        // This is a plain top-anchored list; opt out and let the spacer be the
        // sole inset authority.
        maintainVisibleContentPosition={{ disabled: true }}
        contentInsetAdjustmentBehavior="never"
        ListHeaderComponent={<View style={{ height: headerHeight }} />}
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

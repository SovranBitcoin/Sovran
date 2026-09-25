import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { getAiProviders } from '@/shared/lib/apiClient';
import { aiLog } from '@/shared/lib/logger';
import { buildProviderInfoHref } from '@/shared/lib/nav/providerInfoRoutes';
import { paramPopup } from '@/shared/lib/popup';
import { discoverProviders } from '@/shared/lib/routstr/discovery';
import {
  probeProvider,
  probeProviders,
  type ProviderStatus,
} from '@/shared/lib/routstr/providerHealth';
import { normalizeNodeUrl, type ServerProvider } from '@/shared/lib/routstr/providers';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { ContactRow, providerIdentity, nostrIdentity } from '@/shared/ui/composed/ContactRow';
import { List } from '@/shared/ui/composed/List';
import { Screen } from '@/shared/ui/composed/Screen';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';

import { useNostrProfile } from '@/shared/hooks/useNostrProfile';

import { useProviderRows, type ProviderRow } from '../hooks/useProviderRows';

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
 *  - **It is the whole network, immediately.** nagg runs the discovery sweep
 *    continuously and serves the result from `/app/ai-providers`, so the list
 *    paints at once instead of filling in over a Nostr round trip. The app's
 *    own discovery still runs behind it: nagg is a cache, and a cache is
 *    allowed to be wrong.
 *  - **The dot is a real answer.** Each row is probed against `/v1/info`,
 *    streaming in, and what this phone sees overrules what nagg cached — a
 *    provider nagg calls online that we have just failed to reach reads
 *    offline here, and one it calls offline that answers us reads online. A
 *    row nobody has heard from stays `unknown` rather than being drawn as
 *    healthy or accused of being down.
 *  - **An unusable row says why, and stays.** A provider that redeems ecash
 *    only from mints you do not hold is dimmed with that reason underneath —
 *    the same contract every other disabled row in this app follows. Dropping
 *    it would be the same as refusing to explain.
 *
 * Nothing is selected by default and nothing is recommended. Choosing who gets
 * paid for AI is not this app's decision to make on the user's behalf.
 */

const keyExtractor = (row: ProviderRow) => row.baseUrl;

/** A tap is a person waiting, not a background sweep. Short enough that a dead
 *  provider does not hold the choice hostage, long enough for a slow radio. */
const TAP_PROBE_TIMEOUT_MS = 6_000;

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
  checking,
  onChoose,
  onInspect,
}: {
  row: ProviderRow;
  selected: boolean;
  /** This row is being sanity-checked right now, because the user just tapped it. */
  checking: boolean;
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
          encryptedModelCount: row.encryptedModelCount ?? undefined,
          status: row.status,
        }),
        // Composite, exactly as a mint row pairs its mint with its operator:
        // the provider supplies the face and the name, the operator supplies
        // the reputation. nagg's follower count stands in until the profile
        // itself arrives, so the pill doesn't appear late.
        ...(row.pubkey
          ? [
              nostrIdentity(
                row.pubkey,
                profile ?? (row.followers != null ? { followers: row.followers } : undefined)
              ),
            ]
          : []),
      ]}
      title={row.name}
      // Three lines, and no more: who this is, the stats, and — only when it
      // cannot be chosen — why. The subtitle used to restate the balance and
      // the encryption that the stats line already carries, which is how the
      // row grew a fourth line saying nothing new.
      subtitle={null}
      disabled={row.blockedReason != null}
      disabledReason={row.blockedReason ?? undefined}
      selected={selected}
      accentPosition="below"
      trailing={
        checking ? (
          <Spinner size={20} />
        ) : (
          <CircleActionButton
            icon="tabler:dots"
            systemIcon="ellipsis"
            onPress={() => onInspect(row)}
            testID={`ai-provider-inspect:${row.baseUrl}`}
            accessibilityLabel="Open provider page"
          />
        )
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
  const [directory, setDirectory] = useState<readonly ServerProvider[]>([]);
  const [checking, setChecking] = useState<string | null>(null);
  // The native header floats over the list, so the first rows sit under it
  // unless the list reserves its height. Same spacer the mint list uses.
  const [headerHeight, setHeaderHeight] = useState(0);

  const rows = useProviderRows(probed, directory);

  // Which providers this viewing has actually checked. Read synchronously by
  // the tap handler, which cannot wait for a render to learn what the
  // background sweep already found out.
  const probedRef = useRef(probed);
  const record = useCallback((baseUrl: string, status: ProviderStatus) => {
    probedRef.current = { ...probedRef.current, [baseUrl]: status };
    setProbed(probedRef.current);
  }, []);

  // nagg first: it has already done the sweep and the probing, so this is what
  // fills the list. Its failure costs the first paint and nothing else — the
  // discovery below is unchanged and still produces the same list it always
  // did, a few seconds later.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const result = await getAiProviders({ signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.isErr()) {
        // Degrade, do not empty: discovery below still produces the list the
        // app has always produced.
        aiLog.warn('ai.provider.directory_unavailable', { error: result.error });
        return;
      }
      const providers = result.value;
      if (providers.length === 0) return;
      // Into the store first, so the rows exist by the time the order that
      // seats them lands. Empty mint lists are NOT written: locally we read
      // "no published mints" as "accepts any mint", and a directory that
      // simply did not carry them must not turn a restricted provider into an
      // unrestricted one.
      useRoutstrStore.getState().rememberProviders(
        Object.fromEntries(
          providers.map((provider) => [
            provider.baseUrl,
            {
              ...(provider.name ? { name: provider.name } : {}),
              ...(provider.mints.length ? { mints: provider.mints } : {}),
              ...(provider.pubkey ? { pubkey: provider.pubkey } : {}),
            },
          ])
        )
      );
      setDirectory(providers);
      aiLog.info('ai.provider.directory', {
        providers: providers.length,
        online: providers.filter((provider) => provider.status === 'online').length,
      });
    })();
    return () => controller.abort();
  }, []);

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
                // Same rule as the directory above: an announcement that did
                // not carry a mint list must not erase one we already have,
                // because an empty list reads as "accepts any mint".
                ...(provider.mints.length ? { mints: provider.mints } : {}),
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
          record(probe.baseUrl, probe.status);
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
  }, [chosen, nodeBaseUrl, record]);

  /**
   * Choose a provider — after checking it is actually there.
   *
   * nagg's `online` is a cached observation and the sweep may not have reached
   * this row yet, so the moment that answer is about to matter is the moment
   * to verify it. Once per viewing: a row the background sweep already
   * reported, or one a previous tap checked, is taken at its word rather than
   * dialled again while the user waits.
   *
   * A provider that fails the check is not selected. The row it came from is
   * now marked offline, which is the reason, in place, next to the thing the
   * user just tapped.
   */
  const onChoose = useCallback(
    async (row: ProviderRow) => {
      let status = probedRef.current[row.baseUrl];
      if (status === undefined) {
        setChecking(row.baseUrl);
        const probe = await probeProvider(row.baseUrl, { timeoutMs: TAP_PROBE_TIMEOUT_MS });
        setChecking(null);
        status = probe.status;
        record(row.baseUrl, probe.status);
        if (probe.info) {
          useRoutstrStore.getState().rememberProviders({
            [row.baseUrl]: {
              name: probe.info.name,
              description: probe.info.description ?? null,
              version: probe.info.version ?? null,
              mints: probe.info.mints,
              pubkey: probe.info.pubkey ?? null,
            },
          });
        }
      }
      if (status === 'offline') {
        aiLog.info('ai.provider.choice_rejected', { serverStatus: row.status });
        return;
      }
      useRoutstrStore.getState().setUserNode(row.baseUrl);
      aiLog.info('ai.provider.chosen', {
        status,
        mints: row.mints.length,
        encryptedModels: row.encryptedModelCount,
        spendableSats: row.spendableSats,
      });
      paramPopup('ai-provider-switched', { providerName: row.name });
      router.back();
    },
    [record]
  );

  const onInspect = useCallback((row: ProviderRow) => {
    router.navigate(buildProviderInfoHref(row.baseUrl, { seedName: row.name }));
  }, []);

  const activeUrl = normalizeNodeUrl(chosen ?? '');

  const renderItem = ({ item }: { item: ProviderRow }) => (
    <ProviderListRow
      row={item}
      selected={item.baseUrl === activeUrl}
      checking={checking === item.baseUrl}
      onChoose={(row) => void onChoose(row)}
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
        extraData={`${activeUrl}|${checking ?? ''}`}
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
              Looking for AI providers…
            </Text>
          </VStack>
        }
      />
    </Screen>
  );
}

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
  type ProviderProbe,
  type ProviderStatus,
} from '@/shared/lib/routstr/providerHealth';
import { normalizeNodeUrl } from '@/shared/lib/routstr/providers';
import {
  useAiProviderDirectory,
  useAiProviderDirectoryStore,
} from '@/shared/stores/profile/aiProviderDirectoryStore';
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
import { cacheOperatorStats } from '@/shared/lib/nostr/fetchProfiles';

import { useProviderRows, type ProviderRow } from '../hooks/useProviderRows';
import {
  closeProviderListLog,
  openProviderListLog,
  recordListRender,
  recordRowPaint,
} from '../lib/providerListLog';

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
 *    paints at once instead of filling in over a Nostr round trip. That answer
 *    is kept between openings (`aiProviderDirectoryStore`), so the second open
 *    starts in the order the first one finished in rather than ranking the
 *    same rows again in front of the reader. The app's own discovery still
 *    runs behind it: nagg is a cache, and a cache is allowed to be wrong.
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
/** The persisted directory's hydration, as an external store for the gate above the list. */
const subscribeDirectoryHydration = (onChange: () => void) =>
  useAiProviderDirectoryStore.persist.onFinishHydration(onChange);
const readDirectoryHydrated = () => useAiProviderDirectoryStore.persist.hasHydrated();

const TAP_PROBE_TIMEOUT_MS = 6_000;

/** How long probe results pool before the list is told. Short enough to read
 *  as immediate, long enough that a sweep of forty costs a handful of renders
 *  instead of forty. */
const PROBE_COMMIT_MS = 120;

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

  // nagg's follower count stands in until the row's own profile arrives, and
  // the identity below is built from whichever is present — so this is the
  // same expression, read once, rather than a second guess at it.
  // Merged, not replaced: a profile that arrived without a count must not
  // hide the count the directory had, and the directory's count must not
  // hide the score the profile brought.
  const operatorProfile =
    profile || row.followers != null
      ? {
          ...profile,
          ...(profile?.followers === undefined && row.followers != null
            ? { followers: row.followers }
            : {}),
        }
      : undefined;
  // Recorded during render, deliberately: this is a statement about what THIS
  // render put on screen, and an effect would report the value the row settled
  // on rather than each value it showed on the way there.
  recordRowPaint({
    baseUrl: row.baseUrl,
    title: row.name,
    titleIsHost: row.nameIsHost,
    status: row.status,
    statusSource: row.statusSource,
    followers: profile?.followers ?? row.followers ?? null,
    followersFromProfile: typeof profile?.followers === 'number',
    modelCount: row.modelCount,
    encryptedModelCount: row.encryptedModelCount,
    spendableSats: row.spendableSats,
    blocked: row.blockedReason,
  });

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
        // the reputation. Their NAME is no longer read off this — see the
        // subtitle note in `ContactRow` — but their standing still is, and
        // nagg's follower count stands in until the profile arrives so the
        // pill doesn't appear late.
        ...(row.pubkey ? [nostrIdentity(row.pubkey, operatorProfile)] : []),
      ]}
      title={row.name}
      // Two lines: who this is, and what the network makes of the operator —
      // plus, only when it cannot be chosen, why. There is no "Run by" line;
      // it arrived late and changed under the reader, and the pills say what
      // it was really there to say.
      disabled={row.blockedReason != null}
      disabledReason={row.blockedReason ?? undefined}
      selected={selected}
      // Inline, NOT `below`. With the stats on their own band the row is
      // taller than the band the avatar is centred in, so a 44px face sat
      // visibly above the middle of its own row. Inline puts the lines in one
      // column that the avatar and the three-dot button both centre against.
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
  // One clock reading for the whole viewing. Freshness of the saved directory
  // must not change under the user mid-scroll, and a selector that reads the
  // clock itself never re-runs anyway.
  // Opened in the initializer, not an effect: the first render is the one that
  // decides whether the list paints the persisted directory or a blank slate,
  // and an effect runs too late to have recorded it.
  const [openedAt] = useState(() => {
    openProviderListLog();
    return Date.now();
  });
  useEffect(() => closeProviderListLog, []);
  const directory = useAiProviderDirectory(openedAt);
  const [checking, setChecking] = useState<string | null>(null);
  // The native header floats over the list, so the first rows sit under it
  // unless the list reserves its height. Same spacer the mint list uses.
  const [headerHeight, setHeaderHeight] = useState(0);

  // The saved directory decides the order, and it is read from storage
  // asynchronously; until it has, the list shows nothing rather than a local
  // ranking that jumps into nagg's order a moment later.
  const directoryHydrated = useSyncExternalStore(
    subscribeDirectoryHydration,
    readDirectoryHydrated,
    readDirectoryHydrated
  );
  const rows = useProviderRows(probed, directory, directoryHydrated);

  // Every input this render read, by reference. `cause` in the log is the set
  // of these that changed IDENTITY since the previous render — the question
  // being whether a store handed back a new object for a fact that did not
  // change, which costs every row a render and shows the user nothing.
  const knownProviders = useRoutstrStore((s) => s.knownProviders);
  recordListRender({
    order: rows.map((row) => row.baseUrl),
    inputs: {
      directory,
      knownProviders,
      probed,
      rows,
      checking,
      headerHeight,
      chosen,
      nodeBaseUrl,
    },
  });

  // Which providers this viewing has actually checked. Read synchronously by
  // the tap handler, which cannot wait for a render to learn what the
  // background sweep already found out.
  const probedRef = useRef(probed);
  const commitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const record = useCallback((baseUrl: string, status: ProviderStatus) => {
    // The ref moves now, because `onChoose` reads it the moment the user taps
    // and cannot wait for a render.
    probedRef.current = { ...probedRef.current, [baseUrl]: status };
    // The COMMIT is batched. The sweep answers eight at a time and forty rows
    // land over several seconds; committing each answer on its own re-rendered
    // every row once per answer, which is most of the repaints this list was
    // reported for. Nobody can see the difference between forty commits and
    // six, and a row's dot still turns inside a fifth of a second.
    if (commitRef.current) return;
    commitRef.current = setTimeout(() => {
      commitRef.current = null;
      setProbed(probedRef.current);
    }, PROBE_COMMIT_MS);
  }, []);
  useEffect(
    () => () => {
      if (commitRef.current) clearTimeout(commitRef.current);
    },
    []
  );

  // nagg first: it has already done the sweep and the probing, so this is what
  // fills the list. Its failure now costs NOTHING on a repeat open — the saved
  // directory is already on screen — and on a first ever open it costs the
  // first paint and nothing else, because the discovery below still produces
  // the same list it always did, a few seconds later.
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
      // seats them lands. Attributed rather than merged: the guards that used
      // to be hand-written at each of these call sites — "only set `name` if
      // we have one", "never let an empty mint list erase a real one" — are
      // the claim model's job now, and it applies them to every source
      // instead of to the ones somebody remembered.
      useRoutstrStore
        .getState()
        .observeProviders(
          'aggregator',
          Object.fromEntries(
            providers.map((provider) => [
              provider.baseUrl,
              { name: provider.name, mints: provider.mints, pubkey: provider.pubkey },
            ])
          )
        );
      useAiProviderDirectoryStore.getState().rememberDirectory(providers);
      cacheOperatorStats(
        providers.map((provider) => ({
          pubkey: provider.pubkey,
          followers: provider.followers,
          operatesAiProvider: provider.baseUrl,
        }))
      );
      aiLog.info('ai.provider.directory', {
        providers: providers.length,
        online: providers.filter((provider) => provider.status === 'online').length,
        // Rows nagg could not name. Each of these is displayed as its own
        // hostname until this device's probe reaches it, which is the other
        // half of the "a name turned into a URL" report — here the name was
        // never there, rather than having been lost.
        unnamed: providers.filter((provider) => !provider.name).length,
        withPubkey: providers.filter((provider) => provider.pubkey).length,
        withFollowers: providers.filter((provider) => provider.followers != null).length,
        // How long the user was already looking at the list when this landed.
        sinceOpenMs: Date.now() - openedAt,
      });
    })();
    return () => controller.abort();
  }, [openedAt]);

  /**
   * Discovery and probing both refine a list that is already on screen.
   *
   * They run SIDE BY SIDE, which they did not used to. Probing was sequenced
   * behind `discoverProviders` — a relay sweep plus a fan-out of HTTP
   * directory reads — so "is this one answering", and therefore whether a row
   * is usable at all, could not be decided until discovery finished finding
   * rows nobody had asked about. A provider is unusable for exactly two
   * reasons: no mint we can pay it from, which `useProviderRows` answers from
   * the wallet with no network at all, and it is not answering, which is this
   * sweep. Neither of them has any business waiting on discovery.
   */
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const onResult = (probe: ProviderProbe) => {
      if (cancelled) return;
      record(probe.baseUrl, probe.status);
      // Persist what the probe learned so the next open starts warm, and
      // so accepted mints survive an announcement that omits them.
      if (probe.info) {
        // The node describing itself. Nothing outranks it.
        useRoutstrStore.getState().observeProviders('self', {
          [probe.baseUrl]: {
            name: probe.info.name,
            description: probe.info.description,
            version: probe.info.version,
            mints: probe.info.mints,
            pubkey: probe.info.pubkey,
          },
        });
      }
    };

    void (async () => {
      const state = useRoutstrStore.getState();
      const known = Object.keys(state.knownProviders);
      // Pass one, immediately: every row the user can already see.
      const sweeping = probeProviders(known, { signal: controller.signal, onResult });

      const seeds = [nodeBaseUrl, chosen, ...known].filter(
        (url): url is string => typeof url === 'string' && url.length > 0
      );
      const discovered = await discoverProviders(seeds);
      if (cancelled) return;
      const store = useRoutstrStore.getState();
      // Two sources, recorded as two. An announcement is signed by the
      // operator and is therefore the only one of the pair with any standing
      // to say who runs a node; a peer node's directory is one node's notes
      // about another and is worth having for its accepted-mint lists alone.
      // Folding them together is what let a peer's guess overwrite an
      // operator's own name on fourteen rows at once.
      store.observeProviders(
        'announcement',
        Object.fromEntries(
          discovered.announced.map((provider) => [
            provider.baseUrl,
            {
              name: provider.name,
              description: provider.description,
              mints: provider.mints,
              pubkey: provider.pubkey,
            },
          ])
        )
      );
      store.observeProviders(
        'peer',
        Object.fromEntries(
          discovered.peers.map((provider) => [
            provider.baseUrl,
            {
              name: provider.name,
              description: provider.description,
              version: provider.version,
              mints: provider.mints,
            },
          ])
        )
      );
      // Pass two: whatever discovery (or the directory read) added while pass
      // one was running. Queued behind it rather than alongside, so the sweep
      // keeps one concurrency budget instead of two.
      await sweeping;
      if (cancelled) return;
      const seen = new Set(known);
      const added = Object.keys(useRoutstrStore.getState().knownProviders).filter(
        (baseUrl) => !seen.has(baseUrl)
      );
      if (added.length === 0) return;
      await probeProviders(added, { signal: controller.signal, onResult });
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
          useRoutstrStore.getState().observeProviders('self', {
            [row.baseUrl]: {
              name: probe.info.name,
              description: probe.info.description,
              version: probe.info.version,
              mints: probe.info.mints,
              pubkey: probe.info.pubkey,
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
    router.navigate(
      buildProviderInfoHref(row.baseUrl, {
        seedName: row.name,
        seedDescription: row.description ?? undefined,
        seedPubkey: row.pubkey ?? undefined,
        seedMints: row.mints,
        seedFollowers: row.followers ?? undefined,
        seedModelCount: row.modelCount ?? undefined,
        seedEncryptedModelCount: row.encryptedModelCount ?? undefined,
      })
    );
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
          directoryHydrated ? (
            <VStack className="items-center px-8 pt-12">
              <Text className="text-center" color="muted">
                Looking for AI providers…
              </Text>
            </VStack>
          ) : null
        }
      />
    </Screen>
  );
}

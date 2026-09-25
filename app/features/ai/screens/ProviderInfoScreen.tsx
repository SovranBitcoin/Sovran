import { Stack } from 'expo-router';
import Animated from 'react-native-reanimated';
import { ListGroup, PressableFeedback } from 'heroui-native';
import { useCallback, useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { z } from 'zod';

import Icon from '@/assets/icons';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { aiLog } from '@/shared/lib/logger';
import { paramPopup, staticPopup } from '@/shared/lib/popup';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { reclaimRoutstrBalances } from '@/shared/lib/routstr/reclaim';
import {
  fetchNodeInfo,
  fetchProviderModelSummary,
  normalizeNodeUrl,
  type NodeInfo,
  type ProviderModelSummary,
} from '@/shared/lib/routstr/providers';
import { cachedProbe, probeProviders } from '@/shared/lib/routstr/providerHealth';
import { useBalanceContext } from '@cashu/coco-react';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { useIdentityHeader } from '@/shared/ui/composed/IdentityHeader';
import { useNostrProfile } from '@/shared/hooks/useNostrProfile';
import { buildModalProfileHref } from '@/shared/lib/nav/profileRoutes';
import { ContactRow, nostrIdentity } from '@/shared/ui/composed/ContactRow';
import { ProviderAvatar } from '../components/ProviderAvatar';
import { ProviderMintRow } from '../components/ProviderMintRow';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { Notice } from '@/shared/ui/composed/Notice';
import { Screen } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';

/**
 * Details for one Routstr provider, and the actions that stop it holding onto
 * anything of the user's.
 *
 * Mirrors `MintInfoScreen`: one JSON route param, an identity block, grouped
 * detail rows, a footer of actions. The two surfaces answer the same question
 * about different counterparties — "who is this, and what do they have of
 * mine?" — so they should not look like different apps.
 *
 * The section that matters is `Accepted mints`. A payment token minted
 * anywhere else is refused, so that list, not the model catalog, decides
 * whether the user can pay this provider at all.
 */

/** Reputation then reach, the same order and the same pills a mint's operator
 *  row uses. */
const OPERATOR_STATS = ['reputation', 'followers'] as const;

const ParamsSchema = z.object({
  providerInfoEntry: z.string().min(1).max(8192).optional(),
});

const EntrySchema = z.object({
  nodeBaseUrl: z.string().max(512),
  seedName: z.string().max(200).optional(),
});

function parseEntry(raw: string | undefined): { nodeBaseUrl: string; seedName?: string } | null {
  if (!raw) return null;
  try {
    const parsed = EntrySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function ProviderInfoScreen() {
  const foreground = useThemeColor('foreground');
  const background = useThemeColor('background');
  const muted = useThemeColor('muted');
  const params = useRouteParams(ParamsSchema, { where: 'ai-flow.provider' });
  const entry = parseEntry(params?.providerInfoEntry);
  const nodeBaseUrl = entry ? normalizeNodeUrl(entry.nodeBaseUrl) : null;

  const pinned = useRoutstrStore((s) => s.userNodeBaseUrl);
  const legacyAccounts = useRoutstrStore((s) => s.legacyAccounts);
  const isActive = pinned != null && nodeBaseUrl === normalizeNodeUrl(pinned);
  const held = nodeBaseUrl ? legacyAccounts[nodeBaseUrl] : undefined;
  const holdsBalance = held != null && held.reclaimedAt == null;

  const [info, setInfo] = useState<NodeInfo | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'empty'>('loading');
  const [catalog, setCatalog] = useState<ProviderModelSummary | null>(null);
  // Tracked separately from `catalog` because a failed or refused catalog read
  // has to END the skeleton. A null catalog alone cannot say whether the
  // answer is still coming or never arrived, and a placeholder that waits
  // forever is worse than no placeholder at all.
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'empty'>('loading');

  // Who runs this node. `/v1/info` publishes an npub; discovery records the
  // key that signed the announcement. Either way the profile read is the same
  // one every other identity in this app goes through.
  const knownProvider = useRoutstrStore((s) =>
    nodeBaseUrl ? s.knownProviders[nodeBaseUrl] : undefined
  );
  const operatorPubkey = info?.pubkey ?? knownProvider?.pubkey ?? null;
  const { data: operatorProfile, isLoading: operatorLoading } = useNostrProfile(operatorPubkey);
  const [status, setStatus] = useState(() =>
    nodeBaseUrl ? (cachedProbe(nodeBaseUrl)?.status ?? 'unknown') : ('unknown' as const)
  );

  // Mints the wallet actually holds, so the accepted list can say which of
  // them are yours rather than listing URLs you cannot act on.
  const { balances } = useBalanceContext();
  // What the wallet can actually spend HERE — the sum across the mints this
  // provider redeems, not the wallet total, which says nothing about whether
  // this particular provider can be paid.
  const spendableSats = (info?.mints ?? []).reduce(
    (sum, mint) =>
      sum + amountToNumber(balances.byMint[mint.trim().replace(/\/+$/, '')]?.total ?? undefined),
    0
  );

  const heldMints = new Set(
    Object.entries(balances.byMint)
      .filter(([, snapshot]) => amountToNumber(snapshot?.total) > 0)
      .map(([url]) => url.trim().replace(/\/+$/, '').toLowerCase())
  );

  useEffect(() => {
    if (!nodeBaseUrl) return;
    let cancelled = false;
    setState('loading');
    fetchNodeInfo(nodeBaseUrl)
      .then((next) => {
        if (cancelled) return;
        setInfo(next);
        // A node that does not describe itself is an OLD node, not a broken
        // one — routstr-core's own discovery falls back the same way.
        setState(next ? 'ready' : 'empty');
      })
      .catch(() => {
        if (!cancelled) setState('empty');
      });
    return () => {
      cancelled = true;
    };
  }, [nodeBaseUrl]);

  // The catalog costs three quarters of a megabyte, which is why the picker
  // never fetches it. Here the user has asked about this one provider, so it
  // is fair — and what it learns is recorded, so the picker can show "end-to-
  // end encrypted" afterwards without ever paying for it itself.
  useEffect(() => {
    if (!nodeBaseUrl) return;
    let cancelled = false;
    setCatalogState('loading');
    void fetchProviderModelSummary(nodeBaseUrl)
      .then((summary) => {
        if (cancelled) return;
        if (!summary) {
          setCatalogState('empty');
          return;
        }
        setCatalog(summary);
        setCatalogState('ready');
        useRoutstrStore
          .getState()
          .observeProviders('catalog', { [nodeBaseUrl]: { e2ee: summary.e2ee } });
      })
      .catch(() => {
        if (!cancelled) setCatalogState('empty');
      });
    const controller = new AbortController();
    void probeProviders([nodeBaseUrl], {
      signal: controller.signal,
      onResult: (probe) => {
        if (!controller.signal.aborted) setStatus(probe.status);
      },
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nodeBaseUrl]);

  const onCopy = useCallback(() => {
    if (!nodeBaseUrl) return;
    // Same as the mint address row: the copy itself is the feedback.
    void Clipboard.setStringAsync(nodeBaseUrl);
  }, [nodeBaseUrl]);

  const onUse = useCallback(() => {
    if (!nodeBaseUrl) return;
    useRoutstrStore.getState().setUserNode(nodeBaseUrl);
    paramPopup('ai-provider-switched', { providerName: info?.name ?? nodeBaseUrl });
    router.back();
  }, [nodeBaseUrl, info?.name]);

  const onReclaim = useCallback(async () => {
    const outcome = await reclaimRoutstrBalances();
    aiLog.info('ai.provider_info.reclaimed', { ...outcome });
    // The sweep is idempotent and covers every provider at once, so the honest
    // report is what came home, not what this one node returned.
    staticPopup(outcome.reclaimed > 0 ? 'routstr-reclaim-done' : 'routstr-reclaim-empty');
  }, []);

  const displayName =
    info?.name ?? entry?.seedName ?? (nodeBaseUrl ?? '').replace(/^https:\/\//, '');

  // The same scroll handoff the mint details page uses: the identity rides in
  // the navigation bar once the name band scrolls away, so a provider page and
  // a mint page are the same surface answering the same question about
  // different counterparties. `person` rather than `mint` because a Routstr
  // node publishes no icon — the seeded avatar IS its face, and it is the same
  // one the picker draws.
  const morph = useIdentityHeader({
    identity: { kind: 'person', name: displayName, seed: nodeBaseUrl ?? '' },
    title: 'Provider details',
    collapseAt: 110,
  });

  if (!nodeBaseUrl) {
    return (
      <Screen name="ProviderInfoScreen" bgColor={background}>
        <Notice
          status="warning"
          title="No provider"
          description="This link has no provider in it."
        />
      </Screen>
    );
  }

  return (
    <Screen
      name="ProviderInfoScreen"
      scroll="animated"
      scrollY={morph.scrollY}
      headerBand={morph.headerBand}
      bgColor={background}
      footer={
        <BottomButtons>
          <ButtonHandler
            buttons={[
              {
                text: 'Close',
                variant: 'secondary',
                onPress: () => router.back(),
                testID: 'ai-provider-info-close',
              },
              ...(isActive
                ? []
                : [
                    {
                      text: 'Use this provider',
                      variant: 'primary' as const,
                      onPress: onUse,
                      testID: 'ai-provider-info-use',
                    },
                  ]),
            ]}
          />
        </BottomButtons>
      }>
      <Stack.Screen options={{ title: 'Provider details', headerTitle: morph.headerTitle }} />

      {morph.probe}
      <VStack className="w-full items-center pb-4 pt-6">
        <Animated.View className="items-center" style={morph.contentStyle}>
          <ProviderAvatar name={displayName} baseUrl={nodeBaseUrl} status={status} size={70} />
          <Text
            bold
            size={22}
            numberOfLines={2}
            className="mt-3 text-center"
            testID="ai-provider-info-name">
            {displayName}
          </Text>
        </Animated.View>
        {/* The face and the name are already right: the avatar is seeded from
            the URL and the name comes in on the link, so neither has a loading
            state to draw. The description is the one thing on this band that
            arrives over the wire, so it — and only it — reserves a line. */}
        {state === 'loading' ? (
          <>
            <Spacer size={4} />
            <Text
              loading
              size={14}
              color={muted}
              className="text-center"
              placeholder="A node serving frontier models, paid in ecash"
              testID="ai-provider-info-description-skeleton"
            />
          </>
        ) : info?.description ? (
          <>
            <Spacer size={4} />
            <Text size={14} color={muted} className="text-center">
              {info.description}
            </Text>
          </>
        ) : null}
      </VStack>

      {state === 'empty' ? (
        <>
          <Notice
            status="info"
            title="This provider does not describe itself"
            description="Older nodes do not serve an info endpoint. It can still be used."
          />
          <Spacer size={12} />
        </>
      ) : null}

      <Section title="Provider address">
        <ListGroup variant="secondary">
          <PressableFeedback onPress={onCopy} testID="ai-provider-info-url-copy">
            <PressableFeedback.Scale>
              <ListGroup.Item disabled>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>{nodeBaseUrl}</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>Tap to copy</ListGroup.ItemDescription>
                </ListGroup.ItemContent>
              </ListGroup.Item>
            </PressableFeedback.Scale>
            <PressableFeedback.Ripple />
          </PressableFeedback>
        </ListGroup>
      </Section>

      {/* Accepted mints — the section that decides whether this page is
          actionable at all, so it is the one that must not appear from
          nowhere. Two rows while the read is out: enough to establish that a
          list is coming and where it starts, without pretending to know how
          long it is. */}
      <SkeletonContentCrossfade
        loading={state === 'loading'}
        visualKey="provider-info-mints"
        visualSurface="provider-info"
        testID="ai-provider-info-mints"
        renderSkeleton={() => (
          <Section title="Accepted mints">
            <ListGroup variant="secondary">
              <ProviderMintRow mintUrl="" loading />
              <ProviderMintRow mintUrl="" loading />
            </ListGroup>
          </Section>
        )}
        renderContent={() =>
          info?.mints.length ? (
            <Section title={`Accepted mints · ${spendableSats.toLocaleString()} sat spendable`}>
              {info.mints.every(
                (mint) => !heldMints.has(mint.trim().replace(/\/+$/, '').toLowerCase())
              ) ? (
                <>
                  <Notice
                    status="warning"
                    title="You cannot pay this provider yet"
                    description="It redeems payment only from the mints below, and your wallet holds none of them."
                  />
                  <Spacer size={8} />
                </>
              ) : null}
              <ListGroup variant="secondary">
                {info.mints.map((mint) => (
                  <ProviderMintRow key={mint} mintUrl={mint} />
                ))}
              </ListGroup>
            </Section>
          ) : null
        }
      />

      {/* Models: always exactly two rows — a count, and the encryption answer
          — so the skeleton is the same two rows and the section never changes
          height when the catalog lands. */}
      <SkeletonContentCrossfade
        loading={catalogState === 'loading'}
        visualKey="provider-info-models"
        visualSurface="provider-info"
        testID="ai-provider-info-models"
        renderSkeleton={() => (
          <Section title="Models">
            <ListGroup variant="secondary">
              <ListGroup.Item disabled testID="ai-provider-model-count-skeleton">
                <ListGroup.ItemContent>
                  <Text loading medium size={16} placeholder="582 models" />
                </ListGroup.ItemContent>
              </ListGroup.Item>
              <ListGroup.Item disabled testID="ai-provider-model-e2ee-skeleton">
                <ListGroup.ItemContent>
                  <Text loading medium size={16} placeholder="End-to-end encrypted" />
                  <Text
                    loading
                    size={14}
                    color={muted}
                    placeholder="This provider can read every request it forwards."
                  />
                </ListGroup.ItemContent>
              </ListGroup.Item>
            </ListGroup>
          </Section>
        )}
        renderContent={() =>
          catalog ? (
            <Section title="Models">
              <ListGroup variant="secondary">
                <ListGroup.Item disabled>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>
                      {catalog.count.toLocaleString()} models
                    </ListGroup.ItemTitle>
                  </ListGroup.ItemContent>
                </ListGroup.Item>
                <ListGroup.Item disabled>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>End-to-end encrypted</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>
                      {catalog.e2ee
                        ? 'Some models run in an enclave this provider cannot read into.'
                        : 'This provider can read every request it forwards.'}
                    </ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  {catalog.e2ee ? (
                    <Icon name="mdi:shield-check" size={18} color={foreground} />
                  ) : null}
                </ListGroup.Item>
              </ListGroup>
            </Section>
          ) : null
        }
      />

      {info?.version || info?.npub ? (
        <Section title="Identity">
          <ListGroup variant="secondary">
            {info.version ? (
              <ListGroup.Item disabled>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>Version</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>{info.version}</ListGroup.ItemDescription>
                </ListGroup.ItemContent>
              </ListGroup.Item>
            ) : null}
          </ListGroup>
        </Section>
      ) : null}

      {operatorPubkey ? (
        <Section title="Operator">
          {/* The same row the mint page gives a mint's operator: a face, a
              name, their reputation and reach, and a way through to the
              profile. An npub string is an identifier, not an identity — it
              tells the user nothing about who they are about to pay. */}
          <ContactRow
            identity={nostrIdentity(operatorPubkey, operatorProfile ?? undefined)}
            loading={operatorLoading}
            stats={OPERATOR_STATS}
            accentPosition="below"
            onPress={() => router.push(buildModalProfileHref({ pubkey: operatorPubkey }))}
            testID="ai-provider-info-operator"
          />
        </Section>
      ) : null}

      {holdsBalance ? (
        <Section title="Balance held here">
          <Notice
            status="warning"
            title="This provider is holding a balance"
            description="Sovran now pays per request, so nothing needs to sit here. Reclaim moves it back into your wallet."
          />
          <Spacer size={8} />
          <ButtonHandler
            buttons={[
              {
                text: 'Reclaim to wallet',
                variant: 'primary',
                onPress: onReclaim,
                testID: 'ai-provider-info-reclaim',
              },
            ]}
          />
        </Section>
      ) : null}

      <Spacer size={24} />
    </Screen>
  );
}

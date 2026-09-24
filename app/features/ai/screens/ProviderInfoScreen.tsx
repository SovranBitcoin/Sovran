import { Stack } from 'expo-router';
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
import { fetchNodeInfo, normalizeNodeUrl, type NodeInfo } from '@/shared/lib/routstr/providers';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { Notice } from '@/shared/ui/composed/Notice';
import { Screen } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
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

  const displayName = info?.name ?? entry?.seedName ?? nodeBaseUrl.replace(/^https:\/\//, '');

  return (
    <Screen
      name="ProviderInfoScreen"
      scroll="auto"
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
      <Stack.Screen options={{ title: 'Provider details' }} />

      <VStack className="items-center py-4">
        <Icon name="humbleicons:url" size={36} color={foreground} />
        <Spacer size={8} />
        <Text bold size={22} testID="ai-provider-info-name">
          {displayName}
        </Text>
        {info?.description ? (
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

      {info?.mints.length ? (
        <Section title="Accepted mints">
          <ListGroup variant="secondary">
            {info.mints.map((mint) => (
              <ListGroup.Item key={mint} disabled>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>{mint.replace(/^https:\/\//, '')}</ListGroup.ItemTitle>
                </ListGroup.ItemContent>
              </ListGroup.Item>
            ))}
          </ListGroup>
        </Section>
      ) : null}

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
            {info.npub ? (
              <ListGroup.Item disabled>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>Operator</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>{info.npub}</ListGroup.ItemDescription>
                </ListGroup.ItemContent>
              </ListGroup.Item>
            ) : null}
          </ListGroup>
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

import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
/**
 * @fileoverview Network configuration — the three tiers of the resilient Nostr
 * data layer (nagg → Primal cache → raw relays) with live health, plus the
 * active profile's NIP-65 relay list (add/remove, read/write markers, publish).
 *
 * Each tier has an enable/disable switch (a disabled tier drops out of the
 * facade's fallback chain) and a live Online/Offline badge from
 * `useNostrTierHealth`. Toggling a tier does not change the fallback logic — it
 * only sets the persisted preference the data layer reads.
 */
import React from 'react';
import { RefreshControl, View } from 'react-native';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { ListGroup, PressableFeedback, Separator } from 'heroui-native';
import { Switch } from '@/shared/ui/primitives/Switch';

import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRelayHealth } from '@/shared/hooks/useRelayHealth';
import { useNostrTierHealth } from '@/shared/hooks/useNostrTierHealth';
import { type TierStatus } from '@/shared/lib/nostr/tierHealth';
import { useLifecycleLogger } from '@/shared/lib/logger';
import { backendConfig } from '@/shared/config/backend';
import { Section } from '@/shared/ui/composed/Section';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Badge } from '@/shared/ui/primitives/Badge';
import { Text } from '@/shared/ui/primitives/Text';

import { RelayListSettings } from '../components/RelayListSettings';

const VERTEX_CREDITS_DESCRIPTION =
  "Uses your Nostr identity's free Vertex credits to refresh reputation scores for everyone. Vertex and nagg see which profiles you look up; your keys never leave the device.";

export function SettingsNetworkScreen() {
  useLifecycleLogger('SettingsNetworkScreen');
  const { ndk } = useNDK();
  const ownPubkey = useNostrKeysContext().keys?.pubkey;
  const vertexCreditsEnabled = useSettingsStore((s) => s.vertexCreditsEnabled);
  const setVertexCreditsEnabled = useSettingsStore((s) => s.setVertexCreditsEnabled);
  const naggTierEnabled = useSettingsStore((s) => s.naggTierEnabled);
  const setNaggTierEnabled = useSettingsStore((s) => s.setNaggTierEnabled);
  const primalHosts = backendConfig.primalCacheUrls;
  const primalHostsDisabled = useSettingsStore((st) => st.primalHostsDisabled);
  const setPrimalHostEnabled = useSettingsStore((st) => st.setPrimalHostEnabled);
  const primalTierEnabled = useSettingsStore((s) => s.primalTierEnabled);
  const setPrimalTierEnabled = useSettingsStore((s) => s.setPrimalTierEnabled);
  const relayTierEnabled = useSettingsStore((s) => s.relayTierEnabled);
  const setRelayTierEnabled = useSettingsStore((s) => s.setRelayTierEnabled);
  const health = useRelayHealth();
  const tierHealth = useNostrTierHealth(health);

  const [mutedColor, dangerColor] = useThemeColor(['muted', 'danger'] as const);
  const [successColor] = useThemeColor(['success'] as const);

  // Cache hosts get the same dot vocabulary as relays, so "which one is down"
  // reads the same way in both lists. The tier badge above only says whether
  // ANY host answered — without these a dead cache hides behind a healthy one.
  // `disabled` is red under the row's 40% opacity: the user switched it off, so
  // it is not carrying traffic, which is the question the dot answers.
  const tierStatusColor: Record<TierStatus, string> = {
    online: successColor,
    offline: dangerColor,
    checking: mutedColor,
    disabled: dangerColor,
  };

  const tiers = [
    {
      id: 'nagg',
      name: 'nagg',
      description: 'Ranked, fully bundled feeds',
      status: tierHealth.nagg,
      enabled: naggTierEnabled,
      onToggle: setNaggTierEnabled,
    },
    {
      id: 'primal',
      name: 'Primal cache',
      // The host rows below already show how many are on and in what order, so
      // the tier line does not repeat it.
      description: primalHosts.length > 1 ? 'Public fallback, tried in order' : 'Public fallback',
      status: tierHealth.primal,
      enabled: primalTierEnabled,
      onToggle: setPrimalTierEnabled,
    },
    {
      id: 'relay',
      name: 'Raw relays',
      description: 'Decentralized floor',
      status: tierHealth.relay,
      enabled: relayTierEnabled,
      onToggle: setRelayTierEnabled,
    },
  ];

  return (
    <ScreenWrapper name="SettingsNetworkScreen" scroll="custom" safeArea="scroll">
      <ScreenScrollView
        className="px-4"
        bottomSpacing={32}
        refreshControl={
          <RefreshControl refreshing={tierHealth.isRefreshing} onRefresh={tierHealth.refresh} />
        }>
        <Section title="Data layer">
          <ListGroup variant="secondary">
            {tiers.map((tier, index) => (
              <React.Fragment key={tier.id}>
                {index > 0 ? <Separator className="mx-4" /> : null}
                <ListGroup.Item className={tier.enabled ? undefined : 'opacity-40'}>
                  <ListGroup.ItemContent>
                    <View className="flex-row items-center gap-2">
                      <ListGroup.ItemTitle>{tier.name}</ListGroup.ItemTitle>
                      <TierHealthBadge status={tier.status} checkingColor={mutedColor} />
                    </View>
                    <ListGroup.ItemDescription>{tier.description}</ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <Switch
                      testID={`settings-network-tier-${tier.id}`}
                      accessibilityLabel={`Use ${tier.name}`}
                      isSelected={tier.enabled}
                      onSelectedChange={tier.onToggle}
                    />
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
                {/* Per-host switches, only when there is a choice to make. The
                    tier switch above still wins: turning the tier off disables
                    every host regardless of its own state. */}
                {tier.id === 'primal' && primalHosts.length > 1
                  ? primalHosts.map((url) => {
                      const hostEnabled = !primalHostsDisabled.includes(url);
                      return (
                        <View
                          key={url}
                          className={`flex-row items-center gap-2 py-2 pl-9 pr-4 ${
                            tier.enabled && hostEnabled ? '' : 'opacity-40'
                          }`}>
                          <StatusDot
                            color={
                              tierStatusColor[
                                hostEnabled
                                  ? (tierHealth.primalHosts[url] ?? 'checking')
                                  : 'disabled'
                              ]
                            }
                          />
                          <Text size={13} numberOfLines={1} className="flex-1">
                            {hostLabel(url)}
                          </Text>
                          <Switch
                            testID={`settings-network-primal-host-${url}`}
                            accessibilityLabel={`Use ${hostLabel(url)}`}
                            isSelected={hostEnabled}
                            isDisabled={!tier.enabled}
                            onSelectedChange={(next) => setPrimalHostEnabled(url, next)}
                          />
                        </View>
                      );
                    })
                  : null}
              </React.Fragment>
            ))}
          </ListGroup>
        </Section>

        <Section title="Reputation">
          <ListGroup variant="secondary">
            <PressableFeedback
              animation={false}
              testID="settings-vertex-credits-toggle"
              accessible
              accessibilityRole="switch"
              accessibilityLabel="Refresh reputation with my Nostr credits"
              accessibilityHint={VERTEX_CREDITS_DESCRIPTION}
              accessibilityState={{ checked: vertexCreditsEnabled }}
              onPress={() => setVertexCreditsEnabled(!vertexCreditsEnabled)}>
              <ListGroup.Item disabled>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>
                    Refresh reputation with my Nostr credits
                  </ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>
                    {VERTEX_CREDITS_DESCRIPTION}
                  </ListGroup.ItemDescription>
                </ListGroup.ItemContent>
                <ListGroup.ItemSuffix>
                  <View
                    pointerEvents="none"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants">
                    <Switch isSelected={vertexCreditsEnabled} />
                  </View>
                </ListGroup.ItemSuffix>
              </ListGroup.Item>
            </PressableFeedback>
          </ListGroup>
        </Section>

        <RelayListSettings key={ownPubkey} ndk={ndk} pubkey={ownPubkey} health={health} />
      </ScreenScrollView>
    </ScreenWrapper>
  );
}

function TierHealthBadge({ status, checkingColor }: { status: TierStatus; checkingColor: string }) {
  switch (status) {
    case 'online':
      return (
        <Badge variant="success" icon="mdi:check-circle" size={11}>
          Online
        </Badge>
      );
    case 'offline':
      return (
        <Badge variant="error" icon="mdi:close-circle" size={11}>
          Offline
        </Badge>
      );
    case 'checking':
      return (
        <Badge variant="secondary" color={checkingColor} icon="mdi:loading" size={11}>
          Checking
        </Badge>
      );
    case 'disabled':
      return null;
  }
}

/** The 8px health dot shared by the cache-host rows and the relay rows. */
function StatusDot({ color }: { color: string }) {
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;
}

/** `wss://cache1.primal.net/v1` → `cache1.primal.net`, the part worth reading. */
function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^wss?:\/\//, '');
  }
}

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
import { urlHostLabel } from '@/shared/lib/url';
import { backendConfig } from '@/shared/config/backend';
import { Section } from '@/shared/ui/composed/Section';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Badge } from '@/shared/ui/primitives/Badge';
import { Text } from '@/shared/ui/primitives/Text';

import { RelayListSettings } from '../components/RelayListSettings';
import { isAuditorEnabled, MINT_AUDITORS } from '@/shared/lib/cashu/auditors/registry';

const VERTEX_CREDITS_DESCRIPTION =
  "Uses your Nostr identity's free Vertex credits, directly over wss://relay.vertexlab.io, to improve people search and look up profiles. Vertex sees which names you search for and which profiles you open; your keys never leave the device.";

export function SettingsNetworkScreen() {
  useLifecycleLogger('SettingsNetworkScreen');
  const { ndk } = useNDK();
  const ownPubkey = useNostrKeysContext().keys?.pubkey;
  const vertexCreditsEnabled = useSettingsStore((s) => s.vertexCreditsEnabled);
  const setVertexCreditsEnabled = useSettingsStore((s) => s.setVertexCreditsEnabled);
  const primalHosts = backendConfig.primalCacheUrls;
  const primalHostsDisabled = useSettingsStore((st) => st.primalHostsDisabled);
  const setPrimalHostEnabled = useSettingsStore((st) => st.setPrimalHostEnabled);
  const primalTierEnabled = useSettingsStore((s) => s.primalTierEnabled);
  const setPrimalTierEnabled = useSettingsStore((s) => s.setPrimalTierEnabled);
  const relayTierEnabled = useSettingsStore((s) => s.relayTierEnabled);
  const setRelayTierEnabled = useSettingsStore((s) => s.setRelayTierEnabled);
  const disabledMintAuditors = useSettingsStore((s) => s.disabledMintAuditors);
  const enabledMintAuditors = useSettingsStore((s) => s.enabledMintAuditors);
  const setMintAuditorEnabled = useSettingsStore((s) => s.setMintAuditorEnabled);
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
      id: 'primal',
      name: 'Primal cache',
      // The host rows below already show how many are on and in what order, so
      // the tier line does not repeat it.
      description: primalHosts.length > 1 ? 'Public cache, tried in order' : 'Public cache',
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
                <SwitchRow
                  testID={`settings-network-tier-${tier.id}`}
                  label={`Use ${tier.name}`}
                  hint={tier.description}
                  selected={tier.enabled}
                  onToggle={tier.onToggle}>
                  <ListGroup.ItemContent>
                    <View className="flex-row items-center gap-2">
                      <ListGroup.ItemTitle>{tier.name}</ListGroup.ItemTitle>
                      <TierHealthBadge status={tier.status} checkingColor={mutedColor} />
                    </View>
                    <ListGroup.ItemDescription>{tier.description}</ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                </SwitchRow>
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
                            {urlHostLabel(url)}
                          </Text>
                          <Switch
                            testID={`settings-network-primal-host-${url}`}
                            accessibilityLabel={`Use ${urlHostLabel(url)}`}
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

        <Section title="People search">
          <ListGroup variant="secondary">
            <PressableFeedback
              animation={false}
              testID="settings-vertex-credits-toggle"
              accessible
              accessibilityRole="switch"
              accessibilityLabel="Use my Nostr credits for people search"
              accessibilityHint={VERTEX_CREDITS_DESCRIPTION}
              accessibilityState={{ checked: vertexCreditsEnabled }}
              onPress={() => setVertexCreditsEnabled(!vertexCreditsEnabled)}>
              <ListGroup.Item disabled>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>Use my Nostr credits for people search</ListGroup.ItemTitle>
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

        <Section title="Mint auditors">
          <ListGroup variant="secondary">
            {MINT_AUDITORS.map((auditor, index) => {
              const enabled = isAuditorEnabled(
                auditor.id,
                disabledMintAuditors,
                enabledMintAuditors
              );
              return (
                <React.Fragment key={auditor.id}>
                  {index > 0 ? <Separator className="mx-4" /> : null}
                  <SwitchRow
                    testID={`settings-mint-auditor-${auditor.id}`}
                    label={`Use ${auditor.name}`}
                    hint={auditor.description}
                    selected={enabled}
                    onToggle={(next) => setMintAuditorEnabled(auditor.id, next)}>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>{auditor.name}</ListGroup.ItemTitle>
                      <ListGroup.ItemDescription>{auditor.description}</ListGroup.ItemDescription>
                    </ListGroup.ItemContent>
                  </SwitchRow>
                </React.Fragment>
              );
            })}
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

/**
 * A settings row whose whole width toggles its switch, like the people-search
 * row above and `SettingsToggleItem`: one target, read as one switch. Off rows
 * are dimmed but stay tappable, since tapping is how they are turned back on.
 */
function SwitchRow({
  testID,
  label,
  hint,
  selected,
  onToggle,
  children,
}: {
  testID: string;
  label: string;
  hint: string;
  selected: boolean;
  onToggle: (next: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <PressableFeedback
      animation={false}
      testID={testID}
      accessible
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: selected }}
      onPress={() => onToggle(!selected)}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled className={selected ? undefined : 'opacity-40'}>
          {children}
          <ListGroup.ItemSuffix>
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
              <Switch isSelected={selected} />
            </View>
          </ListGroup.ItemSuffix>
        </ListGroup.Item>
      </PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
}

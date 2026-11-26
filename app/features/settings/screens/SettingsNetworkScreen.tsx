import { useNostrClient } from '@/runtime/nostrClient';
import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
/**
 * @fileoverview Network configuration — the three tiers of the resilient Nostr
 * data layer (nagg → Primal cache → raw relays) with live health, plus the
 * active profile's NIP-65 relay list (add/remove, read/write markers, publish).
 *
 * Built from the shared Settings rows. Each tier ("Fast cache", "Relays") has a
 * whole-row switch (a disabled tier drops out of the facade's fallback chain)
 * and a live Online/Offline badge from `useNostrTierHealth`. Toggling a tier
 * does not change the fallback logic — it only sets the persisted preference
 * the data layer reads.
 */
import React from 'react';
import { RefreshControl } from 'react-native';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { ListGroup, Separator } from '@/shared/ui/composed/ListGroup';

import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRelayHealth } from '@/shared/hooks/useRelayHealth';
import { useNostrTierHealth } from '@/shared/hooks/useNostrTierHealth';
import { primalHostStatus, type TierStatus } from '@/shared/lib/nostr/tierHealth';
import { useLifecycleLogger } from '@/shared/lib/logger';
import { urlHostLabel } from '@/shared/lib/url';
import { backendConfig } from '@/shared/config/backend';
import { Section } from '@/shared/ui/composed/Section';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Badge } from '@/shared/ui/primitives/Badge';
import { View } from '@/shared/ui/primitives/View/View';
import { SettingsToggleItem } from '@/shared/ui/composed/SettingsRows';

import { RelayListSettings } from '../components/RelayListSettings';
import { isAuditorEnabled, MINT_AUDITORS } from '@/shared/lib/cashu/auditors/registry';

const VERTEX_CREDITS_DESCRIPTION =
  "Uses your Nostr identity's free Vertex credits, directly over wss://relay.vertexlab.io, to improve people search and look up profiles. Vertex sees which names you search for and which profiles you open; your keys never leave the device.";

const TIER_STATUS_WORDS: Record<TierStatus, string> = {
  online: 'Online',
  offline: 'Offline',
  checking: 'Checking',
  disabled: 'Off',
};

/** What a tier's badge says, for the row's label; a disabled tier draws none. */
const spokenTierStatus = (status: TierStatus) =>
  status === 'disabled' ? undefined : TIER_STATUS_WORDS[status];

export function SettingsNetworkScreen() {
  useLifecycleLogger('SettingsNetworkScreen');
  const { client } = useNostrClient();
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

  const mutedColor = useThemeColor('muted');

  return (
    <ScreenWrapper name="SettingsNetworkScreen" scroll="custom" safeArea="scroll">
      <ScreenScrollView
        className="px-4"
        bottomSpacing={32}
        refreshControl={
          <RefreshControl refreshing={tierHealth.isRefreshing} onRefresh={tierHealth.refresh} />
        }>
        {/* Toggling a tier only sets the preference the data layer reads; the
            fallback order (cache, then relays) does not change. */}
        <Section title="Connection">
          <ListGroup variant="secondary">
            <SettingsToggleItem
              testID="settings-network-tier-primal"
              title="Fast cache"
              description={
                primalHosts.length > 1
                  ? 'Public caches, tried in order'
                  : 'A public cache that loads profiles quickly'
              }
              status={<TierHealthBadge status={tierHealth.primal} checkingColor={mutedColor} />}
              statusLabel={spokenTierStatus(tierHealth.primal)}
              accessibilityLabel="Use Fast cache"
              isSelected={primalTierEnabled}
              onSelectedChange={setPrimalTierEnabled}
            />
            <Separator className="mx-4" />
            <SettingsToggleItem
              testID="settings-network-tier-relay"
              title="Relays"
              description="Ask relays directly when the cache can't answer"
              status={<TierHealthBadge status={tierHealth.relay} checkingColor={mutedColor} />}
              statusLabel={spokenTierStatus(tierHealth.relay)}
              accessibilityLabel="Use relays"
              isSelected={relayTierEnabled}
              onSelectedChange={setRelayTierEnabled}
            />
          </ListGroup>
        </Section>

        {/* Per-host switches, only when there is a choice to make. Fast cache
            off wins: every host is unused, so their rows wait, dimmed. */}
        {primalHosts.length > 1 ? (
          <Section title="Cache servers">
            <ListGroup variant="secondary">
              {primalHosts.map((url, index) => {
                const hostEnabled = !primalHostsDisabled.includes(url);
                const host = urlHostLabel(url);
                const hostStatus = primalHostStatus({
                  tierEnabled: primalTierEnabled,
                  hostEnabled,
                  health: tierHealth.primalHosts[url],
                });
                return (
                  <React.Fragment key={url}>
                    {index > 0 ? <Separator className="mx-4" /> : null}
                    <SettingsToggleItem
                      testID={`settings-network-primal-host-${url}`}
                      title={host}
                      prefix={<StatusDot status={hostStatus} />}
                      accessibilityLabel={`Use ${host}`}
                      statusLabel={TIER_STATUS_WORDS[hostStatus]}
                      isSelected={hostEnabled}
                      onSelectedChange={(next) => setPrimalHostEnabled(url, next)}
                      disabled={!primalTierEnabled}
                      disabledReason="Turn on Fast cache to use this"
                    />
                  </React.Fragment>
                );
              })}
            </ListGroup>
          </Section>
        ) : null}

        <Section title="People search" footer={VERTEX_CREDITS_DESCRIPTION}>
          <ListGroup variant="secondary">
            <SettingsToggleItem
              testID="settings-vertex-credits-toggle"
              title="Better people search"
              description="Uses your free Vertex credits"
              accessibilityHint={VERTEX_CREDITS_DESCRIPTION}
              isSelected={vertexCreditsEnabled}
              onSelectedChange={setVertexCreditsEnabled}
            />
          </ListGroup>
        </Section>

        <Section title="Mint auditors">
          <ListGroup variant="secondary">
            {MINT_AUDITORS.map((auditor, index) => (
              <React.Fragment key={auditor.id}>
                {index > 0 ? <Separator className="mx-4" /> : null}
                <SettingsToggleItem
                  testID={`settings-mint-auditor-${auditor.id}`}
                  title={auditor.name}
                  description={auditor.description}
                  accessibilityLabel={`Use ${auditor.name}`}
                  isSelected={isAuditorEnabled(
                    auditor.id,
                    disabledMintAuditors,
                    enabledMintAuditors
                  )}
                  onSelectedChange={(next) => setMintAuditorEnabled(auditor.id, next)}
                />
              </React.Fragment>
            ))}
          </ListGroup>
        </Section>

        <RelayListSettings key={ownPubkey} client={client} pubkey={ownPubkey} health={health} />
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

/**
 * The 8pt health dot on a cache-server row: green answering, red not (or
 * switched off, so carrying no traffic), muted while checking.
 */
function StatusDot({ status }: { status: TierStatus }) {
  const tone =
    status === 'online' ? 'bg-success' : status === 'checking' ? 'bg-muted' : 'bg-danger';
  return <View className={`h-2 w-2 rounded-full ${tone}`} />;
}

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
import React, { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { NDKEvent, useNDK } from '@nostr-dev-kit/ndk-mobile';
import type NDK from '@nostr-dev-kit/ndk-mobile';
import {
  Button,
  Card,
  Input,
  ListGroup,
  PressableFeedback,
  Separator,
  Switch,
  TextField,
} from 'heroui-native';

import Icon from 'assets/icons';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRelayHealth, type RelayHealth } from '@/shared/hooks/useRelayHealth';
import { useNostrTierHealth } from '@/shared/hooks/useNostrTierHealth';
import { type TierStatus } from '@/shared/lib/nostr/tierHealth';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { publishEvent } from '@/shared/lib/nostr/publish';
import { backendConfig } from '@/shared/config/backend';
import { DEFAULT_RELAYS, safeNormalizeRelay } from '@/shared/lib/nostr/outbox/defaults';
import { RELAY_LIST_KIND, serializeRelayList } from '@/shared/lib/nostr/outbox/nip65';
import { getOwnWriteRelays, useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';
import { Section } from '@/shared/ui/composed/Section';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { Badge } from '@/shared/ui/primitives/Badge';
import { Text } from '@/shared/ui/primitives/Text';

const VERTEX_CREDITS_DESCRIPTION =
  "Uses your Nostr identity's free Vertex credits to refresh reputation scores for everyone. Vertex and nagg see which profiles you look up; your keys never leave the device.";

async function publishRelayList(ctx: {
  ndk: NDK;
  entries: Parameters<typeof serializeRelayList>[0];
  markPublished: (created: number) => void;
  setPublishing: (publishing: boolean) => void;
  setPublishMsg: (msg: string | null) => void;
}): Promise<void> {
  const { ndk, entries, markPublished, setPublishing, setPublishMsg } = ctx;
  setPublishing(true);
  setPublishMsg(null);
  try {
    const created = Math.floor(Date.now() / 1000);
    const event = new NDKEvent(ndk);
    event.kind = RELAY_LIST_KIND;
    event.created_at = created;
    event.tags = serializeRelayList(entries);
    const targets = [...new Set([...getOwnWriteRelays(), ...DEFAULT_RELAYS])];
    const result = await publishEvent({ ndk, event, relays: targets, resolveOn: 'all-settled' });
    if (result.isOk()) {
      markPublished(created);
      log.info('settings.relays.published', { accepted: result.value.accepted.length });
      setPublishMsg(`Published to ${result.value.accepted.length} relays.`);
    } else {
      setPublishMsg('Could not publish. Check your connection and try again.');
    }
  } finally {
    setPublishing(false);
  }
}

export function SettingsNetworkScreen() {
  useLifecycleLogger('SettingsNetworkScreen');
  const { ndk } = useNDK();
  const vertexCreditsEnabled = useSettingsStore((s) => s.vertexCreditsEnabled);
  const setVertexCreditsEnabled = useSettingsStore((s) => s.setVertexCreditsEnabled);
  const naggTierEnabled = useSettingsStore((s) => s.naggTierEnabled);
  const setNaggTierEnabled = useSettingsStore((s) => s.setNaggTierEnabled);
  const primalHosts = backendConfig.primalCacheUrls;
  const primalHostsDisabled = useSettingsStore((st) => st.primalHostsDisabled);
  const setPrimalHostEnabled = useSettingsStore((st) => st.setPrimalHostEnabled);
  const enabledPrimalCount = primalHosts.filter((url) => !primalHostsDisabled.includes(url)).length;
  const primalTierEnabled = useSettingsStore((s) => s.primalTierEnabled);
  const setPrimalTierEnabled = useSettingsStore((s) => s.setPrimalTierEnabled);
  const relayTierEnabled = useSettingsStore((s) => s.relayTierEnabled);
  const setRelayTierEnabled = useSettingsStore((s) => s.setRelayTierEnabled);
  const entries = useRelayListStore((s) => s.entries);
  const source = useRelayListStore((s) => s.source);
  const addRelay = useRelayListStore((s) => s.addRelay);
  const removeRelay = useRelayListStore((s) => s.removeRelay);
  const setMarker = useRelayListStore((s) => s.setMarker);
  const restoreDefaults = useRelayListStore((s) => s.restoreDefaults);
  const markPublished = useRelayListStore((s) => s.markPublished);
  const health = useRelayHealth();
  const tierHealth = useNostrTierHealth(health);

  const [draftUrl, setDraftUrl] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [successColor, accentColor, mutedColor, dangerColor] = useThemeColor([
    'success',
    'accent',
    'muted',
    'danger',
  ] as const);

  const healthColor: Record<RelayHealth, string> = {
    connected: successColor,
    connecting: accentColor,
    disconnected: mutedColor,
    failed: dangerColor,
  };

  const tiers = [
    {
      id: 'nagg',
      name: 'nagg',
      description: 'App-view. Ranked, fully bundled feeds.',
      status: tierHealth.nagg,
      enabled: naggTierEnabled,
      onToggle: setNaggTierEnabled,
    },
    {
      id: 'primal',
      name: 'Primal cache',
      description:
        primalHosts.length > 1
          ? `Public fallback. ${enabledPrimalCount} of ${primalHosts.length} hosts on, tried in order.`
          : 'Public fallback cache.',
      status: tierHealth.primal,
      enabled: primalTierEnabled,
      onToggle: setPrimalTierEnabled,
    },
    {
      id: 'relay',
      name: 'Raw relays',
      description: 'Decentralized floor. Direct relay reads.',
      status: tierHealth.relay,
      enabled: relayTierEnabled,
      onToggle: setRelayTierEnabled,
    },
  ];

  const hasUnpublished = source === 'local';

  const handleAdd = () => {
    const normalized = safeNormalizeRelay(draftUrl.trim());
    if (!normalized || !/^wss?:\/\//.test(normalized)) {
      setAddError('Enter a valid relay URL (wss://…).');
      return;
    }
    setAddError(null);
    addRelay(normalized, { read: true, write: true });
    setDraftUrl('');
  };

  const handlePublish = () => {
    if (!ndk) return;
    return publishRelayList({ ndk, entries, markPublished, setPublishing, setPublishMsg });
  };

  const sortedEntries = [...entries].sort((a, b) => a.url.localeCompare(b.url));

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
                          className={`flex-row items-center gap-3 py-2 pl-8 pr-4 ${
                            tier.enabled && hostEnabled ? '' : 'opacity-40'
                          }`}>
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

        {sortedEntries.length === 0 ? (
          <EmptyState
            icon="mdi:server-network-off"
            title="No relays"
            subtitle="Add one or restore defaults."
          />
        ) : (
          <Section title="Your relays">
            <ListGroup variant="secondary">
              {sortedEntries.map((entry, index) => (
                <React.Fragment key={entry.url}>
                  {index > 0 ? <Separator className="mx-4" /> : null}
                  <ListGroup.Item>
                    <ListGroup.ItemContent>
                      <View className="flex-row items-center gap-2">
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: healthColor[health[entry.url] ?? 'disconnected'],
                          }}
                        />
                        <ListGroup.ItemTitle numberOfLines={1}>
                          {hostLabel(entry.url)}
                        </ListGroup.ItemTitle>
                      </View>
                      <View className="mt-1 flex-row gap-4">
                        <RelayMarkerToggle
                          label="Read"
                          relayUrl={entry.url}
                          value={entry.read}
                          onChange={(read) => setMarker(entry.url, { read, write: entry.write })}
                        />
                        <RelayMarkerToggle
                          label="Write"
                          relayUrl={entry.url}
                          value={entry.write}
                          onChange={(write) => setMarker(entry.url, { read: entry.read, write })}
                        />
                      </View>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      <Button
                        variant="ghost"
                        size="sm"
                        onPress={() => removeRelay(entry.url)}
                        testID={`settings-network-relay-remove-${entry.url}`}
                        accessibilityLabel={`Remove ${entry.url}`}>
                        <Icon name="mdi:trash-can-outline" size={18} color={mutedColor} />
                      </Button>
                    </ListGroup.ItemSuffix>
                  </ListGroup.Item>
                </React.Fragment>
              ))}
            </ListGroup>
          </Section>
        )}

        <Section title="Add relay">
          <Card variant="secondary">
            <Card.Body className="gap-2">
              <TextField>
                <Input
                  testID="settings-network-relay-input"
                  accessibilityLabel="Relay URL"
                  value={draftUrl}
                  onChangeText={setDraftUrl}
                  placeholder="wss://relay.example.com"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  onSubmitEditing={handleAdd}
                  returnKeyType="done"
                />
              </TextField>
              {addError ? (
                <Text size={12} style={{ color: dangerColor }}>
                  {addError}
                </Text>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                testID="settings-network-relay-add"
                onPress={handleAdd}>
                <Button.Label>Add relay</Button.Label>
              </Button>
            </Card.Body>
          </Card>
        </Section>

        <Section title="Publish">
          {hasUnpublished ? (
            <Text size={13} className="mb-2 px-1" style={{ color: mutedColor }}>
              Unpublished changes. Publish so others can find your posts.
            </Text>
          ) : null}
          <View className="gap-2">
            <Button
              variant="primary"
              testID="settings-network-publish"
              accessibilityState={{ disabled: publishing, busy: publishing }}
              onPress={handlePublish}
              isDisabled={publishing}>
              <Button.Label>{publishing ? 'Publishing…' : 'Publish relay list'}</Button.Label>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              testID="settings-network-restore-defaults"
              onPress={restoreDefaults}>
              <Button.Label>Restore defaults</Button.Label>
            </Button>
            {publishMsg ? (
              <Text size={12} className="px-1" style={{ color: mutedColor }}>
                {publishMsg}
              </Text>
            ) : null}
          </View>
        </Section>
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

/** `wss://cache1.primal.net/v1` → `cache1.primal.net`, the part worth reading. */
function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^wss?:\/\//, '');
  }
}

function RelayMarkerToggle({
  label,
  relayUrl,
  value,
  onChange,
}: {
  label: 'Read' | 'Write';
  relayUrl: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View className="flex-row items-center gap-1">
      <Switch
        testID={`settings-network-relay-${label.toLowerCase()}-${relayUrl}`}
        accessibilityLabel={`${label === 'Read' ? 'Read from' : 'Write to'} ${relayUrl}`}
        isSelected={value}
        onSelectedChange={onChange}
      />
      <Text size={12} className="text-muted">
        {label}
      </Text>
    </View>
  );
}

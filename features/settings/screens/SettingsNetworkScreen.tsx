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
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { NDKEvent, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { Button, Card, Input, ListGroup, Separator, Switch, TextField } from 'heroui-native';

import Icon from 'assets/icons';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRelayHealth, type RelayHealth } from '@/shared/hooks/useRelayHealth';
import { useNostrTierHealth } from '@/shared/hooks/useNostrTierHealth';
import { type TierStatus } from '@/shared/lib/nostr/tierHealth';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { publishEvent } from '@/shared/lib/nostr/publish';
import { DEFAULT_RELAYS, safeNormalizeRelay } from '@/shared/lib/nostr/outbox/defaults';
import { RELAY_LIST_KIND, serializeRelayList } from '@/shared/lib/nostr/outbox/nip65';
import { getOwnWriteRelays, useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';
import { Section } from '@/shared/ui/composed/Section';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { Badge } from '@/shared/ui/primitives/Badge';
import { Text } from '@/shared/ui/primitives/Text';

export function SettingsNetworkScreen() {
  useLifecycleLogger('SettingsNetworkScreen');
  const { ndk } = useNDK();
  const naggTierEnabled = useSettingsStore((s) => s.naggTierEnabled);
  const setNaggTierEnabled = useSettingsStore((s) => s.setNaggTierEnabled);
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

  const healthColor = useMemo<Record<RelayHealth, string>>(
    () => ({
      connected: successColor,
      connecting: accentColor,
      disconnected: mutedColor,
      failed: dangerColor,
    }),
    [successColor, accentColor, mutedColor, dangerColor]
  );

  const tiers = useMemo(
    () => [
      {
        name: 'nagg',
        description: 'App-view. Ranked, fully bundled feeds.',
        status: tierHealth.nagg,
        enabled: naggTierEnabled,
        onToggle: setNaggTierEnabled,
      },
      {
        name: 'Primal cache',
        description: 'Public fallback cache.',
        status: tierHealth.primal,
        enabled: primalTierEnabled,
        onToggle: setPrimalTierEnabled,
      },
      {
        name: 'Raw relays',
        description: 'Decentralized floor. Direct relay reads.',
        status: tierHealth.relay,
        enabled: relayTierEnabled,
        onToggle: setRelayTierEnabled,
      },
    ],
    [
      tierHealth.nagg,
      tierHealth.primal,
      tierHealth.relay,
      naggTierEnabled,
      primalTierEnabled,
      relayTierEnabled,
      setNaggTierEnabled,
      setPrimalTierEnabled,
      setRelayTierEnabled,
    ]
  );

  const hasUnpublished = source === 'local';

  const handleAdd = useCallback(() => {
    const normalized = safeNormalizeRelay(draftUrl.trim());
    if (!normalized || !/^wss?:\/\//.test(normalized)) {
      setAddError('Enter a valid relay URL (wss://…).');
      return;
    }
    setAddError(null);
    addRelay(normalized, { read: true, write: true });
    setDraftUrl('');
  }, [draftUrl, addRelay]);

  const handlePublish = useCallback(async () => {
    if (!ndk) return;
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
  }, [ndk, entries, markPublished]);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.url.localeCompare(b.url)),
    [entries]
  );

  return (
    <ScreenWrapper name="SettingsNetworkScreen" scroll="custom" safeArea>
      <ScrollView
        className="px-4"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={tierHealth.isRefreshing} onRefresh={tierHealth.refresh} />
        }>
        <Section title="Data layer">
          <ListGroup variant="secondary">
            {tiers.map((tier, index) => (
              <React.Fragment key={tier.name}>
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
                    <Switch isSelected={tier.enabled} onSelectedChange={tier.onToggle} />
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              </React.Fragment>
            ))}
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
                  <View className="flex-row items-center gap-3 px-4 py-3">
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: healthColor[health[entry.url] ?? 'disconnected'],
                      }}
                    />
                    <View className="flex-1">
                      <Text size={14} numberOfLines={1}>
                        {entry.url.replace(/^wss:\/\//, '')}
                      </Text>
                      <View className="mt-1 flex-row gap-4">
                        <RelayMarkerToggle
                          label="Read"
                          value={entry.read}
                          onChange={(read) => setMarker(entry.url, { read, write: entry.write })}
                        />
                        <RelayMarkerToggle
                          label="Write"
                          value={entry.write}
                          onChange={(write) => setMarker(entry.url, { read: entry.read, write })}
                        />
                      </View>
                    </View>
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={() => removeRelay(entry.url)}
                      accessibilityLabel={`Remove ${entry.url}`}>
                      <Icon name="mdi:trash-can-outline" size={18} color={mutedColor} />
                    </Button>
                  </View>
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
              <Button variant="secondary" size="sm" onPress={handleAdd}>
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
            <Button variant="primary" onPress={handlePublish} isDisabled={publishing}>
              <Button.Label>{publishing ? 'Publishing…' : 'Publish relay list'}</Button.Label>
            </Button>
            <Button variant="ghost" size="sm" onPress={restoreDefaults}>
              <Button.Label>Restore defaults</Button.Label>
            </Button>
            {publishMsg ? (
              <Text size={12} className="px-1" style={{ color: mutedColor }}>
                {publishMsg}
              </Text>
            ) : null}
          </View>
        </Section>
      </ScrollView>
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

function RelayMarkerToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View className="flex-row items-center gap-1">
      <Switch isSelected={value} onSelectedChange={onChange} />
      <Text size={12} className="text-muted">
        {label}
      </Text>
    </View>
  );
}

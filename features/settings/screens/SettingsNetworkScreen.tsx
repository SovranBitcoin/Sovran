/**
 * @fileoverview Network configuration — the three tiers of the resilient Nostr
 * data layer: aggregators (nagg), caching (Primal), and relays.
 *
 * Each tier has an enable/disable switch (a disabled tier drops out of the
 * facade's nagg → Primal → relays fallback chain — handy for simulating a tier
 * being down). The relays section additionally manages the active profile's
 * NIP-65 list (kind:10002): connection health, read/write markers, add/remove,
 * restore defaults, and publish.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { NDKEvent, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { Button, Card, Input, ListGroup, Separator, Switch, TextField } from 'heroui-native';

import Icon from 'assets/icons';
import { backendConfig } from '@/shared/config/backend';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRelayHealth, type RelayHealth } from '@/shared/hooks/useRelayHealth';
import { log } from '@/shared/lib/logger';
import { publishEvent } from '@/shared/lib/nostr/publish';
import { DEFAULT_RELAYS, safeNormalizeRelay } from '@/shared/lib/nostr/outbox/defaults';
import { RELAY_LIST_KIND, serializeRelayList } from '@/shared/lib/nostr/outbox/nip65';
import { getOwnWriteRelays, useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';
import { Section } from '@/shared/ui/composed/Section';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { Text } from '@/shared/ui/primitives/Text';

export function SettingsNetworkScreen() {
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
        setPublishMsg('Could not publish to any relay. Check your connection and try again.');
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
        contentContainerStyle={{ paddingBottom: 32 }}>
        <Text size={13} className="mb-3 px-1" style={{ color: mutedColor }}>
          Sovran reads Nostr nagg-first, then falls back to Primal&apos;s cache, then raw relays.
          Turn a source off to skip it (e.g. to test the fallback).
        </Text>

        <Section title="Aggregator">
          <TierToggleCard
            name="nagg"
            description="Our app-view — fully bundled, ranked"
            url={backendConfig.nostrAppViewBaseUrl}
            enabled={naggTierEnabled}
            onToggle={setNaggTierEnabled}
          />
        </Section>

        <Section title="Caching">
          <TierToggleCard
            name="Primal cache"
            description="Primal's public cache server"
            url={backendConfig.primalCacheUrl}
            enabled={primalTierEnabled}
            onToggle={setPrimalTierEnabled}
          />
        </Section>

        <Section title="Relays">
          <TierToggleCard
            name="Raw relays"
            description="The decentralised floor — a bit rough but functional"
            enabled={relayTierEnabled}
            onToggle={setRelayTierEnabled}
          />
        </Section>

        {sortedEntries.length === 0 ? (
          <EmptyState
            icon="mdi:server-network-off"
            title="No relays"
            subtitle="Add a relay or restore the defaults to start publishing."
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
              You have unpublished relay changes. Publish so other apps and your followers can find
              your posts.
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

function TierToggleCard({
  name,
  description,
  url,
  enabled,
  onToggle,
}: {
  name: string;
  description: string;
  url?: string;
  enabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <ListGroup variant="secondary">
      <View className="flex-row items-center gap-3 px-4 py-3">
        <View className="flex-1">
          <Text size={15}>{name}</Text>
          <Text size={12} className="text-muted mt-0.5">
            {description}
          </Text>
          {url ? (
            <Text size={12} className="text-muted mt-1" numberOfLines={1}>
              {url}
            </Text>
          ) : null}
        </View>
        <Switch isSelected={enabled} onSelectedChange={onToggle} />
      </View>
    </ListGroup>
  );
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

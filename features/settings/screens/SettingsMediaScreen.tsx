import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Button, Card } from 'heroui-native';

import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useLifecycleLogger } from '@/shared/lib/logger';
import { checkBlobExists } from '@/shared/lib/nostr/media/blossomClient';
import {
  selectOwnedBlobs,
  useOwnedMediaStore,
  type BlobDeleteState,
  type OwnedBlobEntry,
} from '@/shared/stores/profile/ownedMediaStore';

function hostLabel(host: string): string {
  try {
    return new URL(host).host;
  } catch {
    return host;
  }
}

/** ✓ = confirmed deleted, ✗ = still online / couldn't delete, spinner = in flight. */
function StatusBadge({
  state,
  success,
  danger,
  muted,
}: {
  state: BlobDeleteState;
  success: string;
  danger: string;
  muted: string;
}) {
  if (state === 'delete-requested') return <ActivityIndicator size="small" color={muted} />;
  const deleted = state === 'deleted';
  const color = deleted ? success : state === 'delete-failed' ? danger : muted;
  return (
    <Text size={20} style={{ color, fontWeight: '700' }}>
      {deleted ? '✓' : '✗'}
    </Text>
  );
}

function BlobRow({
  blob,
  foreground,
  muted,
  success,
  danger,
}: {
  blob: OwnedBlobEntry;
  foreground: string;
  muted: string;
  success: string;
  danger: string;
}) {
  return (
    <HStack align="center" gap={12} style={styles.row}>
      <Image
        source={{ uri: blob.url }}
        style={styles.thumb}
        contentFit="cover"
        cachePolicy="disk"
      />
      <View style={styles.meta}>
        <Text size={13} numberOfLines={1} style={{ color: foreground }}>
          {hostLabel(blob.host)}
        </Text>
        <Text size={11} numberOfLines={1} style={{ color: muted, fontVariant: ['tabular-nums'] }}>
          {blob.sha256.slice(0, 18)}…
        </Text>
      </View>
      <StatusBadge state={blob.deleteState} success={success} danger={danger} muted={muted} />
    </HStack>
  );
}

/**
 * Settings → "My media": the durable owned-blob ledger. Lists every image we've
 * posted with its deletion status (✓ deleted / ✗ live), and a Refresh that
 * HEAD-probes each URL to verify — disambiguating Primal's 404 ("gone" vs
 * "not owned"). View-only; deletion itself happens from a post's menu.
 */
export const SettingsMediaScreen = () => {
  useLifecycleLogger('SettingsMediaScreen');
  const [foreground, muted, success, danger] = useThemeColor([
    'foreground',
    'muted',
    'success',
    'danger',
  ] as const);
  const bySha = useOwnedMediaStore((s) => s.bySha);
  const blobs = useMemo(
    () => Object.values(bySha).sort((a, b) => b.lastSeen - a.lastSeen),
    [bySha]
  );
  const deletedCount = useMemo(
    () => blobs.filter((b) => b.deleteState === 'deleted').length,
    [blobs]
  );
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { markChecked } = useOwnedMediaStore.getState();
      // Snapshot via getState so the probe loop isn't tied to a render closure.
      for (const blob of selectOwnedBlobs(useOwnedMediaStore.getState())) {
        const exists = await checkBlobExists(blob.url);
        if (exists !== null) markChecked(blob.sha256, exists);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <ScreenWrapper name="SettingsMediaScreen" scroll="custom" safeArea>
      <ScrollView
        className="px-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}>
        <Card variant="secondary" className="mb-4">
          <Card.Body className="gap-3">
            <Text bold size={16}>
              My media
            </Text>
            <Text size={12} className="text-foreground/70">
              Every image you&apos;ve posted, kept so a deletion can be retried or verified later. ✓
              = confirmed deleted, ✗ = still online.
            </Text>
            <Text size={11} className="text-foreground/50">
              {blobs.length} {blobs.length === 1 ? 'blob' : 'blobs'} · {deletedCount} deleted
            </Text>
            <View className="flex-row">
              <Button
                variant="secondary"
                size="sm"
                isDisabled={refreshing || blobs.length === 0}
                onPress={handleRefresh}>
                <Button.Label>{refreshing ? 'Checking…' : 'Refresh status'}</Button.Label>
              </Button>
            </View>
          </Card.Body>
        </Card>

        {blobs.length === 0 ? (
          <Text size={13} className="text-foreground/60 mt-4 text-center">
            No media yet. Images you post will appear here.
          </Text>
        ) : (
          <Card variant="secondary">
            <Card.Body>
              {blobs.map((blob) => (
                <BlobRow
                  key={blob.sha256}
                  blob={blob}
                  foreground={foreground}
                  muted={muted}
                  success={success}
                  danger={danger}
                />
              ))}
            </Card.Body>
          </Card>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  row: { paddingVertical: 8 },
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: 'rgba(127,127,127,0.15)' },
  meta: { flex: 1, minWidth: 0 },
});

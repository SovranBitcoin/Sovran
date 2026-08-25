import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import { Image } from 'expo-image';
import { Button, Card } from 'heroui-native';
import { withAlpha } from '@/shared/lib/color';
import Icon from 'assets/icons';

import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useLifecycleLogger } from '@/shared/lib/logger';
import { actionMenuPopup, popup } from '@/shared/lib/popup';
import { checkBlobExists } from '@/shared/lib/nostr/media/blossomClient';
import { deleteOwnedBlob } from '@/shared/lib/nostr/media/deleteOwnedBlob';
import {
  selectOwnedBlobs,
  useOwnedMediaStore,
  type BlobDeleteState,
  type OwnedBlobEntry,
} from '@/shared/stores/profile/ownedMediaStore';

interface StatusColors {
  foreground: string;
  muted: string;
  success: string;
  danger: string;
}

function hostLabel(host: string): string {
  try {
    return new URL(host).host;
  } catch {
    return host;
  }
}

/** A spelled-out status pill — clearer than a bare ✓/✗. */
function statusInfo(
  state: BlobDeleteState,
  colors: StatusColors
): { label: string; color: string; spinner: boolean } {
  switch (state) {
    case 'deleted':
      return { label: 'Deleted', color: colors.success, spinner: false };
    case 'delete-requested':
      return { label: 'Deleting…', color: colors.muted, spinner: true };
    case 'delete-failed':
      return { label: "Couldn't delete", color: colors.danger, spinner: false };
    default:
      return { label: 'Online', color: colors.muted, spinner: false };
  }
}

function StatusPill({ state, colors }: { state: BlobDeleteState; colors: StatusColors }) {
  const { label, color, spinner } = statusInfo(state, colors);
  return (
    <HStack
      align="center"
      gap={6}
      style={[styles.pill, { backgroundColor: withAlpha(color, 0.14) }]}>
      {spinner ? <ActivityIndicator size="small" color={color} /> : null}
      <Text size={11} style={{ color, fontWeight: '600' }}>
        {label}
      </Text>
    </HStack>
  );
}

function BlobRow({
  blob,
  colors,
  onDelete,
}: {
  blob: OwnedBlobEntry;
  colors: StatusColors;
  onDelete?: (blob: OwnedBlobEntry) => void;
}) {
  // A delete is in flight while the state is 'delete-requested' — show only the
  // spinning pill then, never a tappable trash that could re-fire the request.
  const canDelete = !!onDelete && blob.deleteState !== 'delete-requested';
  return (
    <HStack align="center" gap={12} style={styles.row}>
      <Image
        source={{ uri: blob.url }}
        style={styles.thumb}
        contentFit="cover"
        cachePolicy="disk"
      />
      <View style={styles.meta}>
        <Text size={13} numberOfLines={1} style={{ color: colors.foreground }}>
          {hostLabel(blob.host)}
        </Text>
        <Text
          size={11}
          numberOfLines={1}
          style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>
          {blob.sha256.slice(0, 18)}…
        </Text>
      </View>
      <StatusPill state={blob.deleteState} colors={colors} />
      {canDelete ? (
        <Pressable
          haptics
          hitSlop={10}
          onPress={() => onDelete?.(blob)}
          style={styles.deleteButton}
          accessibilityRole="button"
          accessibilityLabel="Delete image">
          <Icon name="mdi:trash-can-outline" size={20} color={colors.danger} />
        </Pressable>
      ) : null}
    </HStack>
  );
}

function Section({
  title,
  description,
  blobs,
  colors,
  onDelete,
}: {
  title: string;
  description: string;
  blobs: OwnedBlobEntry[];
  colors: StatusColors;
  onDelete?: (blob: OwnedBlobEntry) => void;
}) {
  if (blobs.length === 0) return null;
  return (
    <View className="mb-4">
      <HStack align="center" justify="space-between" className="mb-2 ml-1 mr-1">
        <Text bold size={12} className="uppercase tracking-wide">
          {title}
        </Text>
        <Text size={11} style={{ color: colors.muted }}>
          {blobs.length}
        </Text>
      </HStack>
      <Card variant="secondary">
        <Card.Body className="gap-1">
          <Text size={11} style={{ color: colors.muted }} className="mb-1">
            {description}
          </Text>
          {blobs.map((blob) => (
            <BlobRow key={blob.sha256} blob={blob} colors={colors} onDelete={onDelete} />
          ))}
        </Card.Body>
      </Card>
    </View>
  );
}

/**
 * Settings → "My media": the durable owned-blob ledger, split into "Still
 * online" and "Deleted" sections so the state is obvious at a glance. Refresh
 * HEAD-probes each URL to verify — disambiguating Primal's 404 ("gone" vs "not
 * owned"). Each still-online row can be deleted directly here (BUD-11), the
 * same reconciliation a post deletion runs, so a blob can be removed or retried
 * without finding the original post.
 */
export const SettingsMediaScreen = () => {
  useLifecycleLogger('SettingsMediaScreen');
  const { ndk } = useNDK();
  const [foreground, muted, success, danger] = useThemeColor([
    'foreground',
    'muted',
    'success',
    'danger',
  ] as const);
  const colors: StatusColors = { foreground, muted, success, danger };

  const runDelete = async (blob: OwnedBlobEntry) => {
    if (!ndk) {
      // The signer/NDK isn't ready — surface it instead of silently no-op'ing.
      popup({
        message: 'Could not delete',
        text: 'Your signing key is still loading — try again in a moment.',
        type: 'error',
      });
      return;
    }
    const { deleted } = await deleteOwnedBlob({
      ndk,
      host: blob.host,
      sha256: blob.sha256,
      url: blob.url,
    });
    if (deleted) {
      popup({ message: 'Image deleted', type: 'success', variant: 'toast', duration: 1500 });
    } else {
      popup({
        message: "Couldn't delete image",
        text: 'The server kept it or rejected the request. Pull to refresh to re-check.',
        type: 'error',
      });
    }
  };

  const confirmDelete = (blob: OwnedBlobEntry) => {
    actionMenuPopup({
      title: 'Delete image?',
      buttons: [
        {
          text: 'Delete',
          icon: 'mdi:trash-can-outline',
          variant: 'dangerous',
          description: 'Removes it from the media server. This cannot be undone.',
          onPress: (close) => {
            close();
            void runDelete(blob);
          },
        },
      ],
    });
  };

  const byBlob = useOwnedMediaStore((s) => s.byBlob);
  const all = Object.values(byBlob).sort((a, b) => b.lastSeen - a.lastSeen);
  const online = all.filter((b) => b.deleteState !== 'deleted');
  const deleted = all.filter((b) => b.deleteState === 'deleted');
  const total = online.length + deleted.length;

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const { markChecked } = useOwnedMediaStore.getState();
      // Snapshot via getState so the probe loop isn't tied to a render closure.
      for (const blob of selectOwnedBlobs(useOwnedMediaStore.getState())) {
        const exists = await checkBlobExists(blob.url);
        if (exists !== null) markChecked(blob.host, blob.sha256, exists);
      }
    } finally {
      setRefreshing(false);
    }
  };

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
              Every image you&apos;ve posted, kept so a deletion can be retried or verified later.
              Refresh re-checks each image on its server.
            </Text>
            <Text size={11} className="text-foreground/50">
              {total} total · {online.length} online · {deleted.length} deleted
            </Text>
            <View className="flex-row">
              <Button
                variant="secondary"
                size="sm"
                isDisabled={refreshing || total === 0}
                onPress={handleRefresh}>
                <Button.Label>{refreshing ? 'Checking…' : 'Refresh status'}</Button.Label>
              </Button>
            </View>
          </Card.Body>
        </Card>

        {total === 0 ? (
          <Text size={13} className="text-foreground/60 mt-4 text-center">
            No media yet. Images you post will appear here.
          </Text>
        ) : (
          <>
            <Section
              title="Still online"
              description="These images are still hosted and can be deleted."
              blobs={online}
              colors={colors}
              onDelete={confirmDelete}
            />
            <Section
              title="Deleted"
              description="Confirmed removed from the server."
              blobs={deleted}
              colors={colors}
            />
          </>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  row: { paddingVertical: 8 },
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: 'rgba(127,127,127,0.15)' },
  meta: { flex: 1, minWidth: 0 },
  pill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  deleteButton: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

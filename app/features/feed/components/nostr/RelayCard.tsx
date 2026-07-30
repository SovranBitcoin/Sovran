/**
 * Inline relay card — the block rendered for a `wss://` url in note content
 * (segment kind `relay`). Deliberately minimal: icon · name · "Join" link.
 * Known software gets its brand surface via `relayBrands` (Buzz → chartreuse
 * card with ink text); everything else renders on the neutral themed surface.
 *
 * The name/icon come from the relay's NIP-11 document (via
 * `relayMetadataStore`); until it arrives — or when the relay is unreachable —
 * the card shows the domain with the broadcast glyph at the same fixed height,
 * so data arriving never shifts the note. "Join" opens the relay's https
 * origin in the browser.
 *
 * Privacy: rendering this card fetches https://<relay-host>, revealing the
 * reader's IP to that host — the same class of auto-load as inline images.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image as ExpoImage } from 'expo-image';
import opacity from 'hex-color-opacity';
import { StyleSheet, View as RNView } from 'react-native';

import Icon from 'assets/icons';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { feedLog } from '@/shared/lib/logger';
import { prefetchImage } from '@/shared/lib/imageCache';
import { staticPopup } from '@/shared/lib/popup';
import { extractDomain, openExternalUrl } from '@/shared/lib/url';
import { useRelayMetadata } from '@/shared/stores/global/relayMetadataStore';
import type { RelayInformation } from '@/shared/lib/nostr/nip11';
import { relayBrandForSoftware } from './relayBrands';
import { sharedStyles } from './feedStyles';

const RELAY_GLYPH = 'mdi:broadcast';
const RELAY_ICON_SIZE = 36;
/** Icon 36 + mediaCard padding 12×2 — every data state renders at this height. */
const RELAY_CARD_MIN_HEIGHT = RELAY_ICON_SIZE + 24;
const RELAY_ICON_FADE_MS = 200;

/** `wss://buzz.cashu.space/x` → `buzz.cashu.space`. */
function relayDomain(url: string): string {
  return extractDomain(url.replace(/^wss?:\/\//i, 'https://'));
}

const RelayIcon = React.memo(function RelayIcon({
  icon,
  ink,
}: {
  icon: string | undefined;
  /** Brand ink — set on branded surfaces so the fallback glyph reads on them. */
  ink?: string;
}) {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const [failed, setFailed] = useState(false);

  // Untrusted NIP-11 field: only inline raster data-URIs or http(s) urls may
  // reach the image layer (imageCache.ts scheme-allowlist precedent).
  const safeUri = useMemo(() => {
    const trimmed = icon?.trim();
    if (!trimmed) return undefined;
    if (/^data:image\//i.test(trimmed) || /^https?:\/\//i.test(trimmed)) return trimmed;
    return undefined;
  }, [icon]);

  useEffect(() => {
    setFailed(false);
    // `prefetchImage`'s allowlist rejects data: URIs (expo-image renders those
    // directly without a prefetch pass) — only warm http(s) icons.
    if (safeUri && /^https?:\/\//i.test(safeUri)) void prefetchImage(safeUri);
  }, [safeUri]);

  const containerStyle = useMemo(
    () => [styles.icon, { backgroundColor: ink ? opacity(ink, 0.12) : muted }],
    [ink, muted]
  );

  if (safeUri && !failed) {
    return (
      <RNView style={containerStyle}>
        <ExpoImage
          source={{ uri: safeUri }}
          cachePolicy="memory-disk"
          contentFit="cover"
          transition={RELAY_ICON_FADE_MS}
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Relay icon"
          onError={() => setFailed(true)}
        />
      </RNView>
    );
  }
  return (
    <RNView style={containerStyle}>
      <Icon name={RELAY_GLYPH} size={20} color={ink ?? opacity(foreground, 0.4)} />
    </RNView>
  );
});

function RelayCardBody({ url, info }: { url: string; info: RelayInformation | undefined }) {
  const [foreground, surface, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface',
    'surface-tertiary',
  ] as const);
  const domain = relayDomain(url);
  const brand = relayBrandForSoftware(info?.software);
  const textColor = brand ? brand.ink : opacity(foreground, 0.8);

  const join = useCallback(async () => {
    feedLog.info('feed.relay_card.join', { host: domain });
    const result = await openExternalUrl(`https://${domain}`);
    if (result.isErr()) {
      feedLog.warn('feed.relay_card.open_failed', { reason: result.error.type });
      staticPopup('open-link-failed');
    }
  }, [domain]);

  return (
    <View
      style={[
        sharedStyles.mediaCard,
        styles.card,
        brand
          ? { backgroundColor: brand.accent, borderColor: opacity(brand.ink, 0.15) }
          : { backgroundColor: surface, borderColor: surfaceTertiary },
      ]}>
      <HStack align="center" gap={10}>
        <RelayIcon icon={info?.icon} ink={brand?.ink} />
        <Text bold size={14} numberOfLines={1} style={[sharedStyles.flex1, { color: textColor }]}>
          {info?.name || domain}
        </Text>
        <Pressable onPress={join} hitSlop={12} accessibilityRole="link">
          <Text bold size={14} style={[styles.join, { color: textColor }]}>
            Join
          </Text>
        </Pressable>
      </HStack>
    </View>
  );
}

function RelayCardLive({ url }: { url: string }) {
  const { entry } = useRelayMetadata(url);
  return <RelayCardBody url={url} info={entry?.info} />;
}

export const RelayCard = React.memo(function RelayCard({
  url,
  noFetch,
}: {
  url: string;
  /** Per-note fan-out cap: render without mounting the SWR hook (domain-only card). */
  noFetch?: boolean;
}) {
  if (noFetch) return <RelayCardBody url={url} info={undefined} />;
  return <RelayCardLive url={url} />;
});

const styles = StyleSheet.create({
  card: {
    minHeight: RELAY_CARD_MIN_HEIGHT,
    justifyContent: 'center',
  },
  icon: {
    width: RELAY_ICON_SIZE,
    height: RELAY_ICON_SIZE,
    borderRadius: RELAY_ICON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  join: {
    textDecorationLine: 'underline',
  },
});

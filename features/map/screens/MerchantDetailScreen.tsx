/**
 * Merchant detail screen: displays info about a Bitcoin-accepting merchant.
 * Used from map flow when a marker is tapped.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import * as Linking from 'expo-linking';
import { useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { z } from 'zod';

import Icon from 'assets/icons';
import { Section } from '@/features/settings';
import { Badge } from '@/shared/ui/primitives/Badge';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useBTCMapStore, BTCMapPlaceDetails } from '@/shared/stores/global/btcMapStore';
import { ListGroup, PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';
import { Log, log, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { getMarkerColor } from '@/shared/lib/map/categories';

const ParamsSchema = z.object({
  placeId: z.string().regex(/^\d{1,15}$/, 'placeId must be a positive integer'),
});

export function MerchantDetailScreen() {
  useLifecycleLogger('MerchantDetailScreen');
  const navigation = useNavigation();
  const [foreground, defaultColor, surfaceSecondary, background] = useThemeColor([
    'foreground',
    'default',
    'surface-secondary',
    'background',
  ] as const);
  const insets = useSafeAreaInsets();
  const params = useRouteParams(ParamsSchema, { where: 'map-flow.detail' });
  const placeId = params?.placeId;
  const { fetchPlaceDetails, getCachedPlaceDetails } = useBTCMapStore(
    useShallow((s) => ({
      fetchPlaceDetails: s.fetchPlaceDetails,
      getCachedPlaceDetails: s.getCachedPlaceDetails,
    }))
  );

  const [place, setPlace] = useState<BTCMapPlaceDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadDetails = async () => {
      if (!placeId) {
        setIsLoading(false);
        return;
      }

      const id = parseInt(placeId, 10);
      if (isNaN(id)) {
        setIsLoading(false);
        return;
      }

      const cached = getCachedPlaceDetails(id);
      if (cached) {
        setPlace(cached);
        setIsLoading(false);
        return;
      }

      try {
        const details = await fetchPlaceDetails(id);
        setPlace(details);
      } catch (err) {
        log.error('map.merchant.fetch_failed', { error: err });
      } finally {
        setIsLoading(false);
      }
    };

    loadDetails();
  }, [placeId, fetchPlaceDetails, getCachedPlaceDetails]);

  useEffect(() => {
    if (place?.name) {
      navigation.setOptions({ title: place.name });
    }
  }, [place?.name, navigation]);

  const handleOpenURL = useCallback((url: string) => {
    Linking.openURL(url);
  }, []);

  const handleCall = useCallback((phone: string) => {
    Linking.openURL(`tel:${phone}`);
  }, []);

  const handleEmail = useCallback((email: string) => {
    Linking.openURL(`mailto:${email}`);
  }, []);

  const supportsOnchain = place?.['osm:payment:onchain'] === 'yes';
  const supportsLightning = place?.['osm:payment:lightning'] === 'yes';
  const supportsContactless = place?.['osm:payment:lightning_contactless'] === 'yes';

  const phone = place?.['osm:contact:phone'] || place?.phone;
  const website = place?.['osm:contact:website'] || place?.website;
  const email = place?.['osm:contact:email'] || place?.email;
  const instagram = place?.['osm:contact:instagram'] || place?.instagram;
  const twitter = place?.['osm:contact:twitter'] || place?.twitter;

  const verifiedDate = place?.verified_at
    ? new Date(place.verified_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  const contactItems = useMemo(() => {
    const items: { method: string; info: string; icon: string; fullInfo?: string }[] = [];

    if (phone) items.push({ method: 'phone', info: phone, icon: 'mdi:phone' });
    if (website)
      items.push({ method: 'website', info: 'Website', icon: 'mdi:web', fullInfo: website });
    if (email) items.push({ method: 'email', info: email, icon: 'mdi:email' });
    if (instagram)
      items.push({ method: 'instagram', info: `@${instagram}`, icon: 'mdi:instagram' });
    if (twitter)
      items.push({ method: 'twitter', info: `@${twitter}`, icon: 'hugeicons:new-twitter' });

    return items;
  }, [phone, website, email, instagram, twitter]);

  const handleContactPress = useCallback(
    (method: string, info: string, fullInfo?: string) => {
      switch (method) {
        case 'phone':
          handleCall(info);
          break;
        case 'website':
          const url = fullInfo || info;
          handleOpenURL(url.startsWith('http') ? url : `https://${url}`);
          break;
        case 'email':
          handleEmail(info);
          break;
        case 'instagram':
          handleOpenURL(`https://instagram.com/${info.replace('@', '')}`);
          break;
        case 'twitter':
          handleOpenURL(`https://x.com/${info.replace('@', '')}`);
          break;
      }
    },
    [handleCall, handleOpenURL, handleEmail]
  );

  if (isLoading) {
    return (
      <Log name="MerchantDetailScreen" style={{ flex: 1, backgroundColor: background }}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F7931A" />
          <Text size={14} style={{ color: opacity(foreground, 0.5), marginTop: 12 }}>
            Loading merchant details...
          </Text>
        </View>
      </Log>
    );
  }

  if (!place) {
    return (
      <Log name="MerchantDetailScreen" style={{ flex: 1, backgroundColor: background }}>
        <View style={styles.loadingContainer}>
          <Icon name="mdi:alert-circle" size={48} color={opacity(foreground, 0.4)} />
          <Text size={14} style={{ color: opacity(foreground, 0.5), marginTop: 12 }}>
            No merchant data available
          </Text>
        </View>
      </Log>
    );
  }

  return (
    <Log name="MerchantDetailScreen" style={{ flex: 1, backgroundColor: background }}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{
          paddingTop: insets.top + 56,
          paddingHorizontal: 16,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={[styles.merchantIcon, { backgroundColor: getMarkerColor(place.icon) }]}>
            <Icon name="mdi:store" size={28} color="#fff" />
          </View>
          <VStack style={{ flex: 1, marginLeft: 16 }}>
            <Text size={20} heavy style={{ color: opacity(foreground, 0.9) }}>
              {place.name || 'Unknown Merchant'}
            </Text>
            {place.address && (
              <Text size={13} style={{ color: opacity(foreground, 0.4), marginTop: 4 }}>
                {place.address}
              </Text>
            )}
            {verifiedDate && (
              <HStack align="center" style={{ marginTop: 6 }}>
                <Badge variant="success" icon="material-symbols:verified" size={12}>
                  Verified {verifiedDate}
                </Badge>
              </HStack>
            )}
          </VStack>
        </View>

        {(supportsOnchain || supportsLightning || supportsContactless) && (
          <Section title="Payment Methods">
            <ListGroup variant="secondary">
              {supportsOnchain && (
                <ListGroup.Item>
                  <ListGroup.ItemPrefix>
                    <Icon name="mdi:bitcoin" size={20} color="#F7931A" />
                  </ListGroup.ItemPrefix>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>On-chain</ListGroup.ItemTitle>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <Icon name="mdi:check-circle" size={20} color={opacity(foreground, 0.4)} />
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              )}
              {supportsLightning && (
                <ListGroup.Item>
                  <ListGroup.ItemPrefix>
                    <Icon name="mingcute:lightning-fill" size={20} color="#F7931A" />
                  </ListGroup.ItemPrefix>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>Lightning</ListGroup.ItemTitle>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <Icon name="mdi:check-circle" size={20} color={opacity(foreground, 0.4)} />
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              )}
              {supportsContactless && (
                <ListGroup.Item>
                  <ListGroup.ItemPrefix>
                    <Icon name="ph:contactless-payment-fill" size={20} color="#F7931A" />
                  </ListGroup.ItemPrefix>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>Contactless</ListGroup.ItemTitle>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <Icon name="mdi:check-circle" size={20} color={opacity(foreground, 0.4)} />
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              )}
            </ListGroup>
          </Section>
        )}

        {contactItems.length > 0 && (
          <Section title="Contact">
            <ListGroup variant="secondary">
              {contactItems.map((contact) => (
                <PressableFeedback
                  key={contact.method}
                  animation={false}
                  onPress={() =>
                    handleContactPress(contact.method, contact.info, contact.fullInfo)
                  }>
                  <PressableFeedback.Scale>
                    <ListGroup.Item disabled>
                      <ListGroup.ItemPrefix>
                        <Icon name={contact.icon} size={20} color={opacity(foreground, 0.4)} />
                      </ListGroup.ItemPrefix>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>{contact.info}</ListGroup.ItemTitle>
                      </ListGroup.ItemContent>
                      <ListGroup.ItemSuffix />
                    </ListGroup.Item>
                  </PressableFeedback.Scale>
                  <PressableFeedback.Ripple />
                </PressableFeedback>
              ))}
            </ListGroup>
          </Section>
        )}

        {place.opening_hours && (
          <Section title="Opening Hours">
            <View
              style={{
                backgroundColor: surfaceSecondary,
                padding: 16,
                borderRadius: 12,
              }}>
              <Text size={14} style={{ color: opacity(foreground, 0.66), lineHeight: 22 }}>
                {place.opening_hours}
              </Text>
            </View>
          </Section>
        )}

        {place.description && (
          <Section title="About">
            <View
              style={{
                backgroundColor: surfaceSecondary,
                padding: 16,
                borderRadius: 12,
              }}>
              <Text size={14} style={{ color: opacity(foreground, 0.66), lineHeight: 22 }}>
                {place.description}
              </Text>
            </View>
          </Section>
        )}

        <View style={styles.sourceInfo}>
          <Text size={11} style={{ color: defaultColor, textAlign: 'center' }}>
            Data from BTCMap.org • Last updated {new Date(place.updated_at).toLocaleDateString()}
          </Text>
        </View>
      </ScrollView>
    </Log>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  merchantIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceInfo: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
});

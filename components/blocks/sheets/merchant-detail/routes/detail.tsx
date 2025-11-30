/**
 * @fileoverview Merchant Detail Sheet Route
 *
 * Displays detailed information about a Bitcoin-accepting merchant.
 * Uses existing UI components (Section, RowButton, Wrapper) for consistency.
 */

import Icon from 'assets/icons';
import { Badge } from 'components/ui/Badge';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Text } from 'components/ui/Text';
import { HStack, VStack, View } from 'components/ui/View';
import { RowButton, Section } from 'app/settings-pages';
import Wrapper from '../../../sheets/wrapper';
import * as Linking from 'expo-linking';
import { useTheme } from 'providers/ThemeProvider';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, Platform, StyleSheet } from 'react-native';
import { useSheetPayload, SheetManager } from 'react-native-actions-sheet';
import { BTCMapPlaceDetails } from 'stores/btcMapStore';

// Category definitions for marker colors
const CATEGORIES = {
  food: {
    icons: ['local_cafe', 'lunch_dining', 'restaurant', 'bakery_dining'],
  },
  retail: {
    icons: ['storefront', 'local_grocery_store', 'computer', 'diamond'],
  },
  atm: {
    icons: ['local_atm', 'currency_exchange'],
  },
  accommodation: {
    icons: ['hotel', 'spa'],
  },
  services: {
    icons: [
      'medical_services',
      'local_pharmacy',
      'content_cut',
      'car_repair',
      'fitness_center',
      'business',
    ],
  },
};

// Icon to color mapping
const getMarkerColor = (icon: string): string => {
  if (CATEGORIES.food.icons.includes(icon)) return '#FF6B6B';
  if (CATEGORIES.retail.icons.includes(icon)) return '#4ECDC4';
  if (CATEGORIES.atm.icons.includes(icon)) return '#F7931A';
  if (CATEGORIES.accommodation.icons.includes(icon)) return '#9B59B6';
  if (CATEGORIES.services.icons.includes(icon)) return '#3498DB';
  return '#6366f1';
};

interface MerchantDetailPayload {
  place: BTCMapPlaceDetails | null;
  isLoading: boolean;
}

export default function MerchantDetailRoute() {
  const { getPrimaryColor } = useTheme();
  const payload = useSheetPayload('merchant-detail') as MerchantDetailPayload | undefined;

  const place = payload?.place;
  const isLoading = payload?.isLoading ?? false;

  const handleOpenURL = useCallback((url: string) => {
    Linking.openURL(url);
  }, []);

  const handleCall = useCallback((phone: string) => {
    Linking.openURL(`tel:${phone}`);
  }, []);

  const handleEmail = useCallback((email: string) => {
    Linking.openURL(`mailto:${email}`);
  }, []);

  const handleOpenMaps = useCallback((lat: number, lon: number, name?: string) => {
    const label = encodeURIComponent(name || 'Merchant');
    const url =
      Platform.OS === 'ios'
        ? `maps:0,0?q=${label}@${lat},${lon}`
        : `geo:${lat},${lon}?q=${lat},${lon}(${label})`;
    Linking.openURL(url);
  }, []);

  const handleClose = useCallback(() => {
    SheetManager.hide('merchant-detail');
  }, []);

  // Parse payment info
  const supportsOnchain = place?.['osm:payment:onchain'] === 'yes';
  const supportsLightning = place?.['osm:payment:lightning'] === 'yes';
  const supportsContactless = place?.['osm:payment:lightning_contactless'] === 'yes';

  // Get contact info (prefer osm:contact over direct fields)
  const phone = place?.['osm:contact:phone'] || place?.phone;
  const website = place?.['osm:contact:website'] || place?.website;
  const email = place?.['osm:contact:email'] || place?.email;
  const instagram = place?.['osm:contact:instagram'] || place?.instagram;
  const twitter = place?.['osm:contact:twitter'] || place?.twitter;

  // Format verified date
  const verifiedDate = place?.verified_at
    ? new Date(place.verified_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  // Build contact items for the Section
  const contactItems = useMemo(() => {
    const items: { method: string; info: string; icon: string }[] = [];

    if (phone) {
      items.push({ method: 'phone', info: phone, icon: 'mdi:phone' });
    }
    if (website) {
      items.push({ method: 'website', info: 'Website', icon: 'mdi:web' });
    }
    if (email) {
      items.push({ method: 'email', info: email, icon: 'mdi:email' });
    }
    if (instagram) {
      items.push({ method: 'instagram', info: `@${instagram}`, icon: 'mdi:instagram' });
    }
    if (twitter) {
      items.push({ method: 'twitter', info: `@${twitter}`, icon: 'hugeicons:new-twitter' });
    }

    return items;
  }, [phone, website, email, instagram, twitter]);

  const handleContactPress = useCallback(
    (method: string, info: string) => {
      switch (method) {
        case 'phone':
          handleCall(info);
          break;
        case 'website':
          handleOpenURL(info.startsWith('http') ? info : `https://${info}`);
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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F7931A" />
        <Text size={14} style={{ color: getPrimaryColor('300'), marginTop: 12 }}>
          Loading merchant details...
        </Text>
      </View>
    );
  }

  if (!place) {
    return (
      <View style={styles.loadingContainer}>
        <Text size={14} style={{ color: getPrimaryColor('300') }}>
          No merchant data available
        </Text>
      </View>
    );
  }

  const buttonsContent = (
    <ButtonHandler
      buttons={[
        {
          text: 'Get Directions',
          variant: 'primary',
          icon: 'mdi:map-marker',
          onPress: async () => {
            handleOpenMaps(place.lat, place.lon, place.name);
          },
        },
        ...(place.osm_url
          ? [
              {
                text: 'View on OpenStreetMap',
                variant: 'secondary' as const,
                onPress: async () => {
                  handleOpenURL(place.osm_url!);
                },
              },
            ]
          : []),
        {
          text: 'Close',
          variant: 'secondary' as const,
          onPress: async () => {
            handleClose();
          },
        },
      ]}
    />
  );

  return (
    <Wrapper buttons={buttonsContent}>
      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.merchantIcon, { backgroundColor: getMarkerColor(place.icon) }]}>
          <Icon name="mdi:store" size={28} color="#fff" />
        </View>
        <VStack style={{ flex: 1, marginLeft: 16 }}>
          <Text size={20} heavy style={{ color: getPrimaryColor('50') }}>
            {place.name || 'Unknown Merchant'}
          </Text>
          {place.address && (
            <Text size={13} style={{ color: getPrimaryColor('400'), marginTop: 4 }}>
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

      {/* Payment Methods - only show accepted methods */}
      {(supportsOnchain || supportsLightning || supportsContactless) && (
        <Section title="Payment Methods">
          {supportsOnchain && (
            <RowButton
              isFirst
              isLast={!supportsLightning && !supportsContactless}
              label={
                <HStack align="center" gap={8}>
                  <Icon name="mdi:bitcoin" size={20} color="#F7931A" />
                  <Text style={{ color: getPrimaryColor('50') }} bold>
                    On-chain
                  </Text>
                </HStack>
              }
              rightIcon={<Icon name="mdi:check-circle" size={20} color={getPrimaryColor('400')} />}
            />
          )}
          {supportsLightning && (
            <RowButton
              isFirst={!supportsOnchain}
              isLast={!supportsContactless}
              label={
                <HStack align="center" gap={8}>
                  <Icon name="mingcute:lightning-fill" size={20} color="#F7931A" />
                  <Text style={{ color: getPrimaryColor('50') }} bold>
                    Lightning
                  </Text>
                </HStack>
              }
              rightIcon={<Icon name="mdi:check-circle" size={20} color={getPrimaryColor('400')} />}
            />
          )}
          {supportsContactless && (
            <RowButton
              isFirst={!supportsOnchain && !supportsLightning}
              isLast
              label={
                <HStack align="center" gap={8}>
                  <Icon name="ph:contactless-payment-fill" size={20} color="#F7931A" />
                  <Text style={{ color: getPrimaryColor('50') }} bold>
                    Contactless
                  </Text>
                </HStack>
              }
              rightIcon={<Icon name="mdi:check-circle" size={20} color={getPrimaryColor('400')} />}
            />
          )}
        </Section>
      )}

      {/* Contact Section - using RowButton like in info.tsx */}
      {contactItems.length > 0 && (
        <Section title="Contact">
          {contactItems.map((contact, index) => (
            <RowButton
              key={contact.method}
              isFirst={index === 0}
              isLast={index === contactItems.length - 1}
              label={
                <HStack align="center" gap={8}>
                  <Icon name={contact.icon} size={20} color={getPrimaryColor('400')} />
                  <Text style={{ color: getPrimaryColor('50') }} bold>
                    {contact.info}
                  </Text>
                </HStack>
              }
              onPress={() => handleContactPress(contact.method, contact.info)}
            />
          ))}
        </Section>
      )}

      {/* Opening Hours */}
      {place.opening_hours && (
        <Section title="Opening Hours">
          <View
            style={{
              backgroundColor: getPrimaryColor('800'),
              padding: 16,
              borderRadius: 12,
            }}>
            <Text size={14} style={{ color: getPrimaryColor('200'), lineHeight: 22 }}>
              {place.opening_hours}
            </Text>
          </View>
        </Section>
      )}

      {/* Description */}
      {place.description && (
        <Section title="About">
          <View
            style={{
              backgroundColor: getPrimaryColor('800'),
              padding: 16,
              borderRadius: 12,
            }}>
            <Text size={14} style={{ color: getPrimaryColor('200'), lineHeight: 22 }}>
              {place.description}
            </Text>
          </View>
        </Section>
      )}

      {/* Source Info */}
      <View style={styles.sourceInfo}>
        <Text size={11} style={{ color: getPrimaryColor('600'), textAlign: 'center' }}>
          Data from BTCMap.org • Last updated {new Date(place.updated_at).toLocaleDateString()}
        </Text>
      </View>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    minHeight: 200,
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

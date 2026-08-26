/**
 * Merchant detail screen: displays info about a Bitcoin-accepting merchant.
 * Used from map flow when a marker is tapped.
 */

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { z } from 'zod';

import Icon from 'assets/icons';
import { Section } from '@/shared/ui/composed/Section';
import { Badge } from '@/shared/ui/primitives/Badge';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useBTCMapStore, BTCMapPlaceDetails } from '@/shared/stores/global/btcMapStore';
import { ListGroup, PressableFeedback } from 'heroui-native';
import { withAlpha } from '@/shared/lib/color';
import { Log, log, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { getMarkerColor } from '@/shared/lib/map/categories';
import { BITCOIN_ACCENT } from '@/shared/lib/brandColors';
import { isAbortError } from '@/shared/lib/apiClient';
import { openExternalUrl } from '@/shared/lib/url';
import { staticPopup } from '@/shared/lib/popup';
import { formatDate } from '@/shared/lib/date';

const ParamsSchema = z.object({
  placeId: z.string().regex(/^\d{1,15}$/, 'placeId must be a positive integer'),
});

async function loadMerchantDetails(ctx: {
  placeId: string | undefined;
  signal: AbortSignal;
  fetchPlaceDetails: (
    id: number,
    forceRefresh?: boolean,
    controls?: { signal?: AbortSignal }
  ) => Promise<BTCMapPlaceDetails>;
  getCachedPlaceDetails: (id: number) => BTCMapPlaceDetails | null;
  setPlace: (place: BTCMapPlaceDetails | null) => void;
  setIsLoading: (loading: boolean) => void;
}): Promise<void> {
  const { placeId, signal, fetchPlaceDetails, getCachedPlaceDetails, setPlace, setIsLoading } = ctx;
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
    const details = await fetchPlaceDetails(id, false, { signal });
    if (signal.aborted) return;
    setPlace(details);
  } catch (err) {
    if (isAbortError(err)) return;
    log.error('map.merchant.fetch_failed', { error: err });
  } finally {
    if (!signal.aborted) setIsLoading(false);
  }
}

// BTCMap advertises support via OSM payment tags; each row renders identically
// (icon + title + check), so the list is data, not three copied blocks.
const PAYMENT_METHOD_ROWS = [
  { osmTag: 'osm:payment:onchain', icon: 'mdi:bitcoin', title: 'On-chain' },
  { osmTag: 'osm:payment:lightning', icon: 'mingcute:lightning-fill', title: 'Lightning' },
  {
    osmTag: 'osm:payment:lightning_contactless',
    icon: 'ph:contactless-payment-fill',
    title: 'Contactless',
  },
] as const;

/** Rounded prose card ("Opening Hours", "About") — one chrome for every
 *  free-text merchant section. */
function MerchantTextSection({ title, body }: { title: string; body: string }) {
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);
  return (
    <Section title={title}>
      <View
        style={{
          backgroundColor: surfaceSecondary,
          padding: 16,
          borderRadius: 12,
        }}>
        <Text size={14} style={{ color: withAlpha(foreground, 0.66), lineHeight: 22 }}>
          {body}
        </Text>
      </View>
    </Section>
  );
}

export function MerchantDetailScreen() {
  useLifecycleLogger('MerchantDetailScreen');
  const navigation = useNavigation();
  const [foreground, defaultColor, background] = useThemeColor([
    'foreground',
    'default',
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
    const controller = new AbortController();

    void loadMerchantDetails({
      placeId,
      signal: controller.signal,
      fetchPlaceDetails,
      getCachedPlaceDetails,
      setPlace,
      setIsLoading,
    });
    return () => controller.abort();
  }, [placeId, fetchPlaceDetails, getCachedPlaceDetails]);

  useEffect(() => {
    if (place?.name) {
      navigation.setOptions({ title: place.name });
    }
  }, [place?.name, navigation]);

  const handleOpenURL = async (url: string) => {
    const result = await openExternalUrl(url);
    if (result.isErr()) {
      log.warn('map.merchant.open_link.failed', { url, reason: result.error.type });
      staticPopup('open-link-failed');
    }
  };

  const handleCall = async (phone: string) => {
    // Strip everything but digits and a leading + so user-supplied formatting
    // (spaces, dashes, parens) doesn't fail URL parsing.
    const sanitized = phone.replace(/[^\d+]/g, '');
    await handleOpenURL(`tel:${sanitized}`);
  };

  const handleEmail = async (email: string) => handleOpenURL(`mailto:${email.trim()}`);

  const supportedPaymentMethods = PAYMENT_METHOD_ROWS.filter(
    (method) => place?.[method.osmTag] === 'yes'
  );

  const phone = place?.['osm:contact:phone'] || place?.phone;
  const website = place?.['osm:contact:website'] || place?.website;
  const email = place?.['osm:contact:email'] || place?.email;
  const instagram = place?.['osm:contact:instagram'] || place?.instagram;
  const twitter = place?.['osm:contact:twitter'] || place?.twitter;

  const verifiedDate = place?.verified_at ? formatDate(place.verified_at, 'short-date') : null;

  const contactItems: { method: string; info: string; icon: string; fullInfo?: string }[] = [];
  if (phone) contactItems.push({ method: 'phone', info: phone, icon: 'mdi:phone' });
  if (website)
    contactItems.push({ method: 'website', info: 'Website', icon: 'mdi:web', fullInfo: website });
  if (email) contactItems.push({ method: 'email', info: email, icon: 'mdi:email' });
  if (instagram)
    contactItems.push({ method: 'instagram', info: `@${instagram}`, icon: 'mdi:instagram' });
  if (twitter)
    contactItems.push({ method: 'twitter', info: `@${twitter}`, icon: 'hugeicons:new-twitter' });

  const handleContactPress = (method: string, info: string, fullInfo?: string) => {
    switch (method) {
      case 'phone':
        void handleCall(info);
        break;
      case 'website': {
        const url = fullInfo || info;
        void handleOpenURL(url.startsWith('http') ? url : `https://${url}`);
        break;
      }
      case 'email':
        void handleEmail(info);
        break;
      case 'instagram':
        void handleOpenURL(`https://instagram.com/${info.replace('@', '')}`);
        break;
      case 'twitter':
        void handleOpenURL(`https://x.com/${info.replace('@', '')}`);
        break;
    }
  };

  if (isLoading) {
    return (
      <Log name="MerchantDetailScreen" style={{ flex: 1, backgroundColor: background }}>
        <View style={styles.loadingContainer}>
          <Spinner size={32} color={BITCOIN_ACCENT} />
          <Text size={14} style={{ color: withAlpha(foreground, 0.5), marginTop: 12 }}>
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
          <Icon name="mdi:alert-circle" size={48} color={withAlpha(foreground, 0.4)} />
          <Text size={14} style={{ color: withAlpha(foreground, 0.5), marginTop: 12 }}>
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
        // Android form-sheet: top-edge drag dismisses, mid-scroll scrolls.
        nestedScrollEnabled
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
            <Text size={20} heavy style={{ color: withAlpha(foreground, 0.9) }}>
              {place.name || 'Unknown Merchant'}
            </Text>
            {place.address && (
              <Text size={13} style={{ color: withAlpha(foreground, 0.4), marginTop: 4 }}>
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

        {supportedPaymentMethods.length > 0 && (
          <Section title="Payment Methods">
            <ListGroup variant="secondary">
              {supportedPaymentMethods.map((method) => (
                <ListGroup.Item key={method.title}>
                  <ListGroup.ItemPrefix>
                    <Icon name={method.icon} size={20} color={BITCOIN_ACCENT} />
                  </ListGroup.ItemPrefix>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>{method.title}</ListGroup.ItemTitle>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <Icon name="mdi:check-circle" size={20} color={withAlpha(foreground, 0.4)} />
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              ))}
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
                        <Icon name={contact.icon} size={20} color={withAlpha(foreground, 0.4)} />
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
          <MerchantTextSection title="Opening Hours" body={place.opening_hours} />
        )}

        {place.description && <MerchantTextSection title="About" body={place.description} />}

        <View style={[styles.sourceInfo, { borderTopColor: withAlpha(foreground, 0.1) }]}>
          <Text size={11} style={{ color: defaultColor, textAlign: 'center' }}>
            Data from BTCMap.org • Last updated {formatDate(place.updated_at, 'short-date')}
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
  },
});

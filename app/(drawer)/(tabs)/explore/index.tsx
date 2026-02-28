import { useThemeColor } from '@/hooks/useThemeColor';
import Icon from 'assets/icons';
import { ScrollableGradientOverlay } from 'components/ui/BackgroundView';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Link } from 'expo-router';
import { ROUTSTR_PUBKEY } from 'helper/constants';
import { popup } from 'helper/popup';
import { truncateMiddle } from 'helper/strings';
import { getModels, RoutstrModel } from 'helper/routstr/api';
import opacity from 'hex-color-opacity';
import { useBackgroundConfig } from 'providers/BackgroundProvider';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  InteractionManager,
  Linking,
  ScrollView,
  StyleSheet,
  View as RNView,
} from 'react-native';
import { useBTCMapStore } from 'stores/btcMapStore';
import { useSettingsStore } from 'stores/settingsStore';
import { useShallow } from 'zustand/react/shallow';
import { useRoutstrStore } from 'stores/routstrStore';
import { LayoutDebugWrapper } from '../example';
import { AmountFormatter } from '@/components/ui/AmountFormatter';
import { usePaginatedHistory } from 'coco-cashu-react';
import { WalletHealthCard } from '@/components/blocks/health/WalletHealthCard';
import { useHeroTransition } from '@/components/ui/hero-transition/HeroTransitionProvider';
import { ClaimUsernameCardFrame } from 'components/blocks/claim/ClaimUsernameCardFrame';
import { PendingEcashCardFrame } from 'components/blocks/pending/PendingEcashCardFrame';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  runOnJS,
  FadeInUp,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ============================================================================
// AI Model Helpers
// ============================================================================

// Extract provider from canonical_slug (same as UserMessagesScreen)
function extractProviderFromSlug(canonicalSlug: string): string {
  const parts = canonicalSlug.split('/');
  const provider = parts[0] || 'Unknown';
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

// Extract model name (same as UserMessagesScreen)
function extractModelName(model: RoutstrModel): { provider: string; modelName: string } {
  const provider = extractProviderFromSlug(model.canonical_slug);
  const slugParts = model.canonical_slug.split('/');
  let modelName = slugParts[1] || model.name;
  modelName = modelName.replace(/-\d{8}$/, '');

  if (model.name.includes(':')) {
    const nameParts = model.name.split(':');
    if (nameParts.length > 1) {
      modelName = nameParts[1].trim();
    }
  } else {
    modelName = model.name;
  }

  return { provider, modelName };
}

// Get provider icon (same mapping as UserMessagesScreen)
function getProviderIcon(provider: string): string {
  const providerLower = provider.toLowerCase();
  const iconMap: Record<string, string> = {
    openai: 'ri:openai-fill',
    anthropic: 'ri:anthropic-fill',
    google: 'ri:google-fill',
    meta: 'ri:meta-fill',
    mistralai: 'simple-icons:mistralai',
    perplexity: 'ri:perplexity-line',
    nvidia: 'bi:nvidia',
    qwen: 'hugeicons:qwen',
    deepseek: 'ri:deepseek-fill',
    alibaba: 'ant-design:alibaba-outlined',
    'x-ai': 'ri:twitter-x-fill',
    amazon: 'ri:amazon-fill',
    ibm: 'cib:ibm',
    microsoft: 'simple-icons:microsoft',
    cohere: 'mdi:robot',
  };
  return iconMap[providerLower] || 'mdi:robot';
}

// Get provider brand gradient colors
function getProviderGradient(provider: string): [string, string] {
  const providerLower = provider.toLowerCase();
  const gradientMap: Record<string, [string, string]> = {
    // OpenAI - Green brand color
    openai: ['#10a37f', '#0d8a6a'],
    // Anthropic - Orange/terracotta brand color
    anthropic: ['#D97757', '#c4684a'],
    // Google - Blue to green gradient
    google: ['#4285f4', '#34a853'],
    // Meta - Blue brand color
    meta: ['#0668E1', '#0553b8'],
    // Mistral - Orange brand color
    mistralai: ['#FF7000', '#e56300'],
    // xAI/Grok - Dark/black brand
    'x-ai': ['#2d2d2d', '#1a1a1a'],
    // DeepSeek - Purple/blue gradient
    deepseek: ['#5b6cf9', '#4158D0'],
    // Perplexity - Teal brand color
    perplexity: ['#20B2AA', '#1a9690'],
    // Nvidia - Green brand color
    nvidia: ['#76B900', '#5a8f00'],
    // Qwen/Alibaba - Orange
    qwen: ['#FF6A00', '#e55f00'],
    alibaba: ['#FF6A00', '#e55f00'],
    // Amazon - Orange brand
    amazon: ['#FF9900', '#e58a00'],
    // Microsoft - Blue brand
    microsoft: ['#00a4ef', '#0078d4'],
    // Cohere - Purple
    cohere: ['#7C3AED', '#6d28d9'],
  };
  return gradientMap[providerLower] || ['#6366f1', '#4f46e5'];
}

const BITREFILL_PRODUCTS = [
  {
    id: '1',
    name: 'Uber',
    category: 'Transport',
    discount: '2% back',
    image: require('assets/images/products/uber.png'),
    color: '#000000',
  },
  {
    id: '2',
    name: 'Amazon',
    category: 'Shopping',
    discount: '3% back',
    image: require('assets/images/products/amazon.png'), // placeholder
    color: '#FF9900',
  },
  {
    id: '3',
    name: 'Netflix',
    category: 'Entertainment',
    discount: '5% back',
    image: require('assets/images/products/netflix.png'), // placeholder
    color: '#E50914',
  },
  {
    id: '4',
    name: 'Spotify',
    category: 'Music',
    discount: '4% back',
    image: require('assets/images/products/spotify.png'), // placeholder
    color: '#1DB954',
  },
  {
    id: '5',
    name: 'Apple',
    category: 'Tech',
    discount: '2% back',
    image: require('assets/images/products/apple.png'), // placeholder
    color: '#555555',
  },
  {
    id: '6',
    name: 'Steam',
    category: 'Gaming',
    discount: '3% back',
    image: require('assets/images/products/steam.png'), // placeholder
    color: '#1b2838',
  },
  {
    id: '7',
    name: 'Airbnb',
    category: 'Travel',
    discount: '4% back',
    image: require('assets/images/products/airbnb.png'), // placeholder
    color: '#FF5A5F',
  },
  {
    id: '8',
    name: 'DoorDash',
    category: 'Food',
    discount: '3% back',
    image: require('assets/images/products/doordash.png'), // placeholder
    color: '#FF3008',
  },
];

const BITCOIN_CONFERENCES = [
  {
    id: '1',
    name: 'Plan ₿ Forum El Salvador',
    location: 'San Salvador, El Salvador',
    date: 'Jan 30-31, 2026',
    image: 'https://images.unsplash.com/photo-1596422846543-75c6fc197f07?w=800',
    attendees: '2,000+',
    website: 'https://planb.sv/',
    discountCode: null,
  },
  {
    id: '2',
    name: 'Adopting Bitcoin Cape Town',
    location: 'Cape Town, South Africa',
    date: 'Jan 30-31, 2026',
    image: 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=800',
    attendees: '1,000+',
    website: 'https://za26.adoptingbitcoin.org/',
    discountCode: null,
  },
  {
    id: '3',
    name: 'BitBlockBoom 2026',
    location: 'Fort Worth, Texas',
    date: 'Apr 9-12, 2026',
    image: 'https://images.unsplash.com/photo-1531218150217-54595bc2b934?w=800',
    attendees: '3,000+',
    website: 'https://bitblockboom.com/',
    discountCode: null,
  },
  {
    id: '4',
    name: 'Bitcoin 2026',
    location: 'Las Vegas, Nevada',
    date: 'Apr 27-29, 2026',
    image: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800',
    attendees: '35,000+',
    website: 'https://b.tc/conference/2026',
    discountCode: 'CYBORG',
  },
  {
    id: '5',
    name: 'Oslo Freedom Forum',
    location: 'Oslo, Norway',
    date: 'Jun 1-3, 2026',
    image: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=800',
    attendees: '1,500+',
    website: 'https://oslofreedomforum.com/event/oslo-freedom-forum-2026/',
    discountCode: null,
  },
  {
    id: '6',
    name: 'Bitcoin FilmFest',
    location: 'Warsaw, Poland',
    date: 'Jun 4-7, 2026',
    image: 'https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=800',
    attendees: '210',
    website: 'https://bitcoinfilmfest.com/bff26/',
    discountCode: null,
  },
  {
    id: '7',
    name: 'BTC Prague 2026',
    location: 'Prague, Czech Republic',
    date: 'Jun 11-13, 2026',
    image: 'https://images.unsplash.com/photo-1519677100203-a0e668c92439?w=800',
    attendees: '10,000+',
    website: 'https://btcprague.com/',
    discountCode: 'FOMO',
  },
  {
    id: '8',
    name: 'Baltic Honeybadger',
    location: 'Riga, Latvia',
    date: 'Aug 2026 (TBA)',
    image: 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=800',
    attendees: '2,000+',
    website: 'https://baltichoneybadger.com/',
    discountCode: null,
  },
  {
    id: '9',
    name: 'Bitcoin Hong Kong',
    location: 'Hong Kong',
    date: 'Aug 27-28, 2026',
    image: 'https://images.unsplash.com/photo-1536599018102-9f803c140fc1?w=800',
    attendees: '5,000+',
    website: 'https://asia.b.tc/2026',
    discountCode: 'DISCO',
  },
  {
    id: '10',
    name: 'Bitcoin Amsterdam',
    location: 'Amsterdam, Netherlands',
    date: 'Autumn 2026 (TBA)',
    image: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=800',
    attendees: '5,000+',
    website: 'https://www.bitcoin.amsterdam/',
    discountCode: null,
  },
  {
    id: '11',
    name: 'Plan ₿ Forum Lugano',
    location: 'Lugano, Switzerland',
    date: 'Oct 23-24, 2026',
    image: 'https://images.unsplash.com/photo-1527668752968-14dc70a27c95?w=800',
    attendees: '4,000+',
    website: 'https://planb.lugano.ch/planb-forum/',
    discountCode: null,
  },
  {
    id: '12',
    name: 'Africa Bitcoin Conference',
    location: 'Location TBA',
    date: 'Dec 2026 (TBA)',
    image: 'https://images.unsplash.com/photo-1547471080-7cc2caa01a7e?w=800',
    attendees: '1,500+',
    website: 'https://afrobitcoin.org/',
    discountCode: null,
  },
  {
    id: '13',
    name: 'Bitcoin MENA',
    location: 'Abu Dhabi, UAE',
    date: 'Dec 2025',
    image: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=800',
    attendees: '12,000+',
    website: 'https://mena.b.tc/',
    discountCode: 'CYBORG',
  },
];

const PRODUCT_CATEGORIES = [
  { id: '1', name: 'All', icon: 'fluent:apps-16-filled' },
  { id: '2', name: 'Gaming', icon: 'mdi:gamepad-variant' },
  { id: '3', name: 'Food', icon: 'mdi:food' },
  { id: '4', name: 'Travel', icon: 'mdi:airplane' },
  { id: '5', name: 'Shopping', icon: 'mdi:shopping' },
  { id: '6', name: 'Entertainment', icon: 'mdi:movie-open' },
];

// ============================================================================
// Components
// ============================================================================

// Section Header
const SectionHeader = ({
  title,
  subtitle,
  action,
  onAction,
}: {
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
}) => {
  const foreground = useThemeColor('foreground');

  return (
    <HStack align="center" style={{ paddingHorizontal: 20, marginBottom: 16 }}>
      <VStack style={{ flex: 1 }}>
        <Text size={22} heavy style={{ color: opacity(foreground, 0.9), letterSpacing: -0.5 }}>
          {title}
        </Text>
        {subtitle && (
          <Text size={13} style={{ color: opacity(foreground, 0.66), marginTop: 2 }}>
            {subtitle}
          </Text>
        )}
      </VStack>
      {action && (
        <TouchableOpacity onPress={onAction} activeOpacity={0.7}>
          <Text size={14} heavy style={{ color: opacity(foreground, 0.5) }}>
            {action}
          </Text>
        </TouchableOpacity>
      )}
    </HStack>
  );
};

// AI Model Card
const AIModelCard = ({ model }: { model: RoutstrModel }) => {
  const { provider, modelName } = extractModelName(model);
  const icon = getProviderIcon(provider);
  const gradient = getProviderGradient(provider);

  return (
    <Link
      href={{
        pathname: '/userMessages',
        params: { pubkey: ROUTSTR_PUBKEY, model: model.id },
      }}
      asChild>
      <TouchableOpacity activeOpacity={0.9} style={styles.aiModelCard}>
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.aiModelContent}>
          <View style={styles.aiModelIcon}>
            <Icon name={icon} size={24} color="#fff" />
          </View>
          <VStack style={{ flex: 1 }}>
            <Text size={16} heavy style={{ color: '#fff' }} numberOfLines={1}>
              {modelName}
            </Text>
            <Text size={12} style={{ color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
              {provider}
            </Text>
          </VStack>
          <Icon name="mdi:chevron-right" size={22} color="rgba(255,255,255,0.5)" />
        </View>
        <VStack style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 8 }}>
          {model.description && (
            <Text size={11} style={{ color: 'rgba(255,255,255,0.75)' }} numberOfLines={2}>
              {model.description}
            </Text>
          )}
          {model.sats_pricing && (
            <View style={styles.aiModelBadge}>
              <Text size={10} heavy style={{ color: '#fff' }}>
                {model.sats_pricing.prompt < 1 ? '<1' : Math.round(model.sats_pricing.prompt)}
                {' sats/1M tokens'}
              </Text>
            </View>
          )}
        </VStack>
      </TouchableOpacity>
    </Link>
  );
};

// Map Teaser Card
const MapTeaserCard = () => {
  const [foreground, surfaceSecondary] = useThemeColor(['foreground', 'surface-secondary'] as const);
  const { placesCache, fetchPlaces } = useBTCMapStore(
    useShallow((s) => ({ placesCache: s.placesCache, fetchPlaces: s.fetchPlaces }))
  );

  // Pre-fetch places when component mounts (will use cache if available)
  useEffect(() => {
    fetchPlaces().catch(() => {
      // Silently fail - we'll show fallback count
    });
  }, [fetchPlaces]);

  // Prewarm the clustering index off the critical path so opening the modal is faster.
  useEffect(() => {
    if (!placesCache?.data?.length || !placesCache.timestamp) return;

    let task: { cancel: () => void } | null = null;
    const timer = setTimeout(() => {
      task = InteractionManager.runAfterInteractions(async () => {
        // Lazy import to avoid pulling clustering code into initial Explore render
        const { prewarmBTCMapClusterManager } = await import('@/utils/btcMapClusterCache');
        const points = placesCache.data.map((p) => ({
          id: p.id,
          lat: p.lat,
          lon: p.lon,
          icon: p.icon,
        }));
        prewarmBTCMapClusterManager(`btcmap:${placesCache.timestamp}:all`, points, {
          radius: 50,
          maxZoom: 17,
          minPoints: 2,
        });
      });
    }, 800);

    return () => {
      clearTimeout(timer);
      task?.cancel();
    };
  }, [placesCache?.timestamp, placesCache?.data]);

  const placesCount = placesCache?.data.length ?? 0;
  const displayCount =
    placesCount > 0 ? `${placesCount.toLocaleString()} locations` : '30,000+ locations';

  return (
    <Link href="/(map-flow)" asChild>
      <TouchableOpacity activeOpacity={0.9} style={styles.mapCard}>
        {/* Image section */}
        <View style={styles.mapImageSection}>
          <Image
            source={require('assets/images/pos.png')}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
          />
          <View style={styles.mapBadgeOverlay}>
            <View style={styles.mapBadge}>
              <Icon name="mdi:map-marker" size={16} color="#fff" />
              <Text size={12} heavy style={{ color: '#fff', marginLeft: 4 }}>
                {displayCount}
              </Text>
            </View>
          </View>
        </View>

        {/* Text section */}
        <View style={[styles.mapTextSection, { backgroundColor: surfaceSecondary }]}>
          <VStack>
            <Text size={18} heavy style={{ color: opacity(foreground, 0.9), marginBottom: 4 }}>
              Find Bitcoin Merchants
            </Text>
            <Text size={13} style={{ color: opacity(foreground, 0.5) }}>
              Discover shops, restaurants & services accepting Bitcoin
            </Text>
          </VStack>
          <View
            style={[
              styles.mapButton,
              { backgroundColor: opacity(foreground, 0.15), marginTop: 12 },
            ]}>
            <Text size={14} heavy style={{ color: '#fff' }}>
              Explore Map
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </Link>
  );
};

// Category Pill
const CategoryPill = ({
  name,
  icon,
  isActive,
  onPress,
}: {
  name: string;
  icon: string;
  isActive: boolean;
  onPress: () => void;
}) => {
  const foreground = useThemeColor('foreground');

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[
        styles.categoryPill,
        {
          backgroundColor: isActive ? opacity(foreground, 0.12) : opacity(foreground, 0.06),
          borderColor: isActive ? opacity(foreground, 0.25) : 'transparent',
        },
      ]}>
      <Icon
        name={icon}
        size={16}
        color={isActive ? opacity(foreground, 0.5) : opacity(foreground, 0.4)}
      />
      <Text
        size={13}
        heavy
        style={{
          color: isActive ? opacity(foreground, 0.66) : opacity(foreground, 0.4),
          marginLeft: 6,
        }}>
        {name}
      </Text>
    </TouchableOpacity>
  );
};

// Product Card with Image
const ProductCard = ({ product }: { product: (typeof BITREFILL_PRODUCTS)[0] }) => {
  const foreground = useThemeColor('foreground');

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      style={styles.productCard}
      onPress={() => popup('not_implemented')}>
      <View style={styles.productImageContainer}>
        <Image source={product.image} style={StyleSheet.absoluteFillObject} contentFit="cover" />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.4)']}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.productDiscount}>
          <Text size={11} heavy style={{ color: '#fff' }}>
            {product.discount}
          </Text>
        </View>
      </View>
      <VStack style={styles.productInfo}>
        <Text size={15} heavy style={{ color: opacity(foreground, 0.9) }} numberOfLines={1}>
          {product.name}
        </Text>
        <Text size={12} style={{ color: opacity(foreground, 0.4), marginTop: 2 }}>
          {product.category}
        </Text>
      </VStack>
    </TouchableOpacity>
  );
};

// Conference Card
const ConferenceCard = ({ conference }: { conference: (typeof BITCOIN_CONFERENCES)[0] }) => {
  const foreground = useThemeColor('foreground');

  const handlePress = useCallback(() => {
    if (conference.website) {
      Linking.openURL(conference.website);
    }
  }, [conference.website]);

  return (
    <TouchableOpacity activeOpacity={0.9} style={styles.conferenceCard} onPress={handlePress}>
      <Image
        source={{ uri: conference.image }}
        style={styles.conferenceImage}
        contentFit="cover"
        cachePolicy="disk"
        recyclingKey={conference.image}
        transition={200}
      />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.9)']}
        style={[StyleSheet.absoluteFillObject, { top: '40%' }]}
      />
      {conference.discountCode && (
        <View style={styles.discountBadge}>
          <Icon name="mdi:ticket-percent" size={12} color="#fff" />
          <Text size={10} heavy style={{ color: '#fff', marginLeft: 4 }}>
            {conference.discountCode}
          </Text>
        </View>
      )}
      <View style={styles.conferenceInfo}>
        <Text size={16} heavy style={{ color: '#fff' }} numberOfLines={1}>
          {conference.name}
        </Text>
        <HStack align="center" style={{ marginTop: 4 }}>
          <Icon name="mdi:map-marker" size={12} color="rgba(255,255,255,0.7)" />
          <Text
            size={12}
            style={{ color: 'rgba(255,255,255,0.7)', marginLeft: 4 }}
            numberOfLines={1}>
            {conference.location}
          </Text>
        </HStack>
        <HStack align="center" style={{ marginTop: 8, gap: 12 }}>
          <HStack align="center">
            <Icon name="mdi:calendar" size={12} color={opacity(foreground, 0.5)} />
            <Text size={11} style={{ color: opacity(foreground, 0.5), marginLeft: 4 }}>
              {conference.date}
            </Text>
          </HStack>
          <HStack align="center">
            <Icon name="mdi:account-group" size={12} color={opacity(foreground, 0.4)} />
            <Text size={11} style={{ color: opacity(foreground, 0.4), marginLeft: 4 }}>
              {conference.attendees}
            </Text>
          </HStack>
        </HStack>
      </View>
    </TouchableOpacity>
  );
};

// Lightning Address Card - Custom username purchase
const LightningAddressCard = () => {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const { keys: nostrKeys } = useNostrKeysContext();
  const hero = useHeroTransition();
  const cardRef = useRef<any>(null);

  const currentAddress = nostrKeys?.npub
    ? `${truncateMiddle(nostrKeys.npub, 5)}@npubx.cash`
    : 'npub...@npubx.cash';

  const handlePress = useCallback(() => {
    hero.registerRef('claimUsername', 'source', cardRef.current);
    hero.startClaimUsername();
  }, [hero]);

  // Animated press state: GPU-accelerated scale + opacity (skill 3.3 / 7.1)
  const pressed = useSharedValue(0);

  const tap = Gesture.Tap()
    .onBegin(() => {
      pressed.set(withTiming(1, { duration: 150 }));
    })
    .onFinalize(() => {
      pressed.set(withTiming(0, { duration: 200 }));
    })
    .onEnd(() => {
      runOnJS(handlePress)();
    });

  const pressAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.get(), [0, 1], [1, 0.975]) }],
    opacity: interpolate(pressed.get(), [0, 1], [1, 0.92]),
  }));

  // Gold accent color for premium/custom names
  const accentColor = '#f59e0b';

  return (
    <GestureDetector gesture={tap}>
      <Animated.View style={pressAnimStyle}>
        <RNView style={[styles.lightningAddressCard, { borderColor: opacity(accentColor, 0.3) }]}>
          <RNView
            ref={cardRef}
            collapsable={false}
            onLayout={() => hero.registerRef('claimUsername', 'source', cardRef.current)}
            shouldRasterizeIOS
            renderToHardwareTextureAndroid
            style={{ opacity: hero.isHidden('claimUsername', 'source') ? 0 : 1 }}>
            <ClaimUsernameCardFrame
              accentColor={accentColor}
              backgroundColor={background}
              highlightColor={opacity(foreground, 0.9)}>
              <VStack style={{ padding: 20, zIndex: 1 }}>
                {/* Header */}
                <HStack align="center" style={{ marginBottom: 16 }}>
                  <View
                    style={[
                      styles.lightningAddressIcon,
                      { backgroundColor: opacity(accentColor, 0.15) },
                    ]}>
                    <Icon name="mingcute:lightning-fill" size={20} color={accentColor} />
                  </View>
                  <VStack style={{ flex: 1, marginLeft: 12 }}>
                    <Text size={18} heavy style={{ color: opacity(foreground, 0.9) }}>
                      Claim Your Address
                    </Text>
                    <Text size={12} style={{ color: opacity(accentColor, 0.7) }}>
                      Get a memorable Lightning URL
                    </Text>
                  </VStack>
                  <View
                    style={[
                      styles.lightningAddressBadge,
                      {
                        backgroundColor: opacity(accentColor, 0.15),
                        borderColor: opacity(accentColor, 0.3),
                      },
                    ]}>
                    <Text size={10} heavy style={{ color: accentColor }}>
                      PREMIUM
                    </Text>
                  </View>
                </HStack>

                {/* Address comparison */}
                <VStack style={{ gap: 12 }}>
                  {/* Current address (before) */}
                  <VStack>
                    <Text
                      size={10}
                      heavy
                      style={{ color: opacity(accentColor, 0.6), marginBottom: 4 }}>
                      YOUR CURRENT ADDRESS
                    </Text>
                    <View style={[styles.addressBox, { borderColor: opacity(accentColor, 0.2) }]}>
                      <Icon
                        name="mdi:close-circle"
                        size={16}
                        color="#ef4444"
                        style={{ marginRight: 8 }}
                      />
                      <Text
                        size={13}
                        mono
                        style={{ color: opacity(accentColor, 0.7) }}
                        numberOfLines={1}>
                        {currentAddress}
                      </Text>
                    </View>
                  </VStack>

                  {/* Arrow */}
                  <HStack align="center" justify="center">
                    <View
                      style={[
                        styles.addressArrowLine,
                        { backgroundColor: opacity(accentColor, 0.3) },
                      ]}
                    />
                    <View
                      style={[
                        styles.addressArrowIcon,
                        { backgroundColor: opacity(accentColor, 0.15) },
                      ]}>
                      <Icon name="mdi:arrow-down" size={16} color={accentColor} />
                    </View>
                    <View
                      style={[
                        styles.addressArrowLine,
                        { backgroundColor: opacity(accentColor, 0.3) },
                      ]}
                    />
                  </HStack>

                  {/* Custom address (after) */}
                  <VStack>
                    <Text
                      size={10}
                      heavy
                      style={{ color: opacity(accentColor, 0.6), marginBottom: 4 }}>
                      YOUR CUSTOM ADDRESS
                    </Text>
                    <View
                      style={[
                        styles.addressBox,
                        {
                          backgroundColor: opacity(accentColor, 0.1),
                          borderColor: opacity(accentColor, 0.3),
                        },
                      ]}>
                      <Icon
                        name="mdi:check-circle"
                        size={16}
                        color="#22c55e"
                        style={{ marginRight: 8 }}
                      />
                      <Text size={14} mono style={{ color: opacity(foreground, 0.9) }}>
                        satoshi
                      </Text>
                      <Text size={14} mono style={{ color: opacity(accentColor, 0.7) }}>
                        @npubx.cash
                      </Text>
                    </View>
                  </VStack>
                </VStack>

                {/* Benefits */}
                <HStack style={{ marginTop: 16, gap: 16 }}>
                  <HStack align="center">
                    <Icon name="mdi:share-variant" size={14} color={opacity(accentColor, 0.6)} />
                    <Text size={11} style={{ color: opacity(accentColor, 0.6), marginLeft: 4 }}>
                      Easy to share
                    </Text>
                  </HStack>
                  <HStack align="center">
                    <Icon name="mdi:qrcode" size={14} color={opacity(accentColor, 0.6)} />
                    <Text size={11} style={{ color: opacity(accentColor, 0.6), marginLeft: 4 }}>
                      Scannable QR
                    </Text>
                  </HStack>
                  <HStack align="center">
                    <Icon name="mdi:account-check" size={14} color={opacity(accentColor, 0.6)} />
                    <Text size={11} style={{ color: opacity(accentColor, 0.6), marginLeft: 4 }}>
                      Memorable
                    </Text>
                  </HStack>
                </HStack>

                {/* CTA row (match Wallet Health “View health details” style) */}
                <View
                  style={[
                    styles.lightningAddressCTA,
                    {
                      backgroundColor: opacity(accentColor, 0.12),
                      borderColor: opacity(accentColor, 0.22),
                    },
                  ]}>
                  <HStack align="center" justify="space-between">
                    <HStack align="center" gap={8}>
                      <Icon
                        name="mingcute:lightning-fill"
                        size={16}
                        color={opacity(accentColor, 0.9)}
                      />
                      <Text size={12} heavy style={{ color: opacity(foreground, 0.9) }}>
                        Get your username
                      </Text>
                    </HStack>
                    <Icon name="mdi:arrow-right" size={18} color={opacity(foreground, 0.9)} />
                  </HStack>
                </View>
              </VStack>
            </ClaimUsernameCardFrame>
          </RNView>
        </RNView>
      </Animated.View>
    </GestureDetector>
  );
};

// Pending Ecash Card - Shows pending send operations that can be reclaimed
// Styled to match WalletHealthCard with a green color scheme + hero transition
const PendingEcashCard = () => {
  const [foreground, background, green400] = useThemeColor(['foreground', 'background', 'green-400'] as const);
  const { history } = usePaginatedHistory();
  const hero = useHeroTransition();
  const cardRef = useRef<any>(null);

  const primary50 = useMemo(() => opacity(foreground, 0.9), [foreground]);
  const accentColor = green400;

  // Filter pending send transactions
  const pendingSends = useMemo(() => {
    return history.filter(
      (entry) => entry.type === 'send' && (entry.state === 'pending' || entry.state === 'prepared')
    );
  }, [history]);

  // Calculate totals
  const totalAmount = useMemo(() => {
    return pendingSends.reduce((sum, tx) => sum + tx.amount, 0);
  }, [pendingSends]);

  const unit = pendingSends[0]?.unit || 'sat';

  const handlePress = useCallback(() => {
    hero.registerRef('pendingEcash', 'source', cardRef.current);
    hero.startPendingEcash();
  }, [hero]);

  // Animated press state: GPU-accelerated scale + opacity (skill 3.3 / 7.1)
  const pressed = useSharedValue(0);

  const tap = Gesture.Tap()
    .onBegin(() => {
      pressed.set(withTiming(1, { duration: 150 }));
    })
    .onFinalize(() => {
      pressed.set(withTiming(0, { duration: 200 }));
    })
    .onEnd(() => {
      runOnJS(handlePress)();
    });

  const pressAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.get(), [0, 1], [1, 0.975]) }],
    opacity: interpolate(pressed.get(), [0, 1], [1, 0.92]),
  }));

  // Don't show card if no pending transactions
  if (pendingSends.length === 0) {
    return null;
  }

  return (
    <GestureDetector gesture={tap}>
      <Animated.View style={pressAnimStyle}>
        <RNView
          ref={cardRef}
          collapsable={false}
          onLayout={() => hero.registerRef('pendingEcash', 'source', cardRef.current)}
          shouldRasterizeIOS
          renderToHardwareTextureAndroid
          style={[
            styles.pendingEcashCard,
            {
              borderColor: opacity(accentColor, 0.25),
              opacity: hero.isHidden('pendingEcash', 'source') ? 0 : 1,
            },
          ]}>
          <PendingEcashCardFrame
            accentColor={accentColor}
            backgroundColor={background}
            highlightColor={primary50}>
            <VStack style={{ padding: 18 }}>
              <HStack align="center" justify="space-between">
                <HStack align="center" gap={10}>
                  <View
                    style={[
                      styles.pendingEcashIcon,
                      { backgroundColor: opacity(accentColor, 0.16) },
                    ]}>
                    <Icon name="mdi:clock-alert-outline" size={22} color={accentColor} />
                  </View>
                  <VStack>
                    <Text size={16} heavy style={{ color: primary50 }}>
                      Pending Ecash
                    </Text>
                    <HStack align="center" gap={8} style={{ marginTop: 6 }}>
                      <View
                        style={[
                          styles.pendingUnitPill,
                          {
                            backgroundColor: opacity(accentColor, 0.14),
                            borderColor: opacity(accentColor, 0.22),
                          },
                        ]}>
                        <Text size={10} heavy style={{ color: opacity(accentColor, 0.9) }}>
                          {pendingSends.length} {pendingSends.length === 1 ? 'TOKEN' : 'TOKENS'}
                        </Text>
                      </View>
                      <Text size={11} style={{ color: opacity(accentColor, 0.7) }}>
                        Tap to reclaim
                      </Text>
                    </HStack>
                  </VStack>
                </HStack>
                <Icon name="mdi:chevron-right" size={22} color={opacity(primary50, 0.85)} />
              </HStack>

              {/* Amount display row */}
              <HStack align="center" style={{ marginTop: 14, gap: 16, flexWrap: 'wrap' }}>
                <HStack align="center" gap={4}>
                  <AmountFormatter
                    amount={totalAmount}
                    unit={unit}
                    size={13}
                    weight="medium"
                    color={opacity(accentColor, 0.8)}
                  />
                  <Text size={11} style={{ color: opacity(accentColor, 0.8) }}>
                    unclaimed
                  </Text>
                </HStack>
              </HStack>

              {/* CTA row */}
              <View
                style={[
                  styles.pendingEcashCTA,
                  {
                    backgroundColor: opacity(accentColor, 0.12),
                    borderColor: opacity(accentColor, 0.22),
                  },
                ]}>
                <HStack align="center" justify="space-between">
                  <HStack align="center" gap={8}>
                    <Icon
                      name="fluent:arrow-download-16-filled"
                      size={16}
                      color={opacity(accentColor, 0.9)}
                    />
                    <Text size={12} heavy style={{ color: primary50 }}>
                      View & Reclaim
                    </Text>
                  </HStack>
                  <Icon name="mdi:arrow-right" size={18} color={primary50} />
                </HStack>
              </View>
            </VStack>
          </PendingEcashCardFrame>
        </RNView>
      </Animated.View>
    </GestureDetector>
  );
};

// ============================================================================
// Main Component
// ============================================================================

const ExploreScreen = () => {
  useBackgroundConfig({ blurMode: 'full' });
  const foreground = useThemeColor('foreground');
  const [contentHeight, setContentHeight] = useState(0);
  const [activeCategory, setActiveCategory] = useState('All');
  const devMode = useSettingsStore((state) => state.experimental);

  // Routstr models state
  const { getCachedModels, setCachedModels, isCacheStale } = useRoutstrStore();
  const [models, setModels] = useState<RoutstrModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  // Use the same hardcoded API key as UserMessagesScreen for now
  // const routstrApiKey = 'sk-15dbf6b51cd389246da366c26499bde801c04795b372b8c4ff0241e3bbe3120c';

  // Fetch models from Routstr
  useEffect(() => {
    const loadModels = async () => {
      // Check cache first
      const cachedModels = getCachedModels();
      if (cachedModels && cachedModels.length > 0) {
        setModels(cachedModels);
        setModelsLoading(false);

        // Refresh in background if stale
        if (isCacheStale()) {
          try {
            const freshModels = await getModels();
            setModels(freshModels);
            setCachedModels(freshModels);
          } catch (error) {
            console.error('Failed to refresh models:', error);
          }
        }
        return;
      }

      try {
        const fetchedModels = await getModels();
        setModels(fetchedModels);
        setCachedModels(fetchedModels);
      } catch (error) {
        console.error('Failed to fetch models:', error);
      }
      setModelsLoading(false);
    };

    loadModels();
  }, [getCachedModels, setCachedModels, isCacheStale]);

  // Filter models to show - one per provider, in specific order, text-only
  const displayModels = useMemo(() => {
    if (models.length === 0) return [];

    // Only keep models that accept text input and produce text-only output
    // (excludes audio, image, video, and embeddings models)
    const textModels = models.filter((m) => {
      const outputs = m.architecture?.output_modalities ?? [];
      const inputs = m.architecture?.input_modalities ?? [];
      return inputs.includes('text') && outputs.length > 0 && outputs.every((o) => o === 'text');
    });

    // Providers to show, in order
    const allowedProviders = [
      'openai',
      'anthropic',
      'x-ai',
      'google',
      'microsoft',
      'amazon',
      'qwen',
      'perplexity',
      'mistralai',
      'nvidia',
    ];

    // Find one model for each provider in order
    const result: RoutstrModel[] = [];

    for (const targetProvider of allowedProviders) {
      const model = textModels.find((m) => {
        const { provider } = extractModelName(m);
        return provider.toLowerCase() === targetProvider;
      });

      if (model) {
        result.push(model);
      }
    }

    return result;
  }, [models]);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    setContentHeight(height);
  }, []);

  return (
    <LayoutDebugWrapper
      onContentSizeChange={onContentSizeChange}
      contentContainerStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}>
      <ScrollableGradientOverlay contentHeight={contentHeight} />

      <VStack style={{ paddingBottom: 96 }}>
        {/* AI Chat Section */}
        <SectionHeader
          title="AI Assistants"
          subtitle="Chat with leading AI models, pay with sats"
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 12, minHeight: 140 }}>
          {modelsLoading ? (
            <View style={styles.modelsLoadingContainer}>
              <ActivityIndicator size="small" color={opacity(foreground, 0.5)} />
              <Text size={12} style={{ color: opacity(foreground, 0.4), marginTop: 8 }}>
                Loading models...
              </Text>
            </View>
          ) : displayModels.length > 0 ? (
            displayModels.map((model) => <AIModelCard key={model.id} model={model} />)
          ) : (
            <View style={styles.modelsEmptyContainer}>
              <Icon name="mdi:robot" size={32} color={opacity(foreground, 0.33)} />
              <Text size={13} style={{ color: opacity(foreground, 0.4), marginTop: 8 }}>
                No models available
              </Text>
            </View>
          )}
        </ScrollView>

        <Spacer size={32} />

        {/* Pending Ecash Section - only shows when there are pending transactions */}
        <Animated.View
          entering={FadeInUp.duration(380).delay(80)}
          style={{ paddingHorizontal: 20 }}>
          <PendingEcashCard />
        </Animated.View>

        <Spacer size={32} />

        {/* Lightning Address Section - hidden unless dev mode */}
        {devMode ? (
          <>
            <SectionHeader
              title="Your Lightning Address"
              subtitle="Receive Bitcoin with a memorable URL"
            />
            <Animated.View
              entering={FadeInUp.duration(380).delay(160)}
              style={{ paddingHorizontal: 20 }}>
              <LightningAddressCard />
            </Animated.View>

            <Spacer size={32} />
          </>
        ) : null}

        {/* Wallet Health - hidden unless dev mode */}
        {devMode ? (
          <>
            <SectionHeader
              title="Wallet Health"
              subtitle="Check distribution drift, pending outgoing ecash, and more"
            />
            <Animated.View
              entering={FadeInUp.duration(380).delay(240)}
              style={{ paddingHorizontal: 20 }}>
              <WalletHealthCard defaultUnit="sat" />
            </Animated.View>

            <Spacer size={32} />
          </>
        ) : null}

        {/* Map Section */}
        <SectionHeader title="Discover" subtitle="Find places that accept Bitcoin" />
        <View style={{ paddingHorizontal: 20 }}>
          <MapTeaserCard />
        </View>

        <Spacer size={32} />

        {/* Shop with Bitcoin - hidden unless dev mode */}
        {devMode ? (
          <>
            <SectionHeader
              title="Shop with Bitcoin"
              subtitle="Gift cards & vouchers"
              action="See all"
              onAction={() => popup('not_implemented')}
            />

            {/* Category Pills */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 8, marginBottom: 16 }}>
              {PRODUCT_CATEGORIES.map((cat) => (
                <CategoryPill
                  key={cat.id}
                  name={cat.name}
                  icon={cat.icon}
                  isActive={activeCategory === cat.name}
                  onPress={() => setActiveCategory(cat.name)}
                />
              ))}
            </ScrollView>

            {/* Product Cards - 2 column grid */}
            <View style={styles.productGrid}>
              {BITREFILL_PRODUCTS.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </View>

            <Spacer size={32} />
          </>
        ) : null}

        {/* Bitcoin Conferences - hidden unless dev mode */}
        {devMode ? (
          <>
            <SectionHeader
              title="Bitcoin Events"
              subtitle="Upcoming conferences & meetups"
              action="View all"
              onAction={() => popup('not_implemented')}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 16 }}>
              {BITCOIN_CONFERENCES.map((conf) => (
                <ConferenceCard key={conf.id} conference={conf} />
              ))}
            </ScrollView>

            <Spacer size={32} />
          </>
        ) : null}

        {/* eSIM Promo - hidden unless dev mode */}
        {devMode ? (
          <>
            <View style={{ paddingHorizontal: 20 }}>
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.esimPromo}
                onPress={() => Linking.openURL('https://sovran.money/esims')}>
                <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFillObject} />
                <LinearGradient
                  colors={['rgba(99,102,241,0.3)', 'rgba(139,92,246,0.3)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <HStack align="center" style={{ padding: 20 }}>
                  <View style={styles.esimPromoIcon}>
                    <Icon name="mdi:sim" size={28} color="#fff" />
                  </View>
                  <VStack style={{ flex: 1, marginLeft: 16 }}>
                    <Text size={16} heavy style={{ color: '#fff' }}>
                      Travel with Bitcoin
                    </Text>
                    <Text size={13} style={{ color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
                      Get eSIMs for 190+ countries, pay with sats
                    </Text>
                  </VStack>
                  <View style={styles.esimPromoArrow}>
                    <Icon name="mdi:arrow-right" size={20} color="#fff" />
                  </View>
                </HStack>
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        <Spacer size={20} />
      </VStack>
    </LayoutDebugWrapper>
  );
};

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  aiModelCard: {
    width: 200,
    borderRadius: 16,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  aiModelBadge: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  aiModelContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
    gap: 12,
  },
  aiModelIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapCard: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  mapImageSection: {
    height: 140,
    position: 'relative',
  },
  mapBadgeOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
  },
  mapTextSection: {
    padding: 16,
  },
  mapBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  mapButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  productGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
  },
  productCard: {
    width: (SCREEN_WIDTH - 44) / 2,
    borderRadius: 16,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  productImageContainer: {
    height: 100,
    position: 'relative',
  },
  productDiscount: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  productInfo: {
    padding: 12,
  },
  conferenceCard: {
    width: 260,
    height: 180,
    borderRadius: 16,
    borderCurve: 'continuous',
    overflow: 'hidden',
    position: 'relative',
  },
  conferenceImage: {
    ...StyleSheet.absoluteFillObject,
  },
  conferenceInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
  },
  discountBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245,158,11,0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  esimPromo: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  esimPromoIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  esimPromoArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelsLoadingContainer: {
    width: 200,
    height: 140,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelsEmptyContainer: {
    width: 200,
    height: 140,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Lightning Address Card styles
  lightningAddressCard: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  lightningDecorationLeft: {
    position: 'absolute',
    top: -20,
    left: -20,
    transform: [{ rotate: '-15deg' }],
  },
  lightningDecorationRight: {
    position: 'absolute',
    bottom: -30,
    right: -30,
    transform: [{ rotate: '15deg' }],
  },
  lightningAddressIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightningAddressBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  addressBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  addressArrowLine: {
    flex: 1,
    height: 1,
  },
  addressArrowIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 12,
  },
  lightningAddressCTA: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  // Pending Ecash Card styles (matches WalletHealthCard pattern)
  pendingEcashCard: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  // pendingDecorationLeft/Right moved to PendingEcashCardFrame
  pendingEcashIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingUnitPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  pendingEcashCTA: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});

export default ExploreScreen;

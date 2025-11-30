import Icon from 'assets/icons';
import { AnimatedBackgroundView, ScrollableGradientOverlay } from 'components/ui/BackgroundView';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { HStack, Spacer, View, VStack } from 'components/ui/View';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Link } from 'expo-router';
import { ROUTSTR_PUBKEY } from 'helper/constants';
import { popup } from 'helper/popup';
import { getModels, RoutstrModel } from 'helper/routstr/api';
import opacity from 'hex-color-opacity';
import { useBackgroundConfig } from 'providers/BackgroundProvider';
import { useTheme } from 'providers/ThemeProvider';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, ScrollView, StyleSheet } from 'react-native';
import { useBTCMapStore } from 'stores/btcMapStore';
import { useRoutstrStore } from 'stores/routstrStore';

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
    name: 'Bitcoin 2025',
    location: 'Las Vegas, USA',
    date: 'May 27-29, 2025',
    image: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800',
    attendees: '35,000+',
    hasEsim: true,
  },
  {
    id: '2',
    name: 'Baltic Honeybadger',
    location: 'Riga, Latvia',
    date: 'Sep 5-6, 2025',
    image: 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=800',
    attendees: '2,000+',
    hasEsim: true,
  },
  {
    id: '3',
    name: 'Adopting Bitcoin',
    location: 'San Salvador',
    date: 'Nov 15-16, 2025',
    image: 'https://images.unsplash.com/photo-1511578314322-379afb476865?w=800',
    attendees: '1,500+',
    hasEsim: true,
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
  const { getPrimaryColor } = useTheme();

  return (
    <HStack align="center" style={{ paddingHorizontal: 20, marginBottom: 16 }}>
      <VStack style={{ flex: 1 }}>
        <Text size={22} heavy style={{ color: getPrimaryColor('50'), letterSpacing: -0.5 }}>
          {title}
        </Text>
        {subtitle && (
          <Text size={13} style={{ color: getPrimaryColor('100'), marginTop: 2 }}>
            {subtitle}
          </Text>
        )}
      </VStack>
      {action && (
        <TouchableOpacity onPress={onAction} activeOpacity={0.7}>
          <Text size={14} heavy style={{ color: getPrimaryColor('300') }}>
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
  const { getPrimaryColor } = useTheme();
  const { placesCache, fetchPlaces } = useBTCMapStore();

  // Pre-fetch places when component mounts (will use cache if available)
  useEffect(() => {
    fetchPlaces().catch(() => {
      // Silently fail - we'll show fallback count
    });
  }, [fetchPlaces]);

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
        <View style={[styles.mapTextSection, { backgroundColor: getPrimaryColor('800') }]}>
          <VStack>
            <Text size={18} heavy style={{ color: getPrimaryColor('50'), marginBottom: 4 }}>
              Find Bitcoin Merchants
            </Text>
            <Text size={13} style={{ color: getPrimaryColor('300') }}>
              Discover shops, restaurants & services accepting Bitcoin
            </Text>
          </VStack>
          <View
            style={[styles.mapButton, { backgroundColor: getPrimaryColor('500'), marginTop: 12 }]}>
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
  const { getPrimaryColor } = useTheme();

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[
        styles.categoryPill,
        {
          backgroundColor: isActive
            ? opacity(getPrimaryColor('500'), 0.3)
            : opacity(getPrimaryColor('700'), 0.3),
          borderColor: isActive ? getPrimaryColor('500') : 'transparent',
        },
      ]}>
      <Icon
        name={icon}
        size={16}
        color={isActive ? getPrimaryColor('300') : getPrimaryColor('400')}
      />
      <Text
        size={13}
        heavy
        style={{
          color: isActive ? getPrimaryColor('200') : getPrimaryColor('400'),
          marginLeft: 6,
        }}>
        {name}
      </Text>
    </TouchableOpacity>
  );
};

// Product Card with Image
const ProductCard = ({ product }: { product: (typeof BITREFILL_PRODUCTS)[0] }) => {
  const { getPrimaryColor } = useTheme();

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
        <Text size={15} heavy style={{ color: getPrimaryColor('50') }} numberOfLines={1}>
          {product.name}
        </Text>
        <Text size={12} style={{ color: getPrimaryColor('400'), marginTop: 2 }}>
          {product.category}
        </Text>
      </VStack>
    </TouchableOpacity>
  );
};

// Conference Card
const ConferenceCard = ({ conference }: { conference: (typeof BITCOIN_CONFERENCES)[0] }) => {
  const { getPrimaryColor } = useTheme();

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      style={styles.conferenceCard}
      onPress={() => popup('not_implemented')}>
      <Image source={{ uri: conference.image }} style={styles.conferenceImage} contentFit="cover" />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.9)']}
        style={[StyleSheet.absoluteFillObject, { top: '40%' }]}
      />
      {conference.hasEsim && (
        <View style={styles.esimBadge}>
          <Icon name="mdi:sim" size={12} color="#fff" />
          <Text size={10} heavy style={{ color: '#fff', marginLeft: 4 }}>
            eSIM Available
          </Text>
        </View>
      )}
      <View style={styles.conferenceInfo}>
        <Text size={16} heavy style={{ color: '#fff' }} numberOfLines={1}>
          {conference.name}
        </Text>
        <HStack align="center" style={{ marginTop: 4 }}>
          <Icon name="mdi:map-marker" size={12} color="rgba(255,255,255,0.7)" />
          <Text size={12} style={{ color: 'rgba(255,255,255,0.7)', marginLeft: 4 }}>
            {conference.location}
          </Text>
        </HStack>
        <HStack align="center" style={{ marginTop: 8, gap: 12 }}>
          <HStack align="center">
            <Icon name="mdi:calendar" size={12} color={getPrimaryColor('300')} />
            <Text size={11} style={{ color: getPrimaryColor('300'), marginLeft: 4 }}>
              {conference.date}
            </Text>
          </HStack>
          <HStack align="center">
            <Icon name="mdi:account-group" size={12} color={getPrimaryColor('400')} />
            <Text size={11} style={{ color: getPrimaryColor('400'), marginLeft: 4 }}>
              {conference.attendees}
            </Text>
          </HStack>
        </HStack>
      </View>
    </TouchableOpacity>
  );
};

// ============================================================================
// Main Component
// ============================================================================

const ExploreScreen = () => {
  useBackgroundConfig({ blurMode: 'full' });
  const { getPrimaryColor } = useTheme();
  const [contentHeight, setContentHeight] = useState(0);
  const [activeCategory, setActiveCategory] = useState('All');

  // Routstr models state
  const { getCachedModels, setCachedModels, isCacheStale } = useRoutstrStore();
  const [models, setModels] = useState<RoutstrModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  // Use the same hardcoded API key as UserMessagesScreen for now
  const routstrApiKey = 'sk-15dbf6b51cd389246da366c26499bde801c04795b372b8c4ff0241e3bbe3120c';

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
            const freshModels = await getModels(routstrApiKey);
            setModels(freshModels);
            setCachedModels(freshModels);
          } catch (error) {
            console.error('Failed to refresh models:', error);
          }
        }
        return;
      }

      // No cache, fetch fresh
      try {
        const fetchedModels = await getModels(routstrApiKey);
        setModels(fetchedModels);
        setCachedModels(fetchedModels);
      } catch (error) {
        console.error('Failed to fetch models:', error);
      }
      setModelsLoading(false);
    };

    loadModels();
  }, [getCachedModels, setCachedModels, isCacheStale]);

  // Filter models to show - one per provider, in specific order
  const displayModels = useMemo(() => {
    if (models.length === 0) return [];

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
      const model = models.find((m) => {
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
    <AnimatedBackgroundView>
      <View className="flex-1">
        <ScrollView
          style={{ flex: 1 }}
          onContentSizeChange={onContentSizeChange}
          showsVerticalScrollIndicator={false}>
          <ScrollableGradientOverlay contentHeight={contentHeight} />

          <VStack style={{ paddingBottom: 96 }}>
            <Spacer size={110} />

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
                  <ActivityIndicator size="small" color={getPrimaryColor('300')} />
                  <Text size={12} style={{ color: getPrimaryColor('400'), marginTop: 8 }}>
                    Loading models...
                  </Text>
                </View>
              ) : displayModels.length > 0 ? (
                displayModels.map((model) => <AIModelCard key={model.id} model={model} />)
              ) : (
                <View style={styles.modelsEmptyContainer}>
                  <Icon name="mdi:robot" size={32} color={getPrimaryColor('500')} />
                  <Text size={13} style={{ color: getPrimaryColor('400'), marginTop: 8 }}>
                    No models available
                  </Text>
                </View>
              )}
            </ScrollView>

            <Spacer size={32} />

            {/* Map Section */}
            <SectionHeader title="Discover" subtitle="Find places that accept Bitcoin" />
            <View style={{ paddingHorizontal: 20 }}>
              <MapTeaserCard />
            </View>

            <Spacer size={32} />

            {/* Shop with Bitcoin */}
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

            {/* Bitcoin Conferences */}
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

            {/* eSIM Promo */}
            <View style={{ paddingHorizontal: 20 }}>
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.esimPromo}
                onPress={() => popup('not_implemented')}>
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

            <Spacer size={20} />
          </VStack>
        </ScrollView>
      </View>
    </AnimatedBackgroundView>
  );
};

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  aiModelCard: {
    width: 200,
    borderRadius: 16,
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
  esimBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(99,102,241,0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  esimPromo: {
    borderRadius: 20,
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
});

export default ExploreScreen;

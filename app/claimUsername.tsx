/**
 * @fileoverview Claim Username Modal
 *
 * Clean modal for claiming a custom Lightning address username.
 * Features:
 * - Hero input field for entering username
 * - Domain selector dropdown (npubx.cash, sovran.money)
 * - Real-time availability checking across all domains
 * - Bottom button to continue with claim process
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Keyboard,
  StyleSheet,
  Linking,
  View as RNView,
} from 'react-native';
import { Stack } from 'expo-router';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Text } from 'components/ui/Text';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { ModalLayoutWrapper } from 'app/debugModal';
import { useTheme } from 'providers/ThemeProvider';
import { withSheetProvider } from 'hocs/withSheetProvider';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { finalizeEvent } from 'nostr-tools';
import { useHeroTransition } from '@/components/ui/hero-transition/HeroTransitionProvider';
import { ClaimUsernameCardFrame } from 'components/blocks/claim/ClaimUsernameCardFrame';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withDelay,
} from 'react-native-reanimated';

// Available domains for Lightning addresses
const DOMAINS = [
  { id: 'npubx', label: 'npubx.cash', value: 'npubx.cash' },
  { id: 'sovran', label: 'sovran.money', value: 'sovran.money' },
] as const;

type DomainId = (typeof DOMAINS)[number]['id'];

interface AvailabilityResult {
  domain: string;
  available: boolean | null;
  loading: boolean;
  error?: string;
}

// Mock availability check - replace with actual API call
async function checkUsernameAvailability(
  username: string,
  _domain: string
): Promise<{ available: boolean; error?: string }> {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 600 + Math.random() * 400));

  // Mock logic: usernames less than 3 chars are invalid, some common names are taken
  if (username.length < 3) {
    return { available: false, error: 'Too short' };
  }

  const takenUsernames = ['satoshi', 'admin', 'bitcoin', 'test', 'user'];
  if (takenUsernames.includes(username.toLowerCase())) {
    return { available: false };
  }

  // 90% chance of being available for demo purposes
  return { available: Math.random() > 0.1 };
}

// Username input with inline domain display
function UsernameInput({
  value,
  onChangeText,
  selectedDomain,
  isChecking,
  accentColor,
}: {
  value: string;
  onChangeText: (text: string) => void;
  selectedDomain: string;
  isChecking: boolean;
  accentColor: string;
}) {
  const { getPrimaryColor } = useTheme();

  const handleChange = useCallback(
    (text: string) => {
      // Only allow lowercase letters, numbers, and underscores
      const sanitized = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
      onChangeText(sanitized);
    },
    [onChangeText]
  );

  return (
    <View
      style={[
        styles.inputContainer,
        {
          backgroundColor: opacity(accentColor, 0.06),
          borderColor: value.length > 0 ? opacity(accentColor, 0.65) : opacity(accentColor, 0.25),
        },
      ]}>
      <TextInput
        value={value}
        onChangeText={handleChange}
        placeholder="username"
        placeholderTextColor={opacity(accentColor, 0.45)}
        style={[styles.input, { color: opacity(getPrimaryColor('0'), 0.9) }]}
        autoCorrect={false}
        autoCapitalize="none"
        autoFocus
      />
      <Text size={18} style={{ color: opacity(accentColor, 0.9) }}>
        @{selectedDomain}
      </Text>
      {isChecking && (
        <ActivityIndicator size="small" color={accentColor} style={{ marginLeft: 12 }} />
      )}
    </View>
  );
}

// Domain option button
function DomainOption({
  domain,
  isSelected,
  onSelect,
  availabilityResult,
}: {
  domain: (typeof DOMAINS)[number];
  isSelected: boolean;
  onSelect: () => void;
  availabilityResult?: AvailabilityResult;
}) {
  const { getPrimaryColor } = useTheme();

  const getStatusInfo = () => {
    if (!availabilityResult) return null;
    if (availabilityResult.loading)
      return { color: opacity(getPrimaryColor('0'), 0.33), text: 'Checking...' };
    if (availabilityResult.error)
      return { color: '#ef4444', text: availabilityResult.error, icon: 'mdi:close-circle' };
    if (availabilityResult.available === true)
      return { color: '#22c55e', text: 'Available', icon: 'mdi:check-circle' };
    if (availabilityResult.available === false)
      return { color: '#ef4444', text: 'Taken', icon: 'mdi:close-circle' };
    return null;
  };

  const status = getStatusInfo();

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onSelect}
      style={[
        styles.domainOption,
        {
          backgroundColor: isSelected
            ? opacity(getPrimaryColor('500'), 0.15)
            : getPrimaryColor('900'),
          borderColor: isSelected ? getPrimaryColor('500') : getPrimaryColor('800'),
        },
      ]}>
      <HStack align="center" style={{ flex: 1 }}>
        <View
          style={[
            styles.domainIcon,
            {
              backgroundColor: isSelected
                ? opacity(getPrimaryColor('400'), 0.2)
                : getPrimaryColor('800'),
            },
          ]}>
          <Icon
            name="mingcute:lightning-fill"
            size={16}
            color={
              isSelected ? opacity(getPrimaryColor('0'), 0.4) : opacity(getPrimaryColor('0'), 0.33)
            }
          />
        </View>
        <Text
          size={15}
          heavy={isSelected}
          style={{
            color: isSelected
              ? opacity(getPrimaryColor('0'), 0.9)
              : opacity(getPrimaryColor('0'), 0.5),
          }}>
          @{domain.label}
        </Text>
      </HStack>

      {/* Status indicator */}
      {status && (
        <HStack align="center" style={{ gap: 6 }}>
          {availabilityResult?.loading ? (
            <ActivityIndicator size="small" color={status.color} />
          ) : status.icon ? (
            <Icon name={status.icon} size={16} color={status.color} />
          ) : null}
          <Text size={12} style={{ color: status.color }}>
            {status.text}
          </Text>
        </HStack>
      )}

      {/* Selection indicator */}
      {!status && (
        <View
          style={[
            styles.radioOuter,
            { borderColor: isSelected ? getPrimaryColor('500') : getPrimaryColor('600') },
          ]}>
          {isSelected && (
            <View style={[styles.radioInner, { backgroundColor: getPrimaryColor('500') }]} />
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

/**
 * Generate NIP-98 HTTP Auth string for npub.cash API
 * @param url - The full URL being accessed
 * @param method - HTTP method (GET, POST, PUT, etc.)
 * @param privateKey - Nostr private key as Uint8Array
 * @returns Base64 encoded signed event with "Nostr " prefix
 */
function generateNip98Auth(url: string, method: string, privateKey: Uint8Array): string {
  // Create the NIP-98 event structure
  const authEvent = {
    content: '',
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', url],
      ['method', method],
    ],
  };

  // Sign the event with the private key
  const signedEvent = finalizeEvent(authEvent, privateKey);

  // Base64 encode the signed event and prefix with "Nostr "
  // btoa is available in React Native/Expo environments
  return `Nostr ${btoa(JSON.stringify(signedEvent))}`;
}

function ClaimUsernameScreen() {
  const { getPrimaryColor } = useTheme();
  const { keys: nostrKeys } = useNostrKeysContext();
  const hero = useHeroTransition();
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const heroRef = useRef<any>(null);
  const [username, setUsername] = useState('');
  const [selectedDomain, setSelectedDomain] = useState<DomainId>('npubx');
  const [availabilityResults, setAvailabilityResults] = useState<AvailabilityResult[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  // Close button for header
  const handleClose = useCallback(() => {
    hero.closeClaimUsername();
  }, [hero]);

  const CloseButton = useCallback(
    () => (
      <TouchableOpacity onPress={handleClose} style={{ padding: 8 }}>
        <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
      </TouchableOpacity>
    ),
    [getPrimaryColor, handleClose]
  );

  const handleHeroLayout = useCallback(() => {
    hero.registerRef('claimUsername', 'destination', heroRef.current);
  }, [hero]);

  // ---------------------------------------------------------------------------
  // Safe fade-in animation (always mounted, no mount/unmount race with Core Animation)
  // ---------------------------------------------------------------------------
  const isHeroTransitioning = hero.isTransitioning('claimUsername');

  const contentOpacity = useSharedValue(0);
  const contentTranslateY = useSharedValue(20);

  useEffect(() => {
    if (!isHeroTransitioning) {
      contentOpacity.value = withDelay(120, withTiming(1, { duration: 220 }));
      contentTranslateY.value = withDelay(120, withTiming(0, { duration: 220 }));
    } else {
      contentOpacity.value = 0;
      contentTranslateY.value = 20;
    }
  }, [isHeroTransitioning, contentOpacity, contentTranslateY]);

  const contentAnimStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));

  const topOffset = insets.top;
  const accentColor = '#f59e0b';

  // Check availability for all domains
  const checkAvailability = useCallback(async (name: string) => {
    if (name.length < 1) {
      setAvailabilityResults([]);
      return;
    }

    setIsChecking(true);

    // Initialize results with loading state
    const initialResults: AvailabilityResult[] = DOMAINS.map((d) => ({
      domain: d.value,
      available: null,
      loading: true,
    }));
    setAvailabilityResults(initialResults);

    // Check all domains in parallel
    const results = await Promise.all(
      DOMAINS.map(async (domain) => {
        try {
          const result = await checkUsernameAvailability(name, domain.value);
          return {
            domain: domain.value,
            available: result.available,
            loading: false,
            error: result.error,
          };
        } catch {
          return {
            domain: domain.value,
            available: null,
            loading: false,
            error: 'Failed to check',
          };
        }
      })
    );

    setAvailabilityResults(results);
    setIsChecking(false);
  }, []);

  // Trigger availability check when username changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (username.length >= 1) {
        checkAvailability(username);
      } else {
        setAvailabilityResults([]);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [username, checkAvailability]);

  // Get availability result for a domain
  const getAvailabilityForDomain = useCallback(
    (domainValue: string) => {
      return availabilityResults.find((r) => r.domain === domainValue);
    },
    [availabilityResults]
  );

  // Check if selected domain is available
  const selectedDomainAvailable = useMemo(() => {
    const selectedDomainValue = DOMAINS.find((d) => d.id === selectedDomain)?.value;
    const result = availabilityResults.find((r) => r.domain === selectedDomainValue);
    return result?.available === true;
  }, [availabilityResults, selectedDomain]);

  // Generate NIP-98 auth for npub.cash and navigate to local server with auth
  const handleContinue = useCallback(() => {
    Keyboard.dismiss();

    if (!nostrKeys?.privateKey) {
      console.error('No Nostr private key available');
      return;
    }

    // The URL we're authenticating for (npub.cash API endpoint)
    const npubCashApiUrl = 'https://npub.cash/api/v1/info/username';

    // Generate NIP-98 auth string for PUT request to npub.cash
    const nostrAuth = generateNip98Auth(npubCashApiUrl, 'PUT', nostrKeys.privateKey);

    // URL encode the auth string for use as query parameter
    const encodedAuth = encodeURIComponent(nostrAuth);

    // Navigate to local server with nostr auth as query parameter
    const localUrl = `http://localhost:8080/api/npubcash-server/username?nostr:authorization=${encodedAuth}`;

    Linking.openURL(localUrl);
  }, [nostrKeys?.privateKey]);

  const selectedDomainLabel = DOMAINS.find((d) => d.id === selectedDomain)?.value || '';

  // Bottom buttons component
  const bottomButtons = useMemo(
    () => (
      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: 'Continue',
              variant: 'secondary' as const,
              onPress: async () => {
                handleContinue();
              },
            },
          ]}
        />
      </BottomButtons>
    ),
    [handleContinue]
  );

  return (
    <>
      <Stack.Screen
        options={{
          presentation: 'card',
          animation: 'fade',
          headerShown: true,
          headerTitle: '',
          headerTintColor: getPrimaryColor('0'),
          headerLeft: CloseButton,
          headerTransparent: true,
          headerBlurEffect: 'none',
          headerBackground: () => null,
          headerShadowVisible: false,
        }}
      />
      <ModalLayoutWrapper
        contentPadding={0}
        bottomPadding={120}
        bottomContent={bottomButtons}
        useAnimatedScroll
        scrollY={scrollY}
        disableHeaderSpacer>
        <VStack style={{ paddingBottom: 24 }}>
          <RNView
            ref={heroRef}
            onLayout={handleHeroLayout}
            collapsable={false}
            shouldRasterizeIOS
            renderToHardwareTextureAndroid
            style={[
              styles.heroCard,
              {
                borderColor: opacity(accentColor, 0.3),
                opacity: hero.isHidden('claimUsername', 'destination') ? 0 : 1,
                marginTop: -topOffset,
                paddingTop: 52 + topOffset * 2,
              },
            ]}>
            <ClaimUsernameCardFrame
              accentColor={accentColor}
              backgroundColor={getPrimaryColor('950')}
              highlightColor={getPrimaryColor('50')}>
              <VStack style={{ paddingHorizontal: 20, paddingBottom: 20, zIndex: 1 }}>
                <HStack align="center" style={{ marginBottom: 14 }}>
                  <View
                    style={[styles.heroSmallIcon, { backgroundColor: opacity(accentColor, 0.15) }]}>
                    <Icon name="mingcute:lightning-fill" size={20} color={accentColor} />
                  </View>
                  <VStack style={{ flex: 1, marginLeft: 12 }}>
                    <Text size={18} heavy style={{ color: opacity(getPrimaryColor('0'), 0.9) }}>
                      Claim Your Address
                    </Text>
                    <Text size={12} style={{ color: opacity(accentColor, 0.7) }}>
                      Get a memorable Lightning URL
                    </Text>
                  </VStack>
                </HStack>

                <Text
                  size={14}
                  style={{ color: opacity(getPrimaryColor('0'), 0.5), marginBottom: 14 }}>
                  Choose a memorable username for receiving Bitcoin.
                </Text>

                <UsernameInput
                  value={username}
                  onChangeText={setUsername}
                  selectedDomain={selectedDomainLabel}
                  isChecking={isChecking}
                  accentColor={accentColor}
                />
              </VStack>
            </ClaimUsernameCardFrame>
          </RNView>

          <Animated.View style={contentAnimStyle}>
            <View style={{ paddingHorizontal: 16 }}>
              <VStack style={{ gap: 8, marginTop: 18 }}>
                <Text
                  size={12}
                  heavy
                  style={{
                    color: opacity(getPrimaryColor('0'), 0.33),
                    marginLeft: 4,
                    marginBottom: 4,
                  }}>
                  SELECT DOMAIN
                </Text>
                {DOMAINS.map((domain) => (
                  <DomainOption
                    key={domain.id}
                    domain={domain}
                    isSelected={selectedDomain === domain.id}
                    onSelect={() => setSelectedDomain(domain.id)}
                    availabilityResult={
                      username.length >= 1 ? getAvailabilityForDomain(domain.value) : undefined
                    }
                  />
                ))}
              </VStack>

              {username.length === 0 && (
                <View style={[styles.guidelinesBox, { backgroundColor: getPrimaryColor('900') }]}>
                  <Text
                    size={13}
                    heavy
                    style={{ color: opacity(getPrimaryColor('0'), 0.5), marginBottom: 12 }}>
                    Username Guidelines
                  </Text>
                  <VStack style={{ gap: 10 }}>
                    {[
                      { text: 'At least 3 characters', icon: 'mdi:check' },
                      { text: 'Lowercase letters, numbers, underscores', icon: 'mdi:check' },
                      { text: 'No spaces or special characters', icon: 'mdi:check' },
                    ].map((item, index) => (
                      <HStack key={index} align="center">
                        <Icon
                          name={item.icon}
                          size={16}
                          color={opacity(getPrimaryColor('0'), 0.33)}
                        />
                        <Text
                          size={13}
                          style={{ color: opacity(getPrimaryColor('0'), 0.4), marginLeft: 10 }}>
                          {item.text}
                        </Text>
                      </HStack>
                    ))}
                  </VStack>
                </View>
              )}

              {/* Preview - show when valid username */}
              {username.length >= 3 && selectedDomainAvailable && (
                <View
                  style={[
                    styles.previewBox,
                    {
                      backgroundColor: opacity(getPrimaryColor('500'), 0.08),
                      borderColor: opacity(getPrimaryColor('500'), 0.2),
                    },
                  ]}>
                  <Text
                    size={11}
                    heavy
                    style={{
                      color: opacity(getPrimaryColor('0'), 0.33),
                      marginBottom: 8,
                      letterSpacing: 1,
                    }}>
                    YOUR NEW ADDRESS
                  </Text>
                  <Text
                    size={18}
                    heavy
                    style={{ color: opacity(getPrimaryColor('0'), 0.9), fontFamily: 'monospace' }}>
                    {username}@{selectedDomainLabel}
                  </Text>
                </View>
              )}
            </View>
          </Animated.View>
        </VStack>
      </ModalLayoutWrapper>
    </>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    width: '100%',
    alignSelf: 'stretch',
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  heroSmallIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 14,
    width: '100%',
  },
  input: {
    flex: 1,
    fontSize: 18,
    fontFamily: 'monospace',
    padding: 0,
  },
  domainOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  domainIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  guidelinesBox: {
    borderRadius: 14,
    padding: 16,
    marginTop: 24,
  },
  previewBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginTop: 24,
    alignItems: 'center',
  },
});

export default withSheetProvider(ClaimUsernameScreen);

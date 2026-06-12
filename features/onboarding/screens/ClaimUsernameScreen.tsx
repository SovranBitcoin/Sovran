/**
 * @fileoverview Claim Username Modal
 *
 * Clean modal for claiming a custom Lightning address username.
 * Features:
 * - Hero input field for entering username
 * - Domain selector dropdown (npub.cash, sovran.money)
 * - Real-time availability checking across all domains
 * - Bottom button to continue with claim process
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TextInput, Alert, Keyboard, StyleSheet, View as RNView } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Stack } from 'expo-router';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { Screen } from '@/shared/ui/composed/Screen';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { SquircleView } from '@/shared/ui/primitives/SquircleView';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { log, redactError, useLifecycleLogger } from '@/shared/lib/logger';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { finalizeEvent, type EventTemplate, type VerifiedEvent } from 'nostr-tools';
import { useHeroTransition } from '@/shared/providers/hero-transition/HeroTransitionProvider';
import { ClaimUsernameCardFrame } from '@/shared/blocks/claim/ClaimUsernameCardFrame';
import { LoadingIndicator } from '@/shared/blocks/status';
import { alpha, duration, zIndex } from '@/shared/styles/tokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import { z } from 'zod';
import { NPC_BASE_URL, NPC_DOMAIN } from '@/shared/lib/cashu/npc';
import { fetchStatus } from '@/shared/lib/apiClient';
import { NPCClient, JWTAuthProvider, PaymentRequiredError } from 'npubcash-sdk';

// Available domains for Lightning addresses
const DOMAINS = [
  { id: 'npub', label: NPC_DOMAIN, value: NPC_DOMAIN },
  { id: 'sovran', label: 'sovran.money', value: 'sovran.money' },
] as const;

type DomainId = (typeof DOMAINS)[number]['id'];

interface AvailabilityResult {
  domain: string;
  available: boolean | null;
  loading: boolean;
  error?: string;
}

// Username schema mirrors the input sanitiser (lowercase a-z, digits, underscore)
// and caps the local-part well under NIP-05 / Lightning-Address conventions so
// pathological input is rejected before reaching the (eventual) backend.
const usernameSchema = z
  .string()
  .min(3, 'Too short')
  .max(32, 'Too long')
  .regex(/^[a-z0-9_]+$/, 'Invalid characters');

// Hash the username to an 8-char prefix so log entries don't carry plaintext
// candidate identifiers — consistent within a session for correlating retries,
// but opaque to log consumers.
function hashUsername(username: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < username.length; i++) {
    h = Math.imul(h ^ username.charCodeAt(i), 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Public availability lookup against the NPC server. 200 with a body means the
// username is taken; 404 means free. We treat any unrecognised shape as
// "unknown" (returning available=true so the user can still try) — matches
// eNuts, which has no pre-check at all and surfaces conflicts at submit time.
async function checkUsernameAvailability(
  username: string,
  domain: string,
  signal?: AbortSignal
): Promise<{ available: boolean; error?: string }> {
  const parsed = usernameSchema.safeParse(username);
  if (!parsed.success) {
    return { available: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  // Only the NPC domain has a backend. Other domains (e.g. sovran.money)
  // aren't wired yet — report available so the UI doesn't lie.
  if (domain !== NPC_DOMAIN) {
    return { available: true };
  }

  const url = `${NPC_BASE_URL}/api/v1/info/username/${encodeURIComponent(username)}`;
  const res = await fetchStatus(url, { method: 'GET' }, { signal });
  if (res.isErr()) return { available: true };
  const { ok, status } = res.value;
  if (status === 404) return { available: true };
  if (ok) return { available: false };
  return { available: true };
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
  const foreground = useThemeColor('foreground');

  const handleChange = useCallback(
    (text: string) => {
      // Only allow lowercase letters, numbers, and underscores
      const sanitized = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
      onChangeText(sanitized);
    },
    [onChangeText]
  );

  return (
    <SquircleView
      style={[
        styles.inputContainer,
        {
          backgroundColor: opacity(accentColor, alpha.faint),
          borderColor:
            value.length > 0 ? opacity(accentColor, alpha.strong) : opacity(accentColor, 0.25),
        },
      ]}>
      <TextInput
        value={value}
        onChangeText={handleChange}
        placeholder="username"
        placeholderTextColor={opacity(accentColor, alpha.muted)}
        style={[styles.input, { color: opacity(foreground, alpha.prominent) }]}
        autoCorrect={false}
        autoCapitalize="none"
        autoFocus
      />
      <Text size={18} style={{ color: opacity(accentColor, alpha.prominent) }}>
        @{selectedDomain}
      </Text>
      {isChecking && (
        <View style={{ marginLeft: 12 }}>
          <LoadingIndicator size={20} phase="loading" color={accentColor} />
        </View>
      )}
    </SquircleView>
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
  const [foreground, muted, accent, defaultColor, surfaceSecondary, surface] = useThemeColor([
    'foreground',
    'muted',
    'accent',
    'default',
    'surface-secondary',
    'surface',
  ] as const);
  const [danger, success] = useThemeColor(['danger', 'success'] as const);

  type StatusInfo = {
    color: string;
    text: string;
    indicator: { phase: 'loading' | 'done'; result?: 'success' | 'error' } | null;
  };
  const getStatusInfo = (): StatusInfo | null => {
    if (!availabilityResult) return null;
    if (availabilityResult.loading)
      return {
        color: opacity(foreground, alpha.soft),
        text: 'Checking...',
        indicator: { phase: 'loading' },
      };
    if (availabilityResult.error)
      return {
        color: danger,
        text: availabilityResult.error,
        indicator: { phase: 'done', result: 'error' },
      };
    if (availabilityResult.available === true)
      return {
        color: success,
        text: 'Available',
        indicator: { phase: 'done', result: 'success' },
      };
    if (availabilityResult.available === false)
      return {
        color: danger,
        text: 'Taken',
        indicator: { phase: 'done', result: 'error' },
      };
    return null;
  };

  const status = getStatusInfo();

  return (
    <Pressable
      activeOpacity={0.7}
      onPress={onSelect}
      style={[
        styles.domainOption,
        {
          backgroundColor: isSelected ? opacity(accent, 0.15) : surface,
          borderColor: isSelected ? accent : surfaceSecondary,
        },
      ]}>
      <HStack align="center" style={{ flex: 1 }}>
        <View
          style={[
            styles.domainIcon,
            {
              backgroundColor: isSelected ? opacity(muted, 0.2) : surfaceSecondary,
            },
          ]}>
          <Icon
            name="mingcute:lightning-fill"
            size={16}
            color={isSelected ? opacity(foreground, 0.4) : opacity(foreground, alpha.soft)}
          />
        </View>
        <Text
          size={15}
          heavy={isSelected}
          style={{
            color: isSelected ? opacity(foreground, alpha.prominent) : opacity(foreground, 0.5),
          }}>
          @{domain.label}
        </Text>
      </HStack>

      {/* Status indicator */}
      {status && (
        <HStack align="center" style={{ gap: 6 }}>
          {status.indicator && (
            <LoadingIndicator
              size={16}
              phase={status.indicator.phase}
              result={status.indicator.result ?? 'success'}
              color={status.color}
              successColor={success}
              errorColor={danger}
            />
          )}
          <Text size={12} style={{ color: status.color }}>
            {status.text}
          </Text>
        </HStack>
      )}

      {/* Selection indicator */}
      {!status && (
        <View style={[styles.radioOuter, { borderColor: isSelected ? accent : defaultColor }]}>
          {isSelected && <View style={[styles.radioInner, { backgroundColor: accent }]} />}
        </View>
      )}
    </Pressable>
  );
}

// Build an NPCClient bound to the active Nostr identity. Mirrors the
// JWTAuthProvider pattern eNuts uses in src/services/NpcService.ts.
function createNpcClient(privateKey: Uint8Array): NPCClient {
  const signer = async (template: EventTemplate): Promise<VerifiedEvent> =>
    finalizeEvent(template, privateKey);
  return new NPCClient(NPC_BASE_URL, new JWTAuthProvider(NPC_BASE_URL, signer));
}

export function ClaimUsernameScreen() {
  useLifecycleLogger('ClaimUsernameScreen');
  const [foreground, surfaceForeground, accent, surface, background] = useThemeColor([
    'foreground',
    'surface-foreground',
    'accent',
    'surface',
    'background',
  ] as const);
  const { keys: nostrKeys } = useNostrKeysContext();
  const hero = useHeroTransition();
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const heroRef = useRef<RNView>(null);
  const [username, setUsername] = useState('');
  const [selectedDomain, setSelectedDomain] = useState<DomainId>('npub');
  const [availabilityResults, setAvailabilityResults] = useState<AvailabilityResult[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  // Close button for header
  const handleClose = useCallback(() => {
    hero.closeClaimUsername();
  }, [hero]);

  const CloseButton = useCallback(
    () => (
      <Pressable onPress={handleClose} style={{ padding: 8 }}>
        <Icon name="material-symbols:close-rounded" size={24} color={foreground} />
      </Pressable>
    ),
    [foreground, handleClose]
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
      contentOpacity.value = withDelay(120, withTiming(1, { duration: duration.quick }));
      contentTranslateY.value = withDelay(120, withTiming(0, { duration: duration.quick }));
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
  const accentColor = accent;

  // Check availability for all domains; abortable so a stale in-flight check
  // cannot overwrite the latest user input.
  const checkAvailability = useCallback(async (name: string, signal: AbortSignal) => {
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
    const usernameHash = hashUsername(name);
    log.info('onboarding.claim.check_availability', { usernameHash });
    const results = await Promise.all(
      DOMAINS.map(async (domain) => {
        try {
          const result = await checkUsernameAvailability(name, domain.value, signal);
          return {
            domain: domain.value,
            available: result.available,
            loading: false,
            error: result.error,
          };
        } catch (e) {
          if ((e as { name?: string })?.name === 'AbortError') {
            return {
              domain: domain.value,
              available: null,
              loading: false,
            };
          }
          log.warn('onboarding.claim.availability_failed', {
            domain: domain.value,
            error: redactError(e),
          });
          return {
            domain: domain.value,
            available: null,
            loading: false,
            error: 'Failed to check',
          };
        }
      })
    );

    if (signal.aborted) return;

    log.info('onboarding.claim.availability_results', {
      usernameHash,
      available: results.filter((r) => r.available).map((r) => r.domain),
    });
    setAvailabilityResults(results);
    setIsChecking(false);
  }, []);

  // Trigger availability check when username changes; abort the previous
  // in-flight check on every change so the latest input wins regardless of
  // network jitter (mocked or real).
  useEffect(() => {
    if (username.length < 1) {
      setAvailabilityResults([]);
      setIsChecking(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void checkAvailability(username, controller.signal);
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
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

  // Claim the username via npubcash-sdk. Mirrors eNuts's NpcService.requestNpcUsername:
  // attempt setUsername; on PaymentRequiredError, surface the paid-claim path
  // (not yet wired in the Sovran UI). Other errors bubble as a generic alert.
  const handleContinue = useCallback(async () => {
    Keyboard.dismiss();
    log.info('onboarding.claim.continue', {
      usernameHash: hashUsername(username),
      domain: selectedDomain,
    });

    const selectedDomainValue = DOMAINS.find((d) => d.id === selectedDomain)?.value;
    if (selectedDomainValue !== NPC_DOMAIN) {
      Alert.alert('Not yet supported', `Claiming on ${selectedDomainValue} isn't wired up yet.`);
      return;
    }

    if (!nostrKeys?.privateKey) {
      log.error('onboarding.claim.no_private_key');
      Alert.alert('Cannot claim', 'No Nostr identity available.');
      return;
    }

    setIsClaiming(true);
    try {
      const client = createNpcClient(nostrKeys.privateKey);
      await client.setUsername(username);
      log.info('onboarding.claim.success', { usernameHash: hashUsername(username) });
      Alert.alert('Claimed', `${username}@${NPC_DOMAIN} is yours.`, [
        { text: 'OK', onPress: () => hero.closeClaimUsername() },
      ]);
    } catch (error) {
      if (error instanceof PaymentRequiredError) {
        log.info('onboarding.claim.payment_required', {
          usernameHash: hashUsername(username),
        });
        Alert.alert(
          'Payment required',
          'This username requires a Cashu payment. Paid claims aren’t supported in this screen yet — pick another username or try later.'
        );
        return;
      }
      log.error('onboarding.claim.failed', { error: redactError(error) });
      Alert.alert('Could not claim', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsClaiming(false);
    }
  }, [nostrKeys?.privateKey, username, selectedDomain, hero]);

  const selectedDomainLabel = DOMAINS.find((d) => d.id === selectedDomain)!.value;

  // Bottom buttons component
  const bottomButtons = useMemo(
    () => (
      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: isClaiming ? 'Claiming…' : 'Continue',
              variant: 'secondary' as const,
              disabled: isClaiming || !selectedDomainAvailable,
              onPress: async () => {
                await handleContinue();
              },
            },
          ]}
        />
      </BottomButtons>
    ),
    [handleContinue, isClaiming, selectedDomainAvailable]
  );

  return (
    <>
      <Stack.Screen
        options={{
          presentation: 'card',
          animation: 'fade',
          headerShown: true,
          headerTitle: '',
          headerTintColor: foreground,
          headerLeft: CloseButton,
          headerTransparent: true,
          headerBlurEffect: 'none',
          headerBackground: () => null,
          headerShadowVisible: false,
        }}
      />
      <Screen
        name="ClaimUsernameScreen"
        contentPadding={0}
        footer={bottomButtons}
        scroll="animated"
        scrollY={scrollY}
        disableHeaderSpacer>
        <VStack style={{ paddingBottom: 24 }}>
          <SquircleView
            ref={heroRef}
            onLayout={handleHeroLayout}
            collapsable={false}
            shouldRasterizeIOS={isHeroTransitioning}
            renderToHardwareTextureAndroid={isHeroTransitioning}
            style={[
              styles.heroCard,
              {
                borderColor: opacity(accentColor, alpha.soft),
                opacity: hero.isHidden('claimUsername', 'destination') ? 0 : 1,
                marginTop: -topOffset,
                paddingTop: 52 + topOffset * 2,
              },
            ]}>
            <ClaimUsernameCardFrame
              accentColor={accentColor}
              backgroundColor={background}
              highlightColor={surfaceForeground}>
              <VStack style={{ paddingHorizontal: 20, paddingBottom: 20, zIndex: zIndex.raised }}>
                <HStack align="center" style={{ marginBottom: 14 }}>
                  <View
                    style={[styles.heroSmallIcon, { backgroundColor: opacity(accentColor, 0.15) }]}>
                    <Icon name="mingcute:lightning-fill" size={20} color={accentColor} />
                  </View>
                  <VStack style={{ flex: 1, marginLeft: 12 }}>
                    <Text size={18} heavy style={{ color: opacity(foreground, alpha.prominent) }}>
                      Claim Your Address
                    </Text>
                    <Text size={12} style={{ color: opacity(accentColor, alpha.strong) }}>
                      Get a memorable Lightning URL
                    </Text>
                  </VStack>
                </HStack>

                <Text size={14} style={{ color: opacity(foreground, 0.5), marginBottom: 14 }}>
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
          </SquircleView>

          <Animated.View style={contentAnimStyle}>
            <View style={{ paddingHorizontal: 16 }}>
              <VStack style={{ gap: 8, marginTop: 18 }}>
                <Text
                  size={12}
                  heavy
                  style={{
                    color: opacity(foreground, alpha.soft),
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
                <View style={[styles.guidelinesBox, { backgroundColor: surface }]}>
                  <Text
                    size={13}
                    heavy
                    style={{ color: opacity(foreground, 0.5), marginBottom: 12 }}>
                    Username Guidelines
                  </Text>
                  <VStack style={{ gap: 10 }}>
                    {[
                      { text: 'At least 3 characters', icon: 'mdi:check' },
                      { text: 'Lowercase letters, numbers, underscores', icon: 'mdi:check' },
                      { text: 'No spaces or special characters', icon: 'mdi:check' },
                    ].map((item, index) => (
                      <HStack key={index} align="center">
                        <Icon name={item.icon} size={16} color={opacity(foreground, alpha.soft)} />
                        <Text size={13} style={{ color: opacity(foreground, 0.4), marginLeft: 10 }}>
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
                      backgroundColor: opacity(accent, 0.08),
                      borderColor: opacity(accent, 0.2),
                    },
                  ]}>
                  <Text
                    size={11}
                    heavy
                    style={{
                      color: opacity(foreground, alpha.soft),
                      marginBottom: 8,
                      letterSpacing: 1,
                    }}>
                    YOUR NEW ADDRESS
                  </Text>
                  <Text
                    size={18}
                    heavy
                    style={{
                      color: opacity(foreground, alpha.prominent),
                      fontFamily: 'monospace',
                    }}>
                    {username}@{selectedDomainLabel}
                  </Text>
                </View>
              )}
            </View>
          </Animated.View>
        </VStack>
      </Screen>
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

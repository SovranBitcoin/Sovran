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

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Keyboard,
  StyleSheet,
  Alert,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { View, VStack, HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { ModalLayoutWrapper } from 'app/debugModal';
import { useTheme } from 'providers/ThemeProvider';
import { withSheetProvider } from 'hocs/withSheetProvider';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';

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
}: {
  value: string;
  onChangeText: (text: string) => void;
  selectedDomain: string;
  isChecking: boolean;
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
          backgroundColor: getPrimaryColor('900'),
          borderColor: value.length > 0 ? getPrimaryColor('500') : getPrimaryColor('700'),
        },
      ]}>
      <TextInput
        value={value}
        onChangeText={handleChange}
        placeholder="username"
        placeholderTextColor={getPrimaryColor('600')}
        style={[styles.input, { color: getPrimaryColor('50') }]}
        autoCorrect={false}
        autoCapitalize="none"
        autoFocus
      />
      <Text size={18} style={{ color: getPrimaryColor('500') }}>
        @{selectedDomain}
      </Text>
      {isChecking && (
        <ActivityIndicator size="small" color={getPrimaryColor('400')} style={{ marginLeft: 12 }} />
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
    if (availabilityResult.loading) return { color: getPrimaryColor('500'), text: 'Checking...' };
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
            color={isSelected ? getPrimaryColor('400') : getPrimaryColor('500')}
          />
        </View>
        <Text
          size={15}
          heavy={isSelected}
          style={{ color: isSelected ? getPrimaryColor('50') : getPrimaryColor('300') }}>
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

function ClaimUsernameScreen() {
  const { getPrimaryColor } = useTheme();
  const [username, setUsername] = useState('');
  const [selectedDomain, setSelectedDomain] = useState<DomainId>('npubx');
  const [availabilityResults, setAvailabilityResults] = useState<AvailabilityResult[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  // Close button for header
  const CloseButton = useCallback(
    () => (
      <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
        <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
      </TouchableOpacity>
    ),
    [getPrimaryColor]
  );

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

  // Can continue if username is valid and selected domain is available
  const canContinue = username.length >= 3 && selectedDomainAvailable && !isChecking;

  const handleContinue = useCallback(() => {
    Keyboard.dismiss();
    Alert.alert('Not Implemented', 'This feature is not implemented yet.');
  }, []);

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
          headerTitle: 'Claim Username',
          headerTitleStyle: { color: getPrimaryColor('0') },
          headerTintColor: getPrimaryColor('0'),
          headerLeft: CloseButton,
        }}
      />
      <ModalLayoutWrapper bottomPadding={120} bottomContent={bottomButtons}>
        {/* Hero section with input */}
        <VStack style={{ alignItems: 'center', marginBottom: 32 }}>
          <View
            style={[styles.heroIcon, { backgroundColor: opacity(getPrimaryColor('500'), 0.12) }]}>
            <Icon name="mingcute:lightning-fill" size={32} color={getPrimaryColor('400')} />
          </View>

          <Text
            size={14}
            style={{ color: getPrimaryColor('400'), textAlign: 'center', marginBottom: 24 }}>
            Choose a memorable username for receiving Bitcoin
          </Text>

          <UsernameInput
            value={username}
            onChangeText={setUsername}
            selectedDomain={selectedDomainLabel}
            isChecking={isChecking}
          />
        </VStack>

        {/* Domain selection */}
        <VStack style={{ gap: 8 }}>
          <Text
            size={12}
            heavy
            style={{ color: getPrimaryColor('500'), marginLeft: 4, marginBottom: 4 }}>
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

        {/* Guidelines - show when empty */}
        {username.length === 0 && (
          <View style={[styles.guidelinesBox, { backgroundColor: getPrimaryColor('900') }]}>
            <Text size={13} heavy style={{ color: getPrimaryColor('300'), marginBottom: 12 }}>
              Username Guidelines
            </Text>
            <VStack style={{ gap: 10 }}>
              {[
                { text: 'At least 3 characters', icon: 'mdi:check' },
                { text: 'Lowercase letters, numbers, underscores', icon: 'mdi:check' },
                { text: 'No spaces or special characters', icon: 'mdi:check' },
              ].map((item, index) => (
                <HStack key={index} align="center">
                  <Icon name={item.icon} size={16} color={getPrimaryColor('500')} />
                  <Text size={13} style={{ color: getPrimaryColor('400'), marginLeft: 10 }}>
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
              style={{ color: getPrimaryColor('500'), marginBottom: 8, letterSpacing: 1 }}>
              YOUR NEW ADDRESS
            </Text>
            <Text size={18} heavy style={{ color: getPrimaryColor('50'), fontFamily: 'monospace' }}>
              {username}@{selectedDomainLabel}
            </Text>
          </View>
        )}
      </ModalLayoutWrapper>
    </>
  );
}

const styles = StyleSheet.create({
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
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

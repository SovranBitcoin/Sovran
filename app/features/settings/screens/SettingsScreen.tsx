import React, { useRef, useCallback } from 'react';
import { ScrollView, Alert } from 'react-native';
import { openExternalUrl } from '@/shared/lib/url';
import { Text } from '@/shared/ui/primitives/Text';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

import { type Href } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { truncateMiddle } from '@/shared/lib/strings';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { useDeferredMount } from '@/shared/hooks/useDeferredMount';
import { Section } from '@/shared/ui/composed/Section';
import * as Application from 'expo-application';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useProfileDisplay } from '@/shared/hooks/useProfileDisplay';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { paramPopup } from '@/shared/lib/popup';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { ListGroup, PressableFeedback, Separator, Switch as HeroSwitch } from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { useNotificationPolicyStore } from '@/features/feed/stores/notificationPolicyStore';
import { notificationPolicyLabel } from '@/features/feed/lib/notificationCopy';
import { useNip46RequestsStore } from '@/features/nostrSigner';

const name = Application.applicationName;
const version = Application.nativeApplicationVersion;
const buildNumber = Application.nativeBuildVersion;

const ProfileButton = () => {
  const { keys: nostrKeys } = useNostrKeysContext();
  const { displayName, picture } = useProfileDisplay(nostrKeys?.pubkey || '');

  return (
    <ListGroup variant="secondary">
      <PressableFeedback
        animation={false}
        testID="settings-profile-row"
        accessible
        accessibilityLabel="Profile and keys"
        onPress={() => router.navigate('/(settings-flow)/profile')}>
        <PressableFeedback.Scale>
          <ListGroup.Item disabled>
            <ListGroup.ItemPrefix>
              <Avatar
                state={picture ? 'image' : 'fallback'}
                seed={nostrKeys?.pubkey || ''}
                picture={picture}
                name={displayName}
                size={40}
              />
            </ListGroup.ItemPrefix>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>{displayName}</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>
                {truncateMiddle(nostrKeys?.npub || '', 14)}
              </ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix />
          </ListGroup.Item>
        </PressableFeedback.Scale>
        <PressableFeedback.Ripple />
      </PressableFeedback>
    </ListGroup>
  );
};

// e2e simulator taps arrive ~2s apart (one HID session per tap), which can
// never satisfy a human triple-tap window — the owned e2e Metro widens it.
const TRIPLE_TAP_WINDOW_MS = Number(process.env.EXPO_PUBLIC_E2E_TRIPLE_TAP_WINDOW_MS ?? '') || 1500;

const SIGNER_ROW_DESCRIPTION = 'Sign in to Nostr apps with this device';

/** Live row description: pending-count variant when the signer queue is non-empty. */
function signerRowDescription(pendingCount: number): string {
  if (pendingCount <= 0) return SIGNER_ROW_DESCRIPTION;
  return pendingCount === 1 ? '1 pending request' : `${pendingCount} pending requests`;
}

const SettingsListActionItem: React.FC<{
  title: string;
  description?: string;
  onPress: () => void;
  isDanger?: boolean;
  testID?: string;
}> = ({ title, description, onPress, isDanger, testID }) => {
  const danger = useThemeColor('danger');
  return (
    <PressableFeedback
      animation={false}
      testID={testID}
      // `accessible` is explicit rather than gated on `testID`: RN's Pressable
      // already defaults it to true, so the gate never did anything — stating
      // it keeps the "one actionable outer row" invariant visible.
      accessible
      // Role is unconditional: it is what a screen reader needs, and gating it
      // on `testID` made accessibility a side effect of e2e instrumentation
      // (18 of 22 rows carry no testID). The explicit label stays gated — where
      // it is absent RN synthesizes the same "title, description" string.
      accessibilityRole="button"
      accessibilityLabel={testID ? `${title}${description ? `, ${description}` : ''}` : undefined}
      onPress={onPress}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>
              {isDanger ? <Text style={{ color: danger }}>{title}</Text> : title}
            </ListGroup.ItemTitle>
            {description ? (
              <ListGroup.ItemDescription>{description}</ListGroup.ItemDescription>
            ) : null}
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix />
        </ListGroup.Item>
      </PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
};

const SettingsListLinkItem: React.FC<{
  href: Href;
  title: string;
  description?: string;
  isDanger?: boolean;
  testID?: string;
}> = ({ href, ...item }) => (
  <SettingsListActionItem {...item} onPress={() => router.navigate(href)} />
);

const SettingsToggleItem: React.FC<{
  title: string;
  description?: string;
  isSelected: boolean;
  onSelectedChange: (selected: boolean) => void;
  testID?: string;
}> = ({ title, description, isSelected, onSelectedChange, testID }) => (
  <PressableFeedback
    animation={false}
    onPress={() => onSelectedChange(!isSelected)}
    testID={testID}
    accessible
    // Role and checked-state are unconditional — without them a screen reader
    // cannot tell a toggle from static text, nor read whether it is on. They
    // were gated on `testID`, so 5 of the 8 toggles announced neither.
    // `accessibilityValue` is dropped: RN derives the iOS 1/0 value from the
    // switch role plus `checked`, and Android exposes the checked state.
    accessibilityRole="switch"
    accessibilityState={{ checked: isSelected }}
    accessibilityLabel={testID ? title : undefined}>
    <PressableFeedback.Scale>
      <ListGroup.Item disabled>
        <ListGroup.ItemContent>
          <ListGroup.ItemTitle>{title}</ListGroup.ItemTitle>
          {description ? (
            <ListGroup.ItemDescription>{description}</ListGroup.ItemDescription>
          ) : null}
        </ListGroup.ItemContent>
        <ListGroup.ItemSuffix>
          <HeroSwitch isSelected={isSelected} onSelectedChange={onSelectedChange} />
        </ListGroup.ItemSuffix>
      </ListGroup.Item>
    </PressableFeedback.Scale>
    <PressableFeedback.Ripple />
  </PressableFeedback>
);

/**
 * Phase-2 of the deferred mount. Screen's deferContent already delays the
 * whole tree one tick so the card can present instantly; this stages the
 * fill itself so the VISIBLE commit stays small — the sections above the
 * fold mount first, and everything below (Privacy onward, including the
 * 8-switch Developer section) mounts on the next interaction tick. Each
 * heroui row registers ~10 Reanimated objects at mount, so halving the
 * commit visibly tightens the blank-to-content beat on Android.
 */
const BelowFold = ({ children }: { children: React.ReactNode }) => {
  const ready = useDeferredMount();
  return ready ? <>{children}</> : null;
};

export const SettingsScreen = () => {
  useLifecycleLogger('SettingsScreen');
  const sendLocationEnabled = useSettingsStore((state) => state.sendLocationEnabled);
  const setSendLocationEnabled = useSettingsStore((state) => state.setSendLocationEnabled);
  const devMode = useSettingsStore((state) => state.experimental);
  const setDevMode = useSettingsStore((state) => state.setExperimental);
  const mockMode = useSettingsStore((state) => state.mockMode);
  const setMockMode = useSettingsStore((state) => state.setMockMode);
  const mockOffline = useSettingsStore((state) => state.mockOffline);
  const setMockOffline = useSettingsStore((state) => state.setMockOffline);
  const mockFailSend = useSettingsStore((state) => state.mockFailSend);
  const setMockFailSend = useSettingsStore((state) => state.setMockFailSend);
  const mockFailMelt = useSettingsStore((state) => state.mockFailMelt);
  const setMockFailMelt = useSettingsStore((state) => state.setMockFailMelt);
  const mockFailPaymentRequest = useSettingsStore((state) => state.mockFailPaymentRequest);
  const setMockFailPaymentRequest = useSettingsStore((state) => state.setMockFailPaymentRequest);
  const whitenoiseEnabled = useSettingsStore((state) => state.whitenoiseEnabled);
  const setWhitenoiseEnabled = useSettingsStore((state) => state.setWhitenoiseEnabled);
  const mockNoGlass = useSettingsStore((state) => state.mockNoGlass);
  const setMockNoGlass = useSettingsStore((state) => state.setMockNoGlass);
  const notificationPolicy = useNotificationPolicyStore((state) => state.policy);
  const signerPendingCount = useNip46RequestsStore((state) => state.pending.length);

  const tapCountRef = useRef(0);
  const lastTapRef = useRef(0);

  const handleVersionPress = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current > TRIPLE_TAP_WINDOW_MS) {
      tapCountRef.current = 0;
    }
    tapCountRef.current += 1;
    lastTapRef.current = now;

    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0;
      const newMode = !devMode;
      log.info('settings.dev_mode.toggle', { enabled: newMode });
      setDevMode(newMode);
      paramPopup('dev-mode', newMode);
    }
  }, [devMode, setDevMode]);

  const handleExportDatabase = async () => {
    log.info('settings.export_database.start');
    try {
      await CocoManager.exportDatabase();
      log.info('settings.export_database.success');
    } catch (error) {
      log.error('settings.export_database.error', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
      Alert.alert('Export Failed', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  return (
    <ScreenWrapper name="SettingsScreen" scroll="custom" safeArea>
      <ScrollView className="px-4">
        <Section title="Account">
          <ProfileButton />
        </Section>
        <Section title="Preferences">
          <ListGroup variant="secondary">
            <SettingsListLinkItem href="/(settings-flow)/routing" title="Swap routing" />
            <Separator className="mx-4" />
            <SettingsListLinkItem
              href="/(settings-flow)/notification-policy"
              title="Notifications"
              description={notificationPolicyLabel(notificationPolicy)}
            />
            <Separator className="mx-4" />
            <SettingsListLinkItem
              href="/(settings-flow)/network"
              title="Network"
              description="Aggregators, caching, and relays"
            />
          </ListGroup>
        </Section>
        <Section title="App Information">
          <ListGroup variant="secondary">
            <SettingsListActionItem
              title="View source on GitHub"
              onPress={() => {
                void openExternalUrl('https://github.com/SovranBitcoin/Sovran');
              }}
            />
            <Separator className="mx-4" />
            <SettingsListActionItem
              title="Contact the Developer"
              onPress={() => {
                void openExternalUrl('https://x.com/SovranBitcoin');
              }}
            />
          </ListGroup>
        </Section>
        <Section title="Security">
          <ListGroup variant="secondary">
            <SettingsListLinkItem
              href="/(signer-flow)"
              title="Remote Login"
              description={signerRowDescription(signerPendingCount)}
            />
            <Separator className="mx-4" />
            <SettingsListLinkItem href="/(settings-flow)/keyring" title="P2PK Keys" />
            <Separator className="mx-4" />
            <SettingsListLinkItem
              href="/(settings-flow)/recovery"
              title="Recover wallet"
              description="Restore ecash from all mints using your seed"
            />
          </ListGroup>
        </Section>

        <BelowFold>
          <Section title="Privacy">
            <ListGroup variant="secondary">
              <SettingsToggleItem
                title="Location Stamps"
                description="Attach your approximate location when making transactions. (metadata only stored on your device)"
                isSelected={sendLocationEnabled ?? false}
                onSelectedChange={setSendLocationEnabled}
              />
              <Separator className="mx-4" />
              <SettingsListLinkItem
                href="/(settings-flow)/moderation"
                testID="settings-moderation-row"
                title="Moderation"
                description="Blocked people and private-message word filter"
              />
              <Separator className="mx-4" />
              <SettingsListLinkItem
                href="/(settings-flow)/media"
                title="My media"
                description="Images you've posted and their deletion status"
              />
            </ListGroup>
          </Section>

          <Section title="Legal">
            <ListGroup variant="secondary">
              <SettingsListLinkItem
                href="/(settings-flow)/terms"
                title="Terms and Conditions"
                testID="settings-terms-row"
              />
              <Separator className="mx-4" />
              <SettingsListLinkItem
                href="/(settings-flow)/privacy"
                title="Privacy Policy"
                testID="settings-privacy-row"
              />
            </ListGroup>
          </Section>

          {devMode ? (
            <Section title="Developer">
              <ListGroup variant="secondary">
                <SettingsListActionItem title="Export database" onPress={handleExportDatabase} />
                <Separator className="mx-4" />
                <Separator className="mx-4" />
                <SettingsListLinkItem
                  href="/(settings-flow)/storage"
                  title="Storage inventory"
                  description="View persisted storage keys and coco database files"
                />
                <Separator className="mx-4" />
                <SettingsListLinkItem
                  href="/(settings-flow)/design-system"
                  title="Design system"
                  description="Preview shared UI components"
                  testID="settings-design-system-row"
                />
                <Separator className="mx-4" />
                <SettingsToggleItem
                  title="Mock Mode"
                  testID="settings-mock-mode-toggle"
                  isSelected={mockMode}
                  onSelectedChange={setMockMode}
                />
                <Separator className="mx-4" />
                <SettingsToggleItem
                  title="Mock Offline"
                  isSelected={mockOffline}
                  onSelectedChange={setMockOffline}
                  testID="settings-mock-offline-toggle"
                />
                <Separator className="mx-4" />
                <SettingsToggleItem
                  title="Mock Fail Send"
                  isSelected={mockFailSend}
                  onSelectedChange={setMockFailSend}
                  testID="settings-mock-fail-send-toggle"
                />
                <Separator className="mx-4" />
                <SettingsToggleItem
                  title="Mock Fail Melt"
                  isSelected={mockFailMelt}
                  onSelectedChange={setMockFailMelt}
                  testID="settings-mock-fail-melt-toggle"
                />
                <Separator className="mx-4" />
                <SettingsToggleItem
                  title="Mock Fail Payment Request"
                  isSelected={mockFailPaymentRequest}
                  onSelectedChange={setMockFailPaymentRequest}
                />
                <Separator className="mx-4" />
                <SettingsToggleItem
                  title="White Noise"
                  isSelected={whitenoiseEnabled}
                  onSelectedChange={setWhitenoiseEnabled}
                />
                <Separator className="mx-4" />
                <SettingsToggleItem
                  title="Mock no-glass"
                  isSelected={mockNoGlass}
                  onSelectedChange={setMockNoGlass}
                />
              </ListGroup>
            </Section>
          ) : null}

          <Section title="Danger Zone" isDanger>
            <ListGroup variant="secondary">
              <SettingsListLinkItem
                href="/(settings-flow)/delete"
                title="Delete account"
                isDanger
              />
            </ListGroup>
          </Section>

          <Pressable
            onPress={handleVersionPress}
            testID="settings-version-row"
            accessible
            accessibilityLabel="App version">
            <VStack gap={4}>
              <Text className="text-foreground/50 text-center" bold size={13}>
                {name}
              </Text>
              <Text className="text-foreground/50 text-center" size={13} medium>
                App Version {version} ({buildNumber})
              </Text>
            </VStack>
          </Pressable>
        </BelowFold>
      </ScrollView>
    </ScreenWrapper>
  );
};

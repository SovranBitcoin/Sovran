import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { useRef, useCallback } from 'react';
import { avatarStateFor } from '@/shared/lib/imageLoadState';
import { Alert } from 'react-native';
import { openExternalUrl } from '@/shared/lib/url';
import { Text } from '@/shared/ui/primitives/Text';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { truncateMiddle } from '@/shared/lib/strings';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { LayoutShiftProbe } from '@/shared/ui/composed/LayoutShiftProbe';
import { useShiftLogger, VISUAL_LOGGING_ENABLED } from '@/shared/lib/contentShiftLog';
import { Section } from '@/shared/ui/composed/Section';
import * as Application from 'expo-application';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useProfileDisplay } from '@/shared/hooks/useProfileDisplay';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { describeError } from '@/shared/lib/errors';
import { actionMenuPopup, paramPopup } from '@/shared/lib/popup';
import { useCtaStore } from '@/shared/stores/global/ctaStore';
import { CTA_DEFINITIONS } from '@/shared/lib/cta/definitions';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { ListGroup, PressableFeedback, Separator } from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log, SHOW_LOGS, useLifecycleLogger } from '@/shared/lib/logger';
import { hasFeature } from '@/shared/config/features';
import {
  SettingsListActionItem,
  SettingsListLinkItem,
  SettingsToggleItem,
} from '@/shared/ui/composed/SettingsRows';

const name = Application.applicationName;
const version = Application.nativeApplicationVersion;
const buildNumber = Application.nativeBuildVersion;

const ProfileButton = () => {
  const { keys: nostrKeys } = useNostrKeysContext();
  const { displayName, picture, pictureResolved } = useProfileDisplay(nostrKeys?.pubkey || '');
  const muted = useThemeColor('muted');

  return (
    <ListGroup variant="secondary">
      <PressableFeedback
        animation={false}
        testID="settings-profile-row"
        accessible
        accessibilityRole="button"
        accessibilityLabel="Profile and keys"
        onPress={() => router.navigate('/(settings-flow)/profile')}>
        <PressableFeedback.Scale>
          <ListGroup.Item disabled>
            <ListGroup.ItemPrefix>
              <Avatar
                state={avatarStateFor(picture, pictureResolved)}
                seed={nostrKeys?.pubkey || ''}
                picture={picture}
                name={displayName}
                size={40}
              />
            </ListGroup.ItemPrefix>
            <ListGroup.ItemContent>
              <Text
                size={16}
                medium
                className="leading-6"
                numberOfLines={1}
                loading={!displayName}
                placeholder="Profile name"
                accessible={false}>
                {displayName || undefined}
              </Text>
              <Text
                className="leading-5"
                color={muted}
                numberOfLines={1}
                loading={!nostrKeys?.npub}
                placeholder="npub1…publickey"
                accessible={false}>
                {nostrKeys?.npub ? truncateMiddle(nostrKeys.npub, 'detail') : undefined}
              </Text>
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

export const SettingsScreen = () => {
  useLifecycleLogger('SettingsScreen');
  const shift = useShiftLogger('SettingsScreen');
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
  const layoutGuides = useSettingsStore((state) => state.layoutGuides);
  const setLayoutGuides = useSettingsStore((state) => state.setLayoutGuides);
  const showTouches = useSettingsStore((state) => state.showTouches);
  const setShowTouches = useSettingsStore((state) => state.setShowTouches);
  const inProcessProfileSwitch = useSettingsStore((state) => state.inProcessProfileSwitch);
  const setInProcessProfileSwitch = useSettingsStore((state) => state.setInProcessProfileSwitch);
  const mockNoGlass = useSettingsStore((state) => state.mockNoGlass);
  const setMockNoGlass = useSettingsStore((state) => state.setMockNoGlass);
  const verboseLoggingEnabled = useSettingsStore((state) => state.verboseLoggingEnabled);
  const setVerboseLoggingEnabled = useSettingsStore((state) => state.setVerboseLoggingEnabled);

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
      Alert.alert('Export Failed', describeError(error, 'cashu').text);
    }
  };

  return (
    <ScreenWrapper name="SettingsScreen" scroll="custom" safeArea="scroll">
      <ScreenScrollView
        className="px-4"
        onContentSizeChange={
          VISUAL_LOGGING_ENABLED
            ? (width, height) => {
                shift.report('settings.shift.content.width', 'content.width', width);
                shift.report('settings.shift.content.height', 'content.height', height);
              }
            : undefined
        }>
        <LayoutShiftProbe tag="settings.account">
          <Section title="Account">
            <ProfileButton />
          </Section>
        </LayoutShiftProbe>
        {/* Network is the only preference now, and only in builds with Nostr. */}
        {hasFeature('nostr') ? (
          <LayoutShiftProbe tag="settings.preferences">
            <Section title="Preferences">
              <ListGroup variant="secondary">
                <SettingsListLinkItem
                  href="/(settings-flow)/network"
                  title="Network"
                  testID="settings-network-row"
                  description="Aggregators, caching, and relays"
                />
              </ListGroup>
            </Section>
          </LayoutShiftProbe>
        ) : null}
        <LayoutShiftProbe tag="settings.app-information">
          <Section title="App Information">
            <ListGroup variant="secondary">
              <SettingsListActionItem
                title="View source on GitHub"
                testID="settings-source-row"
                onPress={() => {
                  void openExternalUrl('https://github.com/SovranBitcoin/Sovran');
                }}
              />
              <Separator className="mx-4" />
              <SettingsListActionItem
                title="Contact the Developer"
                testID="settings-contact-row"
                onPress={() => {
                  void openExternalUrl('https://x.com/SovranBitcoin');
                }}
              />
            </ListGroup>
          </Section>
        </LayoutShiftProbe>
        <LayoutShiftProbe tag="settings.security">
          <Section title="Security">
            <ListGroup variant="secondary">
              <SettingsListLinkItem
                href="/(settings-flow)/keyring"
                title="P2PK Keys"
                testID="settings-keyring-row"
              />
              <Separator className="mx-4" />
              <SettingsListLinkItem
                href="/(settings-flow)/recovery"
                title="Recover wallet"
                testID="settings-recovery-row"
                description="Restore ecash from all mints using your seed"
              />
            </ListGroup>
          </Section>
        </LayoutShiftProbe>

        <LayoutShiftProbe tag="settings.privacy">
          <Section title="Privacy">
            <ListGroup variant="secondary">
              <SettingsToggleItem
                title="Location Stamps"
                testID="settings-location-stamps-toggle"
                description="Attach your approximate location when making transactions. (metadata only stored on your device)"
                isSelected={sendLocationEnabled ?? false}
                onSelectedChange={setSendLocationEnabled}
              />
            </ListGroup>
          </Section>
        </LayoutShiftProbe>

        <LayoutShiftProbe tag="settings.legal">
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
        </LayoutShiftProbe>

        {devMode ? (
          <LayoutShiftProbe tag="settings.developer">
            <Section title="Developer">
              <ListGroup variant="secondary">
                <SettingsListActionItem
                  title="Preview call-to-action"
                  testID="settings-dev-cta"
                  onPress={() =>
                    actionMenuPopup({
                      title: 'Preview call-to-action',
                      buttons: CTA_DEFINITIONS.map((cta) => ({
                        text: cta.content.title,
                        testID: `settings-dev-cta-${cta.id}`,
                        onPress: () => useCtaStore.getState().preview(cta.id),
                      })),
                    })
                  }
                />
                <Separator className="mx-4" />
                <SettingsListActionItem
                  title="Export database"
                  testID="settings-export-database-row"
                  onPress={handleExportDatabase}
                />
                <Separator className="mx-4" />
                {/* Every setting here is live, but tunes what most people never change. */}
                <SettingsListLinkItem
                  href="/(settings-flow)/routing"
                  title="Swap routing"
                  testID="settings-routing-row"
                />
                <Separator className="mx-4" />
                <SettingsListLinkItem
                  href="/(settings-flow)/storage"
                  title="Storage inventory"
                  testID="settings-storage-row"
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
                {SHOW_LOGS ? (
                  <>
                    <SettingsToggleItem
                      title="Verbose logging"
                      description="Log renders, layout shifts, and diagnostics. Turn off to reduce dev lag."
                      testID="settings-verbose-logging-toggle"
                      isSelected={verboseLoggingEnabled}
                      onSelectedChange={setVerboseLoggingEnabled}
                    />
                    <Separator className="mx-4" />
                  </>
                ) : null}
                <SettingsToggleItem
                  title="Layout guides"
                  testID="settings-layout-guides-toggle"
                  isSelected={layoutGuides}
                  onSelectedChange={setLayoutGuides}
                />
                <Separator className="mx-4" />
                <SettingsToggleItem
                  title="Show taps"
                  testID="settings-show-taps-toggle"
                  isSelected={showTouches}
                  onSelectedChange={setShowTouches}
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
                  testID="settings-mock-fail-payment-request-toggle"
                  isSelected={mockFailPaymentRequest}
                  onSelectedChange={setMockFailPaymentRequest}
                />
                <Separator className="mx-4" />
                <SettingsToggleItem
                  title="Switch profiles without restart"
                  testID="settings-in-process-profile-switch-toggle"
                  isSelected={inProcessProfileSwitch}
                  onSelectedChange={setInProcessProfileSwitch}
                />
                <Separator className="mx-4" />
                <SettingsToggleItem
                  title="Mock no-glass"
                  testID="settings-mock-no-glass-toggle"
                  isSelected={mockNoGlass}
                  onSelectedChange={setMockNoGlass}
                />
              </ListGroup>
            </Section>
          </LayoutShiftProbe>
        ) : null}

        <LayoutShiftProbe tag="settings.danger-zone">
          <Section title="Danger Zone" isDanger>
            <ListGroup variant="secondary">
              <SettingsListLinkItem
                href="/(settings-flow)/delete"
                title="Delete account"
                testID="settings-delete-row"
                isDanger
              />
            </ListGroup>
          </Section>
        </LayoutShiftProbe>

        <LayoutShiftProbe tag="settings.version">
          <Pressable
            onPress={handleVersionPress}
            testID="settings-version-row"
            accessible
            accessibilityRole="button"
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
        </LayoutShiftProbe>
      </ScreenScrollView>
    </ScreenWrapper>
  );
};

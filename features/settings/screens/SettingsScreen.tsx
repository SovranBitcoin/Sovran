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
import { AVATAR_FALLBACK_VARIANT_LABELS } from '@/shared/lib/avatarFallback';
import { useNotificationPolicyStore } from '@/features/feed/stores/notificationPolicyStore';
import { notificationPolicyLabel } from '@/features/feed/lib/notificationCopy';
import { useNip46RequestsStore } from '@/features/nostrSigner';

export const name = Application.applicationName;
export const version = Application.nativeApplicationVersion;
export const buildNumber = Application.nativeBuildVersion;

const ProfileButton = () => {
  const { keys: nostrKeys } = useNostrKeysContext();
  const { displayName, picture } = useProfileDisplay(nostrKeys?.pubkey || '');

  return (
    <ListGroup variant="secondary">
      <PressableFeedback
        animation={false}
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
                fallbackVariant="beam"
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

const TRIPLE_TAP_WINDOW_MS = 1500;

const SIGNER_ROW_DESCRIPTION = 'Sign in to Nostr apps with this device';

/** Live row description: pending-count variant when the signer queue is non-empty. */
function signerRowDescription(pendingCount: number): string {
  if (pendingCount <= 0) return SIGNER_ROW_DESCRIPTION;
  return pendingCount === 1 ? '1 pending request' : `${pendingCount} pending requests`;
}

const SettingsListLinkItem: React.FC<{
  href: Href;
  title: string;
  description?: string;
  isDanger?: boolean;
}> = ({ href, title, description, isDanger }) => {
  const danger = useThemeColor('danger');
  return (
    <PressableFeedback animation={false} onPress={() => router.navigate(href)}>
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

const SettingsListActionItem: React.FC<{
  title: string;
  description?: string;
  onPress: () => void;
}> = ({ title, description, onPress }) => {
  return (
    <PressableFeedback animation={false} onPress={onPress}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>{title}</ListGroup.ItemTitle>
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
  const naggTierEnabled = useSettingsStore((state) => state.naggTierEnabled);
  const setNaggTierEnabled = useSettingsStore((state) => state.setNaggTierEnabled);
  const primalTierEnabled = useSettingsStore((state) => state.primalTierEnabled);
  const setPrimalTierEnabled = useSettingsStore((state) => state.setPrimalTierEnabled);
  const relayTierEnabled = useSettingsStore((state) => state.relayTierEnabled);
  const setRelayTierEnabled = useSettingsStore((state) => state.setRelayTierEnabled);
  const avatarFallbackVariant = useSettingsStore((state) => state.avatarFallbackVariant);
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
              href="/(settings-flow)/avatar"
              title="Avatar fallback"
              description={AVATAR_FALLBACK_VARIANT_LABELS[avatarFallbackVariant]}
            />
            <Separator className="mx-4" />
            <SettingsListLinkItem
              href="/(settings-flow)/notification-policy"
              title="Notifications"
              description={notificationPolicyLabel(notificationPolicy)}
            />
            <Separator className="mx-4" />
            <SettingsListLinkItem
              href="/(settings-flow)/relays"
              title="Relays"
              description="Manage where your posts publish"
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
              <PressableFeedback
                animation={false}
                onPress={() => setSendLocationEnabled(!(sendLocationEnabled ?? false))}>
                <PressableFeedback.Scale>
                  <ListGroup.Item disabled>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>Location Stamps</ListGroup.ItemTitle>
                      <ListGroup.ItemDescription>
                        Attach your approximate location when making transactions. (metadata only
                        stored on your device)
                      </ListGroup.ItemDescription>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      <HeroSwitch
                        isSelected={sendLocationEnabled ?? false}
                        onSelectedChange={setSendLocationEnabled}
                      />
                    </ListGroup.ItemSuffix>
                  </ListGroup.Item>
                </PressableFeedback.Scale>
                <PressableFeedback.Ripple />
              </PressableFeedback>
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
                />
                <Separator className="mx-4" />
                <PressableFeedback animation={false} onPress={() => setMockMode(!mockMode)}>
                  <PressableFeedback.Scale>
                    <ListGroup.Item disabled>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>Mock Mode</ListGroup.ItemTitle>
                      </ListGroup.ItemContent>
                      <ListGroup.ItemSuffix>
                        <HeroSwitch isSelected={mockMode} onSelectedChange={setMockMode} />
                      </ListGroup.ItemSuffix>
                    </ListGroup.Item>
                  </PressableFeedback.Scale>
                  <PressableFeedback.Ripple />
                </PressableFeedback>
                <Separator className="mx-4" />
                <PressableFeedback animation={false} onPress={() => setMockOffline(!mockOffline)}>
                  <PressableFeedback.Scale>
                    <ListGroup.Item disabled>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>Mock Offline</ListGroup.ItemTitle>
                      </ListGroup.ItemContent>
                      <ListGroup.ItemSuffix>
                        <HeroSwitch isSelected={mockOffline} onSelectedChange={setMockOffline} />
                      </ListGroup.ItemSuffix>
                    </ListGroup.Item>
                  </PressableFeedback.Scale>
                  <PressableFeedback.Ripple />
                </PressableFeedback>
                <Separator className="mx-4" />
                <PressableFeedback animation={false} onPress={() => setMockFailSend(!mockFailSend)}>
                  <PressableFeedback.Scale>
                    <ListGroup.Item disabled>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>Mock Fail Send</ListGroup.ItemTitle>
                      </ListGroup.ItemContent>
                      <ListGroup.ItemSuffix>
                        <HeroSwitch isSelected={mockFailSend} onSelectedChange={setMockFailSend} />
                      </ListGroup.ItemSuffix>
                    </ListGroup.Item>
                  </PressableFeedback.Scale>
                  <PressableFeedback.Ripple />
                </PressableFeedback>
                <Separator className="mx-4" />
                <PressableFeedback animation={false} onPress={() => setMockFailMelt(!mockFailMelt)}>
                  <PressableFeedback.Scale>
                    <ListGroup.Item disabled>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>Mock Fail Melt</ListGroup.ItemTitle>
                      </ListGroup.ItemContent>
                      <ListGroup.ItemSuffix>
                        <HeroSwitch isSelected={mockFailMelt} onSelectedChange={setMockFailMelt} />
                      </ListGroup.ItemSuffix>
                    </ListGroup.Item>
                  </PressableFeedback.Scale>
                  <PressableFeedback.Ripple />
                </PressableFeedback>
                <Separator className="mx-4" />
                <PressableFeedback
                  animation={false}
                  onPress={() => setMockFailPaymentRequest(!mockFailPaymentRequest)}>
                  <PressableFeedback.Scale>
                    <ListGroup.Item disabled>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>Mock Fail Payment Request</ListGroup.ItemTitle>
                      </ListGroup.ItemContent>
                      <ListGroup.ItemSuffix>
                        <HeroSwitch
                          isSelected={mockFailPaymentRequest}
                          onSelectedChange={setMockFailPaymentRequest}
                        />
                      </ListGroup.ItemSuffix>
                    </ListGroup.Item>
                  </PressableFeedback.Scale>
                  <PressableFeedback.Ripple />
                </PressableFeedback>
                <Separator className="mx-4" />
                <PressableFeedback
                  animation={false}
                  onPress={() => setWhitenoiseEnabled(!whitenoiseEnabled)}>
                  <PressableFeedback.Scale>
                    <ListGroup.Item disabled>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>White Noise</ListGroup.ItemTitle>
                      </ListGroup.ItemContent>
                      <ListGroup.ItemSuffix>
                        <HeroSwitch
                          isSelected={whitenoiseEnabled}
                          onSelectedChange={setWhitenoiseEnabled}
                        />
                      </ListGroup.ItemSuffix>
                    </ListGroup.Item>
                  </PressableFeedback.Scale>
                  <PressableFeedback.Ripple />
                </PressableFeedback>
                <Separator className="mx-4" />
                <PressableFeedback animation={false} onPress={() => setMockNoGlass(!mockNoGlass)}>
                  <PressableFeedback.Scale>
                    <ListGroup.Item disabled>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>Mock no-glass</ListGroup.ItemTitle>
                      </ListGroup.ItemContent>
                      <ListGroup.ItemSuffix>
                        <HeroSwitch isSelected={mockNoGlass} onSelectedChange={setMockNoGlass} />
                      </ListGroup.ItemSuffix>
                    </ListGroup.Item>
                  </PressableFeedback.Scale>
                  <PressableFeedback.Ripple />
                </PressableFeedback>
                <Separator className="mx-4" />
                <PressableFeedback
                  animation={false}
                  onPress={() => setNaggTierEnabled(!naggTierEnabled)}>
                  <PressableFeedback.Scale>
                    <ListGroup.Item disabled>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>Nostr tier: nagg</ListGroup.ItemTitle>
                        <ListGroup.ItemDescription>
                          Off = skip our nagg app-view (simulate nagg down)
                        </ListGroup.ItemDescription>
                      </ListGroup.ItemContent>
                      <ListGroup.ItemSuffix>
                        <HeroSwitch
                          isSelected={naggTierEnabled}
                          onSelectedChange={setNaggTierEnabled}
                        />
                      </ListGroup.ItemSuffix>
                    </ListGroup.Item>
                  </PressableFeedback.Scale>
                  <PressableFeedback.Ripple />
                </PressableFeedback>
                <Separator className="mx-4" />
                <PressableFeedback
                  animation={false}
                  onPress={() => setPrimalTierEnabled(!primalTierEnabled)}>
                  <PressableFeedback.Scale>
                    <ListGroup.Item disabled>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>Nostr tier: Primal cache</ListGroup.ItemTitle>
                        <ListGroup.ItemDescription>
                          Off = skip Primal&apos;s cache server (simulate Primal down)
                        </ListGroup.ItemDescription>
                      </ListGroup.ItemContent>
                      <ListGroup.ItemSuffix>
                        <HeroSwitch
                          isSelected={primalTierEnabled}
                          onSelectedChange={setPrimalTierEnabled}
                        />
                      </ListGroup.ItemSuffix>
                    </ListGroup.Item>
                  </PressableFeedback.Scale>
                  <PressableFeedback.Ripple />
                </PressableFeedback>
                <Separator className="mx-4" />
                <PressableFeedback
                  animation={false}
                  onPress={() => setRelayTierEnabled(!relayTierEnabled)}>
                  <PressableFeedback.Scale>
                    <ListGroup.Item disabled>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>Nostr tier: raw relays</ListGroup.ItemTitle>
                        <ListGroup.ItemDescription>
                          Off = skip the raw-relay floor (simulate relays down)
                        </ListGroup.ItemDescription>
                      </ListGroup.ItemContent>
                      <ListGroup.ItemSuffix>
                        <HeroSwitch
                          isSelected={relayTierEnabled}
                          onSelectedChange={setRelayTierEnabled}
                        />
                      </ListGroup.ItemSuffix>
                    </ListGroup.Item>
                  </PressableFeedback.Scale>
                  <PressableFeedback.Ripple />
                </PressableFeedback>
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

          <Pressable onPress={handleVersionPress}>
            <VStack spacing={4}>
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

import React, { useRef, useCallback } from 'react';
import { ScrollView, Linking, Alert } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

import { Link, router, type Href } from 'expo-router';
import { truncateMiddle } from '@/shared/lib/strings';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import * as Application from 'expo-application';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import Icon from 'assets/icons';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useProfileDisplay } from '@/shared/hooks/useProfileDisplay';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { devModePopup } from '@/shared/lib/popup';
import opacity from 'hex-color-opacity';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { ListGroup, PressableFeedback, Separator, Switch as HeroSwitch } from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log, useLifecycleLogger } from '@/shared/lib/logger';

export const name = Application.applicationName;
export const version = Application.nativeApplicationVersion;
export const buildNumber = Application.nativeBuildVersion;

export const Section: React.FC<{
  title: string;
  children: React.ReactNode;
  isDanger?: boolean;
}> = ({ title, children, isDanger }) => {
  const danger = useThemeColor('danger');

  return (
    <View className="py-3">
      <Text
        className="text-foreground/50 my-2 ml-3 uppercase tracking-wide"
        size={13}
        medium
        style={isDanger ? { color: danger } : undefined}>
        {title}
      </Text>
      <View className="overflow-hidden rounded-xl">{children}</View>
    </View>
  );
};

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

export const ROW_ICON_SIZE = 20;

export const RowButton: React.FC<{
  label: string;
  value?: string;
  onPress?: () => void;
  href?: Href;
  isFirst?: boolean;
  isLast?: boolean;
  isDanger?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}> = ({ label, value, onPress, href, isFirst, isLast, isDanger, leftIcon, rightIcon }) => {
  const [foreground, surfaceSecondary, surfaceTertiary, danger] = useThemeColor([
    'foreground',
    'surface-secondary',
    'surface-tertiary',
    'danger',
  ] as const);

  const content = (
    <View
      className={`p-3 ${isFirst ? 'rounded-t-xl' : ''} ${isLast ? 'rounded-b-xl' : ''} bg-transparent`}
      style={{
        backgroundColor: surfaceSecondary,
        borderColor: surfaceTertiary,
        borderTopWidth: !isFirst ? 1 : 0,
      }}>
      <HStack align="center" gap={8} className="pr-1">
        {leftIcon}
        <Text
          className="tracking-tight"
          size={ROW_ICON_SIZE - 5}
          bold
          style={{
            flex: 1,
            color: isDanger ? danger : foreground,
            includeFontPadding: false,
            lineHeight: ROW_ICON_SIZE - 4,
          }}>
          {label}
        </Text>
        {value && (
          <Text
            className="tracking-tight"
            bold
            size={ROW_ICON_SIZE}
            style={{
              color: isDanger ? danger : opacity(foreground, 0.4),
              includeFontPadding: false,
              lineHeight: ROW_ICON_SIZE,
            }}>
            {value}
          </Text>
        )}
        {onPress || href ? (
          (rightIcon ?? (
            <Icon
              name="fa6-solid:chevron-right"
              color={isDanger ? danger : opacity(foreground, 0.4)}
              size={ROW_ICON_SIZE}
            />
          ))
        ) : (
          <Spacer size={4} />
        )}
      </HStack>
    </View>
  );

  if (href) {
    return (
      <Link href={href} asChild>
        <TouchableOpacity>{content}</TouchableOpacity>
      </Link>
    );
  }

  return (
    <TouchableOpacity onPress={onPress} disabled={!onPress}>
      {content}
    </TouchableOpacity>
  );
};

const TRIPLE_TAP_WINDOW_MS = 1500;

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
  const mockNoGlass = useSettingsStore((state) => state.mockNoGlass);
  const setMockNoGlass = useSettingsStore((state) => state.setMockNoGlass);

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
      devModePopup(newMode);
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
            <SettingsListLinkItem href="/(settings-flow)/routing" title="Swap Routing" />
          </ListGroup>
        </Section>
        <Section title="App Information">
          <ListGroup variant="secondary">
            <SettingsListActionItem
              title="View Source on GitHub"
              onPress={() => {
                Linking.openURL('https://github.com/SovranBitcoin/Sovran');
              }}
            />
            <Separator className="mx-4" />
            <SettingsListActionItem
              title="Contact the Developer"
              onPress={() => {
                Linking.openURL('https://x.com/KevinKelbie');
              }}
            />
          </ListGroup>
        </Section>
        <Section title="Security">
          <ListGroup variant="secondary">
            <SettingsListLinkItem href="/(settings-flow)/keyring" title="P2PK Keys" />
            <Separator className="mx-4" />
            <SettingsListLinkItem
              href="/(settings-flow)/recovery"
              title="Recover Wallet"
              description="Restore ecash from all mints using your seed"
            />
          </ListGroup>
        </Section>

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
              <SettingsListActionItem title="Export Database" onPress={handleExportDatabase} />
              <Separator className="mx-4" />
              <Separator className="mx-4" />
              <SettingsListLinkItem
                href="/(settings-flow)/storage"
                title="Storage Inventory"
                description="View persisted storage keys and coco database files"
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
            </ListGroup>
          </Section>
        ) : null}

        <Section title="Danger Zone" isDanger>
          <ListGroup variant="secondary">
            <SettingsListLinkItem href="/(settings-flow)/delete" title="Delete Account" isDanger />
          </ListGroup>
        </Section>

        <TouchableOpacity onPress={handleVersionPress}>
          <VStack spacing={4}>
            <Text className="text-foreground/50 text-center" bold size={13}>
              {name}
            </Text>
            <Text className="text-foreground/50 text-center" size={13} medium>
              App Version {version} ({buildNumber})
            </Text>
          </VStack>
        </TouchableOpacity>
      </ScrollView>
    </ScreenWrapper>
  );
};

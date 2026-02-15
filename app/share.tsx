import React, { useCallback, useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { RowButton, Section } from 'app/settings-pages';
import Icon, { CurrencyIcon } from 'assets/icons';
import { Text } from 'components/ui/Text';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import * as Clipboard from 'expo-clipboard';
import { popup } from '@/helper/popup';
import { useTheme } from 'providers/ThemeProvider';
import { truncateMiddle } from 'helper/strings';
import opacity from 'hex-color-opacity';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ModalLayoutWrapper } from 'app/debugModal';
import { Tabs } from 'components/ui/Tabs';

// Configuration for different share types
const SHARE_CONFIGS = {
  profile: {
    title: 'Profile Details',
    sectionTitle: 'PROFILE',
    unit: 'nostr',
    popupMessage: 'npub_copied',
    dataKey: 'npub',
    iconCurrency: 'nostr',
  },
  p2pk: {
    title: 'P2PK Public Key',
    sectionTitle: 'PUBLIC KEY',
    unit: 'p2pk',
    popupMessage: 'p2pk_copied',
    dataKey: 'publicKey',
    iconCurrency: 'p2pk',
  },
  npub: {
    title: 'Nostr Public Key',
    sectionTitle: 'NPUB',
    unit: 'nostr',
    popupMessage: 'npub_copied',
    dataKey: 'npub',
    iconCurrency: 'nostr',
  },
};

function ShareModal() {
  const params = useLocalSearchParams<{
    type: keyof typeof SHARE_CONFIGS;
    data: string;
    npub?: string; // Optional npub for showing tabs
  }>();

  const { type = 'profile', data, npub } = params;
  const { getPrimaryColor } = useTheme();

  // Determine if we should show tabs (when both p2pk and npub are available)
  const showTabs = type === 'p2pk' && npub;
  const tabs = showTabs ? ['P2PK', 'NPUB'] : [];
  const [selectedTab, setSelectedTab] = useState('P2PK');

  // Get the config based on current selection
  const getActiveConfig = () => {
    if (showTabs && selectedTab === 'NPUB') {
      return SHARE_CONFIGS.npub;
    }
    return SHARE_CONFIGS[type];
  };

  // Get the active data based on current selection
  const getActiveData = () => {
    if (showTabs && selectedTab === 'NPUB') {
      return npub;
    }
    return data;
  };

  const config = getActiveConfig();
  const activeData = getActiveData();

  const handleTabPress = useCallback((tab: string) => {
    setSelectedTab(tab);
  }, []);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(activeData);
    popup({ message: config.popupMessage, type: 'success' });
  }, [activeData, config.popupMessage]);

  const CloseButton = () => (
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
      <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
    </TouchableOpacity>
  );

  // Dynamic title based on tabs
  const headerTitle = showTabs
    ? selectedTab === 'NPUB'
      ? 'Nostr Public Key'
      : 'P2PK Public Key'
    : config.title;

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle,
          headerTitleStyle: { color: getPrimaryColor('0') },
          headerTintColor: getPrimaryColor('0'),
          headerLeft: () => <CloseButton />,
        }}
      />
      <ModalLayoutWrapper>
        {/* Tab bar - only show if npub is available for p2pk type */}
        {showTabs && (
          <View style={{ marginBottom: 16 }}>
            <Tabs tabs={tabs} selectedTab={selectedTab} handleTabPress={handleTabPress} />
          </View>
        )}

        <PaymentInfo
          popupMessage={config.popupMessage}
          data={activeData}
          unit={config.iconCurrency}
        />

        <Section title={config.sectionTitle}>
          <RowButton
            isFirst
            onPress={handleCopy}
            rightIcon={
              <Icon name="lets-icons:copy" size={20} color={opacity(getPrimaryColor('0'), 0.4)} />
            }
            label={
              <HStack align="center" gap={8}>
                <CurrencyIcon
                  colors={[opacity(getPrimaryColor('0'), 0.4)]}
                  width={20}
                  currency={config.iconCurrency}
                />
                <Text style={{ color: opacity(getPrimaryColor('0'), 0.9) }} bold>
                  {truncateMiddle(activeData, 10)}
                </Text>
              </HStack>
            }
          />
        </Section>
      </ModalLayoutWrapper>
    </>
  );
}

export default withSheetProvider(ShareModal);

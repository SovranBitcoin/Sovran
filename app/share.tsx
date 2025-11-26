import React, { useCallback } from 'react';
import { ScrollView } from 'react-native';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { RowButton, Section } from 'app/settings-pages';
import Icon, { CurrencyIcon } from 'assets/icons';
import { Text } from 'components/ui/Text';
import { View, HStack } from 'components/ui/View';
import * as Clipboard from 'expo-clipboard';
import { popup } from '@/helper/popup';
import { useTheme } from 'providers/ThemeProvider';
import { truncateMiddle } from 'helper/strings';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
};

function ShareModal() {
  const params = useLocalSearchParams<{
    type: keyof typeof SHARE_CONFIGS;
    data: string;
  }>();

  const { type = 'profile', data } = params;
  const config = SHARE_CONFIGS[type];
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(data);
    popup({ message: config.popupMessage, type: 'success' });
  }, [data, config.popupMessage]);

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
      <Stack.Screen options={{ headerTitle: config.title }} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 48,
          paddingBottom: 40,
        }}>
        <PaymentInfo popupMessage={config.popupMessage} data={data} unit={config.iconCurrency} />
        <View style={{ marginHorizontal: 16 }}>
          <Section title={config.sectionTitle}>
            <RowButton
              isFirst
              onPress={handleCopy}
              rightIcon={<Icon name="lets-icons:copy" size={20} color={getPrimaryColor('400')} />}
              label={
                <HStack align="center" gap={8}>
                  <CurrencyIcon
                    colors={[getPrimaryColor('400')]}
                    width={20}
                    currency={config.iconCurrency}
                  />
                  <Text className="text-primary-50" bold>
                    {truncateMiddle(data, 10)}
                  </Text>
                </HStack>
              }
            />
          </Section>
        </View>
      </ScrollView>
    </View>
  );
}

export default withSheetProvider(ShareModal);

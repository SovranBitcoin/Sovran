import React, { useCallback } from 'react';
import Modal from 'components/blocks/Modal';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { RowButton, Section } from 'app/settings-pages';
import Icon, { CurrencyIcon } from 'assets/icons';
import { Text } from 'components/ui/Text';
import { View, HStack } from 'components/ui/View';
import { greys } from 'helper/colors';
import * as Clipboard from 'expo-clipboard';
import { showMessage } from 'helper/popup/popups';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useSelector } from 'react-redux';
import { truncateMiddle } from 'helper/strings';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { useLocalSearchParams } from 'expo-router';

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
};

function ShareModal() {
  const params = useLocalSearchParams<{
    type: keyof typeof SHARE_CONFIGS;
    data: string;
  }>();

  const { type = 'profile', data } = params;
  const config = SHARE_CONFIGS[type];
  const theme = useSelector(memoizedGetTheme);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(data);
    showMessage(config.popupMessage);
  }, [data, config.popupMessage]);

  return (
    <Modal showClose title={config.title} buttons={<></>}>
      <PaymentInfo
        popupMessage={config.popupMessage}
        data={data}
        showSection={false}
        unit={config.unit}
      />
      <View style={{ marginHorizontal: 16 }}>
        <Section title={config.sectionTitle}>
          <RowButton
            isFirst
            onPress={handleCopy}
            rightIcon={<Icon name="lets-icons:copy" size={20} color={greys(theme)[400]} />}
            label={
              <HStack align="center" gap={8}>
                <CurrencyIcon
                  colors={[greys(theme)[400]]}
                  width={20}
                  currency={config.iconCurrency}
                />
                <Text style={{ color: greys(theme)[50] }} bold>
                  {truncateMiddle(data, 10)}
                </Text>
              </HStack>
            }
          />
        </Section>
      </View>
    </Modal>
  );
}

export default withSheetProvider(ShareModal);

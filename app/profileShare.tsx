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

function ModalScreen() {
  const { npub } = useLocalSearchParams<{ npub: string }>();
  const theme = useSelector(memoizedGetTheme);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(npub);
    showMessage('npub_copied');
  }, [npub]);

  return (
    <Modal showClose title="Profile Details" buttons={<></>}>
      <PaymentInfo popupMessage={'npub_copied'} data={npub} showSection={false} unit="nostr" />
      <View
        style={{
          marginHorizontal: 16,
        }}>
        <Section title="PROFILE">
          <RowButton
            isFirst
            onPress={handleCopy}
            rightIcon={<Icon name="lets-icons:copy" size={20} color={greys(theme)[400]} />}
            label={
              <HStack align="center" gap={8}>
                <CurrencyIcon colors={[greys(theme)[400]]} width={20} currency={'nostr'} />
                <Text style={{ color: greys(theme)[50] }} bold>
                  {truncateMiddle(npub, 10)}
                </Text>
              </HStack>
            }
          />
        </Section>
      </View>
    </Modal>
  );
}

export default withSheetProvider(ModalScreen);

import React, { useCallback } from 'react';
import Modal from 'components/layout/Modal';
import { PaymentInfo } from 'components/layout/PaymentInfo';
import { RowButton, Section } from 'app/settings';
import Icon, { CurrencyIcon } from 'assets/icons';
import { Text } from 'components/common/Text';
import { View, HStack, VStack } from 'components/common/View';
import { greys } from 'helper/colors';
import * as Clipboard from 'expo-clipboard';
import { showMessage } from 'helper/popup/popups';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useSelector } from 'react-redux';
import { truncateMiddle } from 'helper/strings';
import { useTypedRoute } from 'helper/navigation';
import { withSheetProvider } from 'hocs/withSheetProvider';

function ModalScreen() {
  const { npub } = useTypedRoute<'profileShare'>();
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

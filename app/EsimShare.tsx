import React from 'react';
import Modal from 'components/layout/Modal';
import { PaymentInfo } from 'components/layout/PaymentInfo';
import * as Clipboard from 'expo-clipboard';
import { useTypedRoute } from 'helper/navigation';
import { showMessage } from 'helper/popup/popups';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { View } from 'components/common/View';
import { withSheetProvider } from 'components/hocs/withSheetProvider';

function ModalScreen() {
  const { esimCode, esimLink, location } = useTypedRoute<'esimShare'>();

  const handleCopy = async () => {
    await Clipboard.setStringAsync(esimLink);
    showMessage('esim_link_copied', {}, { emoji: '🎉' });
  };

  return (
    <Modal
      title="Share eSIM"
      showBack
      buttons={
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'transparent',
            paddingBottom: 8,
          }}>
          <ButtonHandler
            buttons={[
              {
                text: 'Copy',
                variant: 'primary',
                onPress: handleCopy,
              },
            ]}></ButtonHandler>
        </View>
      }>
      <PaymentInfo
        link={esimLink}
        popupMessage="esim_link_copied"
        data={esimCode}
        variant="secondary"
        unit={`location_${location}`}
      />
    </Modal>
  );
}

export default withSheetProvider(ModalScreen);

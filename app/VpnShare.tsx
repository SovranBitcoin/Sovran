import React from 'react';
import Modal from 'components/layout/Modal';
import { PaymentInfo } from 'components/layout/PaymentInfo';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTypedRoute } from 'helper/navigation';
import { truncateMiddle } from 'helper/strings';
import { showMessage } from 'helper/popup/popups';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Spacer, View } from 'components/common/View';
import { Section } from 'components/common/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';

function ModalScreen() {
  const { vpnCode, location, config, hash } = useTypedRoute<'vpnShare'>();

  const downloadAndShareVPN = async () => {
    try {
      // Save the file in the app's document directory first
      const path = FileSystem.documentDirectory + `vpn_${hash}.conf`;
      await FileSystem.writeAsStringAsync(path, vpnCode, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      // Check if the Sharing API is available and use it
      if (!(await Sharing.isAvailableAsync())) {
        showMessage('sharing_unavailable', {}, { emoji: '⚠️' });
        return;
      }

      // Open the sharing dialog to let the user choose where to save
      await Sharing.shareAsync(path);
      // showMessage("VPN configuration shared", path, null, null);
    } catch {
      showMessage('download_failed', {}, { emoji: '🚨' });
    }
  };

  return (
    <Modal
      showBack
      title="Share VPN"
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
                text: 'Download',
                variant: 'primary',
                onPress: downloadAndShareVPN,
              },
            ]}
          />
        </View>
      }>
      <PaymentInfo
        popupMessage={'vpn_copied'}
        data={vpnCode}
        showSection={false}
        variant="secondary"
        unit={`location_${location}`}
      />
      <Spacer size={12} />
      {config && (
        <Section
          items={[
            {
              title: 'Private Key',
              value: truncateMiddle(
                config?.find((w) => w?.startsWith('PrivateKey'))?.split('=')?.[1] ?? '',
                5
              ),
            },
            {
              title: 'Public Key',
              value: truncateMiddle(
                config?.find((w) => w?.startsWith('PublicKey'))?.split('=')?.[1] ?? '',
                5
              ),
            },
            {
              title: 'Preshared Key',
              value: truncateMiddle(
                config?.find((w) => w?.startsWith('PresharedKey'))?.split('=')?.[1] ?? '',
                5
              ),
            },
            {
              title: 'Address',
              value: config?.find((w) => w?.startsWith('Address'))?.split('=')?.[1],
            },
            {
              title: 'DNS',
              value: config
                ?.find((w) => w?.startsWith('DNS'))
                ?.split('=')?.[1]
                ?.trim(),
            },
            {
              title: 'Endpoint',
              value: config
                ?.find((w) => w?.startsWith('Endpoint'))
                ?.split('=')?.[1]
                ?.trim(),
            },
            {
              title: 'AllowedIPs',
              value: config
                ?.find((w) => w?.startsWith('AllowedIPs'))
                ?.split('=')?.[1]
                ?.trim(),
            },
          ]}
        />
      )}
    </Modal>
  );
}

export default withSheetProvider(ModalScreen);

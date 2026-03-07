import React from 'react';

import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { QRButton } from '@/shared/ui/composed/QRButton';
import { AccountPagerViewLayout } from './AccountPagerViewLayout';
import { useAccountPagerView, type AccountPagerViewProps } from './useAccountPagerView';

export function AccountPagerView(props: AccountPagerViewProps): React.ReactElement {
  const shared = useAccountPagerView(props);
  const { handleReceive, handleScanQR, handleSend } = shared;

  return (
    <AccountPagerViewLayout
      shared={shared}
      renderReceiveButton={() => (
        <CapsuleButton label="Receive" icon="lucide:arrow-down-left" onPress={handleReceive} />
      )}
      renderSendButton={() => (
        <CapsuleButton label="Send" icon="lucide:arrow-up-right" onPress={handleSend} />
      )}
      renderQrButton={() => <QRButton onPress={handleScanQR} />}
    />
  );
}

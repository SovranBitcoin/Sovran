import React from 'react';

import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { QRButton } from '@/shared/ui/composed/QRButton';
import { AccountPagerViewLayout } from './AccountPagerViewLayout';
import { type AccountPagerViewShared } from './useAccountPagerView';

export function AccountPagerViewLiquid(shared: AccountPagerViewShared): React.ReactElement {
  const { handleReceive, handleScanQR, handleSend } = shared;

  return (
    <AccountPagerViewLayout
      shared={shared}
      renderReceiveButton={() => (
        <CapsuleButton
          label="Receive"
          icon="lucide:arrow-down-left"
          systemIcon="arrow.down.left"
          onPress={handleReceive}
        />
      )}
      renderSendButton={() => (
        <CapsuleButton
          label="Send"
          icon="lucide:arrow-up-right"
          systemIcon="arrow.up.right"
          onPress={handleSend}
        />
      )}
      renderQrButton={() => <QRButton onPress={handleScanQR} />}
    />
  );
}

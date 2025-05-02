import React from 'react';
import EcashLightningReceiver from 'components/layout/EcashLightningReceiver';
import { useTypedRoute } from 'helper/navigation';
import { SheetProvider } from 'react-native-actions-sheet';
import { withSheetProvider } from 'components/hocs/withSheetProvider';

function ModalScreen() {
  const { unit, type } = useTypedRoute<'receive'>();

  if (type === 'ecash' || type === 'lightning') {
    return <EcashLightningReceiver unit={unit} type={type} />;
  }
}

export default withSheetProvider(ModalScreen);

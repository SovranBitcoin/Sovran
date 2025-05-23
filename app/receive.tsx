import React from 'react';
import EcashLightningReceiver from 'components/layout/EcashLightningReceiver';
import { useTypedRoute } from 'helper/navigation';
import { SheetProvider } from 'react-native-actions-sheet';
import { withSheetProvider } from 'components/hocs/withSheetProvider';

function ModalScreen() {
  const { unit } = useTypedRoute<'receive'>();

  return <EcashLightningReceiver unit={unit} />;
}

export default withSheetProvider(ModalScreen);

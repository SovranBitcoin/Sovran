import React from 'react';
import EcashLightningReceiver from 'components/layout/EcashLightningReceiver';
import { useTypedRoute } from 'helper/navigation';

function ModalScreen() {
  const { unit, type } = useTypedRoute<'receive'>();

  if (type === 'ecash' || type === 'lightning') {
    return <EcashLightningReceiver unit={unit} type={type} />;
  }
}

export default ModalScreen;

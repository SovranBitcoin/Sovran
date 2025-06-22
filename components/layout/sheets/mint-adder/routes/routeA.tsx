import React from 'react';
import { RouteScreenProps, useSheetRef } from 'react-native-actions-sheet';
import MintAddMore from '../../mints/MintAddMore';

const RouteA = ({
  router,
  payload,
  ...props
}: RouteScreenProps<'example-sheet-with-router', 'route-a'>) => {
  const ref = useSheetRef('mint-adder');
  return (
    <MintAddMore
      payload={payload}
      onClose={(data) => {
        ref.current.hide(data); // this data is sent to the .show() method
        return;
      }}
    />
  );
};

export default RouteA;

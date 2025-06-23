import React from 'react';
import { RouteScreenProps, useSheetPayload, useSheetRef } from 'react-native-actions-sheet';
import MintAddMore from '../../mints/MintAddMore';

// eslint-disable-next-line no-empty-pattern
const RouteA = ({}: RouteScreenProps<'example-sheet-with-router', 'route-a'>) => {
  const ref = useSheetRef('mint-adder');
  const payload = useSheetPayload('example-sheet-with-router');

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

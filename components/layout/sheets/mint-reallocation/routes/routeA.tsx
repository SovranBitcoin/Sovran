import React from 'react';
import { RouteScreenProps, useSheetPayload, useSheetRef } from 'react-native-actions-sheet';
import { MintSelect } from 'components/layout/sheets/mints/MintSelect';

function RouteA(_: RouteScreenProps<'mint-reallocation', 'route-a'>) {
  const ref = useSheetRef('mint-reallocation');
  const payload = useSheetPayload('mint-reallocation');

  return (
    <MintSelect
      unit={payload.currency?.toLowerCase()}
      startInEditing
      onCancel={() => ref.current.hide()}
      onSaved={() => ref.current.hide()}
    />
  );
}

export default RouteA;

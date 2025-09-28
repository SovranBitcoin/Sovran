import React from 'react';
import { useSheetPayload, useSheetRouter } from 'react-native-actions-sheet';
import { MintSelect } from '../../mints/MintSelect';

interface Payload {
  pr: string;
  unit: string;
  amount: number; // satoshi
  pubkey?: string;
  email?: string;
  lud16?: string;
  redirect?: string;
}

const RouteA = () => {
  const payload = useSheetPayload('lightning-mpp') as Payload | undefined;
  const router = useSheetRouter('lightning-mpp');

  const handleMintSelected = async (
    mint: {
      id: string;
      name: string;
      iconUrl: string | null;
      unit: string;
    },
    balance: { amount: number; unit: string } | undefined
  ) => {
    if (!payload) return;

    // Navigate to confirmation page with the selected mint and payload
    router?.navigate('route-b', {
      ...payload,
      selectedMint: mint.id,
      selectedMintBalance: balance,
    });
  };

  return (
    <MintSelect
      onMintSelected={handleMintSelected}
      unit={payload?.unit}
      startInEditing={true}
      mode="mpp"
      mppPayload={payload}
    />
  );
};

export default RouteA;

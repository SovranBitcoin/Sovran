import React from 'react';
import { useSheetRouter } from 'react-native-actions-sheet/dist/src/hooks/use-router';
import ListRoute from '../mint-balance/routes/list';

interface MintSelectListProps {
  onMintSelected?: (
    mint: {
      id: string;
      name: string;
      iconUrl: string | null;
      unit: string;
    },
    balance: { amount: number; unit: string } | undefined
  ) => Promise<void>;
  unit?: string;
  onCancel?: () => void;
}

function MintSelectListComponent({
  onMintSelected,
  unit,
  onCancel: _onCancel,
}: MintSelectListProps) {
  const router = useSheetRouter('mint');

  const handleMintPress = async (
    mint: { id: string; name: string; iconUrl: string | null; unit: string },
    balance: { amount: number; unit: string }
  ) => {
    if (onMintSelected) {
      await onMintSelected(mint, balance);
    }
    router?.goBack();
  };

  const handleAddMintsPress = () => {
    router?.navigate('mintAddMore');
  };

  const handleDetailsPress = (mintUrl: string) => {
    router?.navigate('mintDetailsPage', {
      mintUrl: mintUrl,
    });
  };

  return (
    <ListRoute
      payload={{
        onMintPress: handleMintPress,
        showAddMintsButton: true,
        showDetailsButton: true,
        onAddMintsPress: handleAddMintsPress,
        onDetailsPress: handleDetailsPress,
        requireBalance: false,
        updateSelectedMint: true,
      }}
    />
  );
}

MintSelectListComponent.displayName = 'MintSelectListComponent';

export const MintSelectList = MintSelectListComponent;

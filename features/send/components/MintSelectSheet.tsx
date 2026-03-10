import { useCallback, useMemo } from 'react';

import { LegendList } from '@legendapp/list';
import { Mint } from 'coco-cashu-core';
import { useBalanceContext, useMints } from 'coco-cashu-react';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { getMintDisplayName } from '@/shared/lib/url';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { SheetHeader } from '@/shared/lib/popup/sheets/SheetHeader';

import { useSendMachine } from '../hooks/useSendMachine';

/**
 * Inline mint selection list, shown when the send machine
 * enters the `mintSelect` state (insufficient balance on current mint).
 *
 * Selecting a mint sends MINT_SELECTED to the machine,
 * which re-validates balance and continues the flow.
 */
export function MintSelectSheet() {
  const machine = useSendMachine();
  const { trustedMints } = useMints();
  const { balance: balances } = useBalanceContext();
  const foreground = useThemeColor('foreground');

  const requiredAmount = machine.context.amountSat;

  const sortedMints = useMemo(() => {
    return trustedMints
      .map((m) => ({
        mint: m,
        balance: balances[m.mintUrl] || 0,
        name: getMintDisplayName(m.mintUrl, m.mintInfo),
      }))
      .sort((a, b) => b.balance - a.balance);
  }, [trustedMints, balances]);

  const handleSelect = useCallback(
    (mintUrl: string) => {
      machine.selectMint(mintUrl);
    },
    [machine]
  );

  const handleCancel = useCallback(() => {
    machine.cancel();
  }, [machine]);

  const renderItem = useCallback(
    ({ item }: { item: (typeof sortedMints)[number] }) => {
      const hasSufficientBalance = item.balance >= requiredAmount;
      return (
        <TouchableOpacity
          onPress={() => handleSelect(item.mint.mintUrl)}
          style={{ opacity: hasSufficientBalance ? 1 : 0.4 }}
          className="border-border border-b px-4 py-3">
          <HStack align="center" spacing={3}>
            <Avatar name={item.name} picture={item.mint.mintInfo?.icon_url} size={36} />
            <VStack spacing={0.5} style={{ flex: 1 }}>
              <Text bold size={15} numberOfLines={1}>
                {item.name}
              </Text>
              <AmountFormatter amount={item.balance} unit="sat" size={13} weight="regular" />
            </VStack>
            {hasSufficientBalance && (
              <Text size={12} style={{ color: foreground, opacity: 0.5 }}>
                ✓
              </Text>
            )}
          </HStack>
        </TouchableOpacity>
      );
    },
    [requiredAmount, handleSelect, foreground]
  );

  return (
    <View style={{ flex: 1 }}>
      <View className="px-4 pt-2">
        <SheetHeader
          title="Select Mint"
          description={`Need at least ${requiredAmount.toLocaleString('en-US')} sats`}
        />
      </View>
      <LegendList
        data={sortedMints}
        renderItem={renderItem}
        keyExtractor={(item) => item.mint.mintUrl}
        estimatedItemSize={64}
        style={{ flex: 1 }}
      />
      <View className="px-4 pb-4 pt-2">
        <TouchableOpacity onPress={handleCancel} className="items-center py-3">
          <Text size={15} style={{ color: foreground, opacity: 0.6 }}>
            Cancel
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

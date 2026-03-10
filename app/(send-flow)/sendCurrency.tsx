/**
 * Standalone send currency route.
 *
 * Uses the standalone send state machine (not the unified paymentMachine).
 * Sheets are opened via the proven popup action sheet system when the
 * machine enters mintSelect or adjustmentPrompt states.
 */

import { useCallback, useEffect, useRef } from 'react';

import { router, Stack, useFocusEffect } from 'expo-router';

import { useBalanceContext, useMints } from 'coco-cashu-react';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { getMintDisplayName } from '@/shared/lib/url';
import { SendCurrencyScreen } from '@/features/send/screens/SendCurrencyScreen';
import { useSendMachine } from '@/features/send/hooks/useSendMachine';
import { offlineSendPopup, mintSelectPopup } from '@/shared/lib/popup';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { CURRENCY_CONFIG } from '@/features/send/screens/CurrencyScreen/types';
import { useSendMachineStore } from '@/features/send/store/sendMachineStore';

function SendCurrencyRoute() {
  const foreground = useThemeColor('foreground');
  const machine = useSendMachine();
  const { trustedMints } = useMints();
  const { balance: balances } = useBalanceContext();

  // Reset on first mount
  const didMountRef = useRef(false);
  if (!didMountRef.current) {
    didMountRef.current = true;
    machine.reset();
  }

  // Reset when returning to this screen if the machine finished (success/failure).
  // Reading snapshot directly from store avoids the stale closure problem.
  useFocusEffect(
    useCallback(() => {
      const snap = useSendMachineStore.getState().snapshot;
      if (snap.matches('success') || snap.matches('failure')) {
        machine.reset();
      }
    }, [machine])
  );

  // Track which sheet we opened so we don't re-trigger
  const sheetOpenRef = useRef<'mint-select' | 'offline-send' | null>(null);

  // --- Detect drag-close: if popup closes while machine is in a sheet state, cancel ---
  const isPopupOpen = usePopupStore((s) => s.isOpen);
  const prevPopupOpenRef = useRef(isPopupOpen);

  useEffect(() => {
    const wasOpen = prevPopupOpenRef.current;
    prevPopupOpenRef.current = isPopupOpen;

    if (wasOpen && !isPopupOpen && sheetOpenRef.current !== null) {
      // Sheet was drag-closed (or dismissed) without going through a callback
      sheetOpenRef.current = null;
      if (machine.isMintSelect || machine.isAdjustmentPrompt) {
        machine.cancel();
      }
    }
  }, [isPopupOpen, machine]);

  // --- Open mint-select sheet when machine enters mintSelect ---
  useEffect(() => {
    if (machine.isMintSelect && sheetOpenRef.current !== 'mint-select') {
      sheetOpenRef.current = 'mint-select';

      const mintData = trustedMints
        .map((m) => ({
          mintUrl: m.mintUrl,
          name: getMintDisplayName(m.mintUrl, m.mintInfo),
          iconUrl: m.mintInfo?.icon_url ?? null,
          balance: balances[m.mintUrl] || 0,
        }))
        .sort((a, b) => b.balance - a.balance);

      mintSelectPopup({
        requiredAmount: machine.context.amountSat,
        unit: 'sat',
        mints: mintData,
        onSelectMint: (mintUrl) => {
          sheetOpenRef.current = null;
          machine.selectMint(mintUrl);
        },
        onCancel: () => {
          sheetOpenRef.current = null;
          machine.cancel();
        },
      });
    } else if (!machine.isMintSelect && sheetOpenRef.current === 'mint-select') {
      sheetOpenRef.current = null;
    }
  }, [machine.isMintSelect, machine.context.amountSat, machine, trustedMints, balances]);

  // --- Open offline-send sheet when machine enters adjustmentPrompt ---
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const currencySymbol = CURRENCY_CONFIG[displayCurrency].symbol;

  useEffect(() => {
    if (machine.isAdjustmentPrompt && sheetOpenRef.current !== 'offline-send') {
      sheetOpenRef.current = 'offline-send';

      const isFiat = machine.context.denomination === 'fiat';
      const fiatSugg = machine.fiatOfflineSuggestions;
      const satSugg = machine.offlineSuggestions;

      const roundDownAmount = fiatSugg?.roundDownOption?.amount ?? satSugg?.roundDownAmount ?? null;
      const roundUpAmount = fiatSugg?.roundUpOption?.amount ?? satSugg?.roundUpAmount ?? null;

      offlineSendPopup({
        requestedAmount: machine.context.amountSat,
        roundDownAmount,
        roundUpAmount,
        unit: 'sat',
        fiat:
          isFiat && fiatSugg
            ? {
                symbol: currencySymbol,
                requestedMinorUnit: fiatSugg.requestedDisplayMinorUnit,
                roundDownMinorUnit: fiatSugg.roundDownOption?.displayMinorUnit ?? null,
                roundUpMinorUnit: fiatSugg.roundUpOption?.displayMinorUnit ?? null,
              }
            : undefined,
        onRoundDown: () => {
          sheetOpenRef.current = null;
          machine.roundDown();
        },
        onRoundUp: () => {
          sheetOpenRef.current = null;
          machine.roundUp();
        },
        onCancel: () => {
          sheetOpenRef.current = null;
          machine.cancel();
        },
      });
    } else if (!machine.isAdjustmentPrompt && sheetOpenRef.current === 'offline-send') {
      sheetOpenRef.current = null;
    }
  }, [machine.isAdjustmentPrompt, machine, currencySymbol]);

  // Navigate to success screen when token is created
  useEffect(() => {
    if (machine.isSuccess && machine.historyEntryJson) {
      router.replace({
        pathname: '/sendToken',
        params: { sendHistoryEntry: machine.historyEntryJson },
      });
    }
  }, [machine.isSuccess, machine.historyEntryJson]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Send Ecash',
          headerTitleAlign: 'center',
          headerTintColor: foreground,
        }}
      />
      <SendCurrencyScreen />
    </>
  );
}

export default SendCurrencyRoute;

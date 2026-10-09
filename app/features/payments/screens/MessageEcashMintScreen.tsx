/**
 * @fileoverview One mint's unclaimed message ecash.
 *
 * Opened from the wallet home's "To receive" card. The tokens held at this
 * mint are listed as payments, newest first, with one action that takes them
 * all. Taking them trusts the mint: the page names it, and nothing reaches it
 * before the button is pressed. A single row still opens the ordinary receive
 * screen, for a token the person wants to look at alone.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stack, useFocusEffect } from 'expo-router';
import { z } from 'zod';

import { drainNutDropRedeemQueue } from '@/features/nearPay/lib/nutDropAutoRedeem';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { buildReceiveHistoryEntry } from '@/shared/lib/cashu/utils';
import { formatAmount } from '@/shared/lib/currency';
import { formatDate } from '@/shared/lib/date';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { paymentLog, redactError } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { staticPopup } from '@/shared/lib/popup';
import { getMintDisplayName } from '@/shared/lib/url';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';
import { useStylePaint } from '@/shared/styles/appStyle';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { Screen } from '@/shared/ui/composed/Screen';
import { SectionHeading } from '@/shared/ui/composed/SectionHeading';
import { Surface } from '@/shared/ui/composed/Surface';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

import { MessageEcashRow } from '../components/MessageEcashRow';
import {
  markMessageEcashReviewed,
  receiveAllMessageEcash,
  reconcileParkedMessageEcash,
} from '../lib/dmEcashRecovery';
import { unclaimedMessageEcash, type UnclaimedMessageEcash } from '../lib/parkedMessageEcash';

const ParamsSchema = z.object({
  mintUrl: z.string().min(1).max(2048),
  unit: z.string().min(1).max(16).default('sat'),
});

const STATE_LABEL: Record<UnclaimedMessageEcash['state'], string | null> = {
  'untrusted-mint': null,
  failed: 'Not added',
  receiving: 'Receiving',
};

function detailFor(entry: UnclaimedMessageEcash): string {
  const when = formatDate(entry.receivedAt, 'short-date-time');
  const state = STATE_LABEL[entry.state];
  return state ? `${state} · ${when}` : when;
}

export function MessageEcashMintScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.messageEcash' });
  const mintUrl = params?.mintUrl ?? '';
  const unit = params?.unit ?? 'sat';
  const paint = useStylePaint();
  const pubkey = useNostrKeysContext().keys?.pubkey;
  const entries = useNutDropRedeemQueueStore((state) => state.byTokenHash);
  const unclaimed = useMemo(
    () => unclaimedMessageEcash(entries, mintUrl, unit),
    [entries, mintUrl, unit]
  );
  const held = unclaimed.filter((entry) => entry.state !== 'receiving');
  const heldTotal = held.reduce((sum, entry) => sum + entry.amount, 0);
  const unknownMint = held.some((entry) => entry.state === 'untrusted-mint');
  const mintName = getMintDisplayName(mintUrl);
  const [receiving, setReceiving] = useState(false);

  // The page is about ecash that is not in the wallet. Once the last of it
  // lands there is nothing left to show, so the page leaves for the home.
  const hadUnclaimed = useRef(false);
  useEffect(() => {
    if (unclaimed.length > 0) hadUnclaimed.current = true;
    else if (hadUnclaimed.current) router.back();
  }, [unclaimed.length]);

  // Back from the receive screen: a token taken there by hand closes here.
  useFocusEffect(
    useCallback(() => {
      if (!pubkey) return;
      let focused = true;
      void reconcileParkedMessageEcash(pubkey, () => focused).catch((error: unknown) => {
        paymentLog.warn('payment.dm_ecash.reconcile_failed', { error: redactError(error) });
      });
      return () => {
        focused = false;
      };
    }, [pubkey])
  );

  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  // No `finally`: the compiler does not lower one, and would leave the page
  // unmemoized.
  const receiveAll = async () => {
    if (!pubkey || receiving) return;
    setReceiving(true);
    const failed = await receiveAllMessageEcash(pubkey, mintUrl, unit, () => mounted.current)
      .then((requeued) => {
        paymentLog.info('payment.dm_ecash.receive_all', { requeued });
        return requeued > 0 ? drainNutDropRedeemQueue() : undefined;
      })
      .then(
        () => false,
        (error: unknown) => {
          paymentLog.warn('payment.dm_ecash.receive_all_failed', { error: redactError(error) });
          return true;
        }
      );
    if (failed) staticPopup('receive-failed');
    if (mounted.current) setReceiving(false);
  };

  const openOne = (entry: UnclaimedMessageEcash) => {
    if (!pubkey || entry.state === 'receiving') return;
    markMessageEcashReviewed(pubkey, entry.tokenHash);
    router.navigate({
      pathname: '/(receive-flow)/receiveToken',
      params: {
        receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(entry.token, entry.unit)),
      },
    });
  };

  if (!params) return null;

  const total = formatAmount({ amount: heldTotal, unit }, { useUserPreference: true });
  return (
    <Screen
      name="MessageEcashMintScreen"
      footer={
        <BottomButtons>
          <ButtonHandler
            buttons={[
              {
                text: receiving ? 'Receiving...' : 'Receive all',
                variant: 'primary',
                testID: 'message-ecash-receive-all',
                accessibilityLabel: `Receive all, ${total}, from ${mintName}`,
                disabled: held.length === 0 || receiving || !pubkey,
                onPress: receiveAll,
              },
            ]}
          />
        </BottomButtons>
      }>
      <Stack.Screen options={{ title: mintName }} />
      {__DEV__ && unclaimed.length === 0 ? (
        <E2EAccessibilityProbe
          testID="message-ecash-mint-empty"
          accessibilityLabel="No unclaimed ecash at this mint"
        />
      ) : null}
      <View className="gap-2 px-4">
        {unclaimed.length === 0 ? (
          <Text size={14} color={paint.text.secondary} className="py-8 text-center">
            Nothing to receive from this mint.
          </Text>
        ) : (
          <Surface testID="message-ecash-mint-list">
            <SectionHeading
              tone="status"
              label="To receive"
              detail={unclaimed.length === 1 ? '1 payment' : `${unclaimed.length} payments`}
            />
            {unclaimed.map((entry) => (
              <MessageEcashRow
                key={entry.tokenHash}
                testID={`message-ecash-token-${entry.tokenHash.slice(0, 8)}`}
                mintUrl={entry.mintUrl}
                showPicture={!unknownMint}
                amount={entry.amount}
                unit={entry.unit}
                title="Ecash"
                detail={detailFor(entry)}
                accessibilityLabel={`Ecash. ${detailFor(entry)}. Review`}
                onPress={() => openOne(entry)}
              />
            ))}
          </Surface>
        )}
        {unknownMint ? (
          <Text
            testID="message-ecash-unknown-mint-note"
            size={12}
            color={paint.text.secondary}
            className="px-4">
            {`You have not used ${mintName} before. Receiving adds it to your mints.`}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

/**
 * @fileoverview Canonical route shell for every mint-quote receive screen.
 *
 * The three rails are the same route: validate the JSON-encoded
 * `mintHistoryEntry` deep-link param, resolve it into screen props, and render
 * the screen for the rail. They differ only in which screen that is and what
 * the navigation bar says.
 *
 * Param validation happens at the route boundary per AUDIT.md dim-5 (audit
 * 23#F-002): an unguarded `JSON.parse(...)` here is the crash and
 * invoice-spoofing surface. The validated string is passed to
 * `useMintQuoteScreen`, which decodes it through `useScreenActions`.
 *
 * `onRequestMintList` is wired by the active receive-flow wrapper through
 * `usePaymentFlowMachine` so the user can swap mints mid-flow; standalone and
 * transactions-flow re-entries leave it undefined, which renders the entry
 * read-only.
 */

import { Stack } from 'expo-router';
import { z } from 'zod';

import { paymentLog } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import type { ButtonHandlerButton } from '@/shared/ui/composed/ButtonHandler';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';

import { CustomReceiveScreen } from './CustomReceiveScreen';
import { LightningReceiveScreen } from './LightningReceiveScreen';
import { OnchainReceiveScreen } from './OnchainReceiveScreen';
import { mintQuoteScreenTitle, useMintQuoteScreen } from './useMintQuoteScreen';

const ParamsSchema = z.object({
  mintHistoryEntry: z.string().min(1).max(64_000),
  unit: z.string().max(16).optional(),
});

/** Which mint-quote screen this route renders. */
type Rail = 'lightning' | 'onchain' | 'custom';

/**
 * Navigation titles.
 *
 * The two built-in rails keep their exact existing strings — they are pinned
 * by the route layouts and by e2e canonical-page screenshots. Only the custom
 * rail derives its title, since its method is not known until the entry is
 * decoded.
 */
const RAIL_TITLES: Record<Exclude<Rail, 'custom'>, string> = {
  lightning: 'Receive Lightning',
  onchain: 'Receive onchain',
};

const RAIL_LOG_SCOPES: Record<Rail, string> = {
  lightning: 'receive.lightning',
  onchain: 'receive.onchain',
  custom: 'receive.custom',
};

interface MintQuoteReceiveRouteProps {
  /** Log scope for invalid-params telemetry; e.g. `'receive-flow.lightningReceive'`. */
  where: string;
  extraButtons?: ButtonHandlerButton[];
  onRequestMintList?: () => void;
}

interface RailRouteProps extends MintQuoteReceiveRouteProps {
  rail: Rail;
}

function MintQuoteReceiveRoute({
  rail,
  where,
  extraButtons = [],
  onRequestMintList,
}: RailRouteProps) {
  const params = useRouteParams(ParamsSchema, { where });
  if (!params) return null;
  paymentLog.info(`${RAIL_LOG_SCOPES[rail]}.route_ready`, {
    where,
    rail,
    mintHistoryEntryLength: params.mintHistoryEntry.length,
    unit: params.unit ?? null,
    extraButtonCount: extraButtons.length,
    hasMintListCallback: !!onRequestMintList,
  });

  return (
    <MintQuoteReceiveRouteContent
      // A new quote is a new screen: remounting drops any rail state (mempool
      // polling, timeline) that belonged to the previous one.
      key={params.mintHistoryEntry}
      rail={rail}
      mintHistoryEntry={params.mintHistoryEntry}
      extraButtons={extraButtons}
      onRequestMintList={onRequestMintList}
    />
  );
}

function MintQuoteReceiveRouteContent({
  rail,
  mintHistoryEntry,
  extraButtons,
  onRequestMintList,
}: {
  rail: Rail;
  mintHistoryEntry: string;
  extraButtons: ButtonHandlerButton[];
  onRequestMintList?: () => void;
}) {
  const resolved = useMintQuoteScreen(mintHistoryEntry, RAIL_LOG_SCOPES[rail]);
  const { entry, actions, error, method } = resolved;

  if (error) {
    return (
      <ScreenErrorState
        message={error}
        onGoBack={() => {
          void actions.back.execute();
        }}
      />
    );
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const screenProps = {
    entry,
    actions,
    source: resolved.source,
    mintUrl: resolved.mintUrl,
    mintInfo: resolved.mintInfo,
    extraButtons,
    onRequestMintList,
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: rail === 'custom' ? mintQuoteScreenTitle(method) : RAIL_TITLES[rail],
        }}
      />
      {rail === 'lightning' && <LightningReceiveScreen {...screenProps} />}
      {rail === 'onchain' && <OnchainReceiveScreen {...screenProps} />}
      {rail === 'custom' && <CustomReceiveScreen {...screenProps} method={method} />}
    </>
  );
}

/** Lightning (BOLT11) mint-quote route. Always renders the Lightning screen. */
export function LightningReceiveRoute(props: MintQuoteReceiveRouteProps) {
  return <MintQuoteReceiveRoute rail="lightning" {...props} />;
}

/** Onchain (NUT-30) mint-quote route. Always renders the onchain screen. */
export function OnchainReceiveRoute(props: MintQuoteReceiveRouteProps) {
  return <MintQuoteReceiveRoute rail="onchain" {...props} />;
}

/**
 * Mint-quote route for a NUT-04 method with no NUT of its own (venmo, paypal,
 * a bank rail). The method comes from the entry, so one route serves them all.
 */
export function CustomReceiveRoute(props: MintQuoteReceiveRouteProps) {
  return <MintQuoteReceiveRoute rail="custom" {...props} />;
}

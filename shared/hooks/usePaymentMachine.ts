/**
 * Unified payment machine hook.
 *
 * Supersedes: useSendMachine, useNfcPayment, useProcessPaymentString,
 * useSendWithHistory (for scan flows), useMintQuoteMachine.
 *
 * Handles all payment directions:
 * - Ecash send (online + offline)
 * - Lightning melt (send via LN invoice / LNURL)
 * - Receive Lightning (mintQuote — creates invoice, waits for payment)
 * - QR/paste/deeplink scanning → routing terminal states → navigation
 * - NFC tap-to-pay (imperative path via NfcPayment.performPayment)
 * - Multi-part UR code scanning
 *
 * Navigation and outcome callbacks are provided to the machine via .provide()
 * so the machine itself drives side effects — no useEffect bridges needed.
 */

import { Alert } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { router } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';

import { useMachine } from '@xstate/react';
import { fromCallback, fromPromise } from 'xstate';

import { decodePaymentRequest } from '@cashu/cashu-ts';
import { getEncodedTokenV4 } from '@cashu/cashu-ts';
import { URDecoder } from '@gandlaf21/bc-ur';
import type { Manager, MintHistoryEntry, SendHistoryEntry } from 'coco-cashu-core';
import { useBalanceContext, useManager, useMints } from 'coco-cashu-react';

import type {
  ExactOfflineAmountIndex,
  OfflineFiatSendSuggestions,
  OfflineSendSuggestions,
} from '@/features/send/lib/offlineSendSuggestions';
import { PAYMENT_TIERS } from '@/features/wallet/lib/walletHeader';
import { buildReceiveHistoryEntry } from '@/shared/lib/cashu/utils';
import { captureAndStoreLocation } from '@/shared/hooks/useTransactionLocation';
import { useNostrDirectMessage } from '@/shared/hooks/useNostrDirectMessage';
import { NfcPayment, NfcError } from '@/shared/lib/nfc';
import { getNfcErrorMessage } from '@/shared/lib/nfc/messages';
import type { NfcErrorMessage } from '@/shared/lib/nfc/messages';
import { executePaymentRequestSend } from '@/shared/lib/payment-machines/actors';
import { paymentMachine } from '@/shared/lib/payment-machines/paymentMachine';
import { createMachineInspector } from '@/shared/lib/payment-machines/inspect';
import type { SendBranch, SendSource } from '@/shared/lib/payment-machines/sendMachine.types';
import type { PaymentError } from '@/shared/lib/payment-machines/types';
import { nfcErrorPopup, offlineSendSuggestionsPopup } from '@/shared/lib/popup';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';

const inspect = createMachineInspector('payment');

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface UsePaymentMachineInput {
  // Machine initialization — mirrors UseSendMachineInput
  sendBranch?: SendBranch;
  source?: SendSource;
  mintUrl?: string | null;
  amount?: number;
  mintBalance?: number;
  isOffline?: boolean;
  unit?: string;
  scanRaw?: string | null;
  btcPrice?: number | null;
  offlineSendability?: ExactOfflineAmountIndex | null;
  lnUrlOrAddress?: string | null;
  invoice?: string | null;
  maxAmountSats?: number;
  receiveAmount?: number;

  // NFC tap-to-pay fields (optional — enable NFC payment support)
  availableMints?: Record<string, number>;
  preferredMint?: string;
  usdToSats?: (usd: number) => number | undefined;
  pubkey?: string;
  getSelectedMint?: (pubkey: string) => string | undefined;

  /**
   * Called when the machine enters a routing terminal state that requires
   * navigation. Defaults to expo-router's router.navigate() / router.replace().
   * Override to supply custom navigation (e.g. in tests or embedded flows).
   */
  onNavigate?: (route: string, params?: Record<string, string>) => void;

  // ---------------------------------------------------------------------------
  // Outcome callbacks — provide these instead of writing bridge useEffect hooks
  // in screens. The hook observes machine terminal states and calls these once.
  // ---------------------------------------------------------------------------

  /** Called when an ecash send completes successfully. Token is the encoded ecash string. */
  onSuccess?: (entry: SendHistoryEntry, token?: string | null) => void;
  /** Called when a Lightning invoice is ready and waiting for payment. */
  onMintQuoteReady?: (entry: MintHistoryEntry) => void;
  /** Called when the user cancels the payment flow. */
  onCancelled?: () => void;
  /** Called when the machine enters an unrecoverable error state. */
  onError?: (error: PaymentError | null) => void;
  /**
   * Called when no mint is selected (machine enters `noMint` terminal state).
   * The popup is fired automatically by the machine — use this to clear any
   * loading/spinner state in the screen.
   */
  onNoMint?: () => void;
  /** Called when the wallet has insufficient balance for the requested amount. */
  onInsufficientBalance?: (amount: number, unit: string) => void;
  /** Called when a NUT-18 payment request send completes (ecash sent + Nostr DM delivered). */
  onPaymentRequestSent?: (entry: SendHistoryEntry) => void;

  // ---------------------------------------------------------------------------
  // Payment request (NUT-18) fields
  // ---------------------------------------------------------------------------

  /** Raw encoded NUT-18 payment request string (`creqA...`) for paymentRequest send branch. */
  encodedPaymentRequest?: string | null;

  // ---------------------------------------------------------------------------
  // Ecash receive fields
  // ---------------------------------------------------------------------------

  /** Set to `'ecashReceive'` to enter the token redemption branch. */
  receiveBranch?: 'ecashReceive';
  /** Encoded token string to redeem (required when receiveBranch === 'ecashReceive'). */
  tokenString?: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePaymentMachine(input: UsePaymentMachineInput = {}) {
  // UR decoder for multi-part QR codes (managed locally, not in machine state)
  const [urDecoder, setUrDecoder] = useState(() => new URDecoder());

  // NFC imperative state (folded in from useNfcPayment)
  const [nfcStatus, setNfcStatus] = useState<'idle' | 'paying' | 'error'>('idle');
  const [nfcError, setNfcError] = useState<NfcErrorMessage | null>(null);
  const availableMintsRef = useRef<Record<string, number>>(input.availableMints ?? {});

  // Self-contained: source manager and DM sender internally
  const manager = useManager();
  const { sendDirectMessage } = useNostrDirectMessage();

  // Coco hooks for payment request routing
  const { trustedMints } = useMints();
  const { balance: mintBalances } = useBalanceContext();

  // Scan history
  const addScan = useScanHistoryStore((state) => state.addScan);
  const linkTransaction = useScanHistoryStore((state) => state.linkTransaction);

  // Camera permissions (provided to machine)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // Keep availableMints ref in sync
  useEffect(() => {
    availableMintsRef.current = input.availableMints ?? {};
  }, [input.availableMints]);

  // ---------------------------------------------------------------------------
  // Stable refs for callbacks — kept in sync so provide() closures never stale.
  // ---------------------------------------------------------------------------

  const onSuccessRef = useRef(input.onSuccess);
  const onMintQuoteReadyRef = useRef(input.onMintQuoteReady);
  const onCancelledRef = useRef(input.onCancelled);
  const onErrorRef = useRef(input.onError);
  const onInsufficientBalanceRef = useRef(input.onInsufficientBalance);
  const onNoMintRef = useRef(input.onNoMint);
  const onPaymentRequestSentRef = useRef(input.onPaymentRequestSent);
  const sendNostrDmRef = useRef(sendDirectMessage);
  const onNavigateRef = useRef(input.onNavigate);

  useEffect(() => {
    onSuccessRef.current = input.onSuccess;
    onMintQuoteReadyRef.current = input.onMintQuoteReady;
    onCancelledRef.current = input.onCancelled;
    onErrorRef.current = input.onError;
    onInsufficientBalanceRef.current = input.onInsufficientBalance;
    onNoMintRef.current = input.onNoMint;
    onPaymentRequestSentRef.current = input.onPaymentRequestSent;
    sendNostrDmRef.current = sendDirectMessage;
    onNavigateRef.current = input.onNavigate;
  });

  // Stable refs for trustedMints / mintBalances (used in payment request routing action)
  const trustedMintsRef = useRef(trustedMints);
  const mintBalancesRef = useRef(mintBalances);
  useEffect(() => {
    trustedMintsRef.current = trustedMints;
    mintBalancesRef.current = mintBalances;
  });

  // ---------------------------------------------------------------------------
  // Navigation helpers (closed over refs so they're stable)
  // ---------------------------------------------------------------------------

  const navigateImpl = useCallback(
    (route: string, params?: Record<string, string>) => {
      if (onNavigateRef.current) {
        onNavigateRef.current(route, params);
        return;
      }
      router.navigate({ pathname: route as any, params });
    },
    []
  );

  const replaceImpl = useCallback(
    (route: string, params?: Record<string, string>) => {
      if (onNavigateRef.current) {
        onNavigateRef.current(route, params);
        return;
      }
      router.replace({ pathname: route as any, params });
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Machine — provide actors and actions, including navigation + callbacks
  // ---------------------------------------------------------------------------

  const cameraPermissionActor = useMemo(
    () =>
      fromPromise(async (): Promise<{ status: 'granted' | 'denied' }> => {
        if (cameraPermission?.granted) return { status: 'granted' };
        const result = await requestCameraPermission();
        return { status: result.granted ? 'granted' : 'denied' };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const sendPaymentRequestActorImpl = useMemo(
    () =>
      fromPromise(
        async ({
          input: actorInput,
        }: {
          input: {
            mintUrl: string;
            amount: number;
            manager: Manager;
            encodedPaymentRequest: string;
            unit: string;
          };
        }) => {
          const sendDm = sendNostrDmRef.current;
          if (!sendDm) throw new Error('sendNostrDm not provided to usePaymentMachine');
          return executePaymentRequestSend({ ...actorInput, sendNostrDm: sendDm });
        }
      ),
    []
  );

  const showOfflineSuggestionsPopupActor = useMemo(
    () =>
      fromCallback<
        { type: 'SELECT_AMOUNT'; amount: number } | { type: 'CANCEL' },
        {
          requestedAmount: number;
          suggestions: OfflineSendSuggestions | OfflineFiatSendSuggestions | null;
          unit: string;
        }
      >(({ input: popupInput, sendBack }) => {
        const suggestions = popupInput.suggestions as OfflineSendSuggestions | null;
        if (!suggestions) return;
        offlineSendSuggestionsPopup({
          requestedAmount: popupInput.requestedAmount,
          roundDownAmount: suggestions.roundDownAmount ?? null,
          roundUpAmount: suggestions.roundUpAmount ?? null,
          unit: popupInput.unit || 'sat',
          onSelectAmount: (amount: number) => sendBack({ type: 'SELECT_AMOUNT', amount }),
        });
      }),
    []
  );

  const listenForMintQuotePaymentActor = useMemo(
    () =>
      fromCallback<
        { type: 'PAYMENT_RECEIVED' },
        { manager: Manager | null; mintQuoteId: string | null }
      >(({ input: listenerInput, sendBack }) => {
        if (!listenerInput.manager || !listenerInput.mintQuoteId) return;
        const off = listenerInput.manager.on(
          'mint-quote:state-changed',
          ({
            quoteId,
            state: quoteState,
          }: {
            mintUrl: string;
            quoteId: string;
            state: string;
          }) => {
            if (quoteState !== 'PAID') return;
            if (quoteId !== listenerInput.mintQuoteId) return;
            sendBack({ type: 'PAYMENT_RECEIVED' });
          }
        );
        return () => {
          off();
        };
      }),
    []
  );

  const providedMachine = useMemo(
    () =>
      paymentMachine.provide({
        actors: {
          requestCameraPermission: cameraPermissionActor,
          sendPaymentRequest: sendPaymentRequestActorImpl,
          showOfflineSuggestionsPopup: showOfflineSuggestionsPopupActor,
          listenForMintQuotePayment: listenForMintQuotePaymentActor,
        },
        actions: {
          // --- Navigation actions ---
          navigateToReceiveToken: ({ context }) => {
            const data = context.parsedResult?.data;
            if (!data) return;
            navigateImpl('/(receive-flow)/receiveToken', {
              receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(data)),
            });
          },
          navigateToLightning: ({ context }) => {
            const parsed = context.parsedResult;
            if (!parsed) return;
            if (parsed.type === 'lightningInvoice') {
              navigateImpl('/(send-flow)/meltQuote', { invoice: parsed.data });
            } else {
              navigateImpl('/(send-flow)/currency', {
                to: 'meltQuote',
                lnUrlOrAddress: parsed.data,
                unit: context.unit,
              });
            }
          },
          navigateToMintUrl: ({ context }) => {
            const data = context.parsedResult?.data;
            if (!data) return;
            navigateImpl('/(mint-flow)/info', { mintUrl: data, fromScan: '1' });
          },
          navigateToNpub: ({ context }) => {
            const data = context.parsedResult?.data;
            if (!data) return;
            navigateImpl('/(user-flow)/profile', { npub: data });
          },
          navigateToPaymentRequest: ({ context }) => {
            const rawRequest = context.parsedResult?.data;
            if (!rawRequest) return;
            try {
              const decoded = decodePaymentRequest(rawRequest.trim());
              const hasMints = !!(decoded.mints && decoded.mints.length > 0);
              const hasAmount = decoded.amount !== undefined && decoded.amount > 0;
              const allowedMints = hasMints ? decoded.mints : undefined;
              const minAmount = hasAmount ? decoded.amount : undefined;
              const currentTrustedMints = trustedMintsRef.current;
              const currentMintBalances = mintBalancesRef.current as Record<string, number>;
              const validMints = currentTrustedMints.filter((mint) => {
                const balance = currentMintBalances[mint.mintUrl] || 0;
                if (allowedMints?.length && !allowedMints.includes(mint.mintUrl)) return false;
                if (minAmount && balance < minAmount) return false;
                return balance > 0;
              });
              const singleValidMint = validMints.length === 1 ? validMints[0] : null;

              if (!hasMints && !hasAmount) {
                replaceImpl('/(send-flow)/currency', {
                  to: 'paymentRequest',
                  paymentRequest: rawRequest,
                  unit: decoded.unit || 'sat',
                });
              } else if (!hasMints && hasAmount) {
                if (singleValidMint) {
                  navigateImpl('/(send-flow)/sendToken', {
                    paymentRequest: rawRequest,
                    amount: String(decoded.amount),
                    selectedMintUrl: singleValidMint.mintUrl,
                  });
                } else {
                  navigateImpl('/(send-flow)/mintSelect', {
                    to: 'paymentRequest',
                    paymentRequest: rawRequest,
                    minAmount: String(decoded.amount),
                    unit: decoded.unit || 'sat',
                  });
                }
              } else if (hasMints && !hasAmount) {
                const bestValidMint =
                  validMints.length > 0
                    ? validMints.reduce((best, m) =>
                        (currentMintBalances[m.mintUrl] || 0) >
                        (currentMintBalances[best.mintUrl] || 0)
                          ? m
                          : best
                      )
                    : null;
                replaceImpl('/(send-flow)/currency', {
                  to: 'paymentRequest',
                  paymentRequest: rawRequest,
                  allowedMints: JSON.stringify(decoded.mints),
                  unit: decoded.unit || 'sat',
                  ...(bestValidMint ? { selectedMintUrl: bestValidMint.mintUrl } : {}),
                });
              } else {
                if (singleValidMint) {
                  navigateImpl('/(send-flow)/sendToken', {
                    paymentRequest: rawRequest,
                    amount: String(decoded.amount),
                    selectedMintUrl: singleValidMint.mintUrl,
                  });
                } else {
                  navigateImpl('/(send-flow)/mintSelect', {
                    to: 'paymentRequest',
                    paymentRequest: rawRequest,
                    allowedMints: JSON.stringify(decoded.mints),
                    minAmount: String(decoded.amount),
                    unit: decoded.unit || 'sat',
                  });
                }
              }
            } catch {
              // Silently ignore malformed payment requests
            }
          },
          navigateToLightningRedirect: ({ context }) => {
            const invoice = context.rawData;
            if (!invoice) return;
            navigateImpl('/(send-flow)/meltQuote', { invoice });
          },

          // --- Outcome callback actions ---
          onSuccessCallback: ({ context }) => {
            const entry = context.historyEntry as SendHistoryEntry | null;
            if (entry) onSuccessRef.current?.(entry, context.token);
          },
          onMintQuoteReadyCallback: ({ context }) => {
            const entry = context.mintHistoryEntry as MintHistoryEntry | null;
            if (entry) onMintQuoteReadyRef.current?.(entry);
          },
          onCancelledCallback: () => {
            onCancelledRef.current?.();
          },
          onErrorCallback: ({ context }) => {
            onErrorRef.current?.(context.error as PaymentError | null);
          },
          onNoMintCallback: () => {
            onNoMintRef.current?.();
          },
          onInsufficientBalanceCallback: ({ context }) => {
            onInsufficientBalanceRef.current?.(context.amount, context.unit);
          },
          onPaymentRequestSentCallback: ({ context }) => {
            const entry = context.historyEntry as SendHistoryEntry | null;
            if (entry) onPaymentRequestSentRef.current?.(entry);
          },
        },
      }),
    [
      cameraPermissionActor,
      sendPaymentRequestActorImpl,
      showOfflineSuggestionsPopupActor,
      listenForMintQuotePaymentActor,
      navigateImpl,
      replaceImpl,
    ]
  );

  const [state, machineSend] = useMachine(providedMachine, {
    input: {
      source: input.source,
      sendBranch: input.sendBranch,
      receiveBranch: input.receiveBranch,
      mintUrl: input.mintUrl,
      amount: input.amount ?? input.receiveAmount,
      mintBalance: input.mintBalance,
      isOffline: input.isOffline,
      manager,
      unit: input.unit,
      scanRaw: input.scanRaw,
      btcPrice: input.btcPrice,
      offlineSendability: input.offlineSendability,
      lnUrlOrAddress: input.lnUrlOrAddress,
      invoice: input.invoice,
      maxAmountSats: input.maxAmountSats,
      encodedPaymentRequest: input.encodedPaymentRequest,
      tokenString: input.tokenString,
    },
    inspect,
  });

  // ---------------------------------------------------------------------------
  // Auto-sync mutable props into machine context
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (input.mintUrl && input.mintBalance !== undefined) {
      machineSend({ type: 'SET_MINT', mintUrl: input.mintUrl, mintBalance: input.mintBalance });
    }
  }, [input.mintUrl, input.mintBalance, machineSend]);

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Scan a payment string from any source.
   * Handles UR codes locally (returning progress) and delegates everything
   * else to the machine. Compatible with CameraScreen's onScan signature.
   */
  const scan = useCallback(
    async (
      data: string,
      source: 'qr' | 'paste' | 'deeplink'
    ): Promise<{ urInProgress: boolean; progress?: number }> => {
      if (data.toLowerCase().startsWith('ur:')) {
        if (urDecoder.isComplete() && urDecoder.isSuccess()) {
          return { urInProgress: false };
        }

        urDecoder.receivePart(data);
        const progress = urDecoder.getProgress();

        if (urDecoder.isComplete() && urDecoder.isSuccess()) {
          const ur = urDecoder.resultUR();
          const decoded = ur.decodeCBOR();
          const tokenString = new TextDecoder().decode(decoded as Uint8Array);

          addScan(data, tokenString, 'ecash', source);
          machineSend({ type: 'SCAN', data: tokenString, source });
          setUrDecoder(new URDecoder());
          return { urInProgress: false };
        }

        return { urInProgress: true, progress };
      }

      machineSend({ type: 'SCAN', data, source });
      return { urInProgress: false };
    },
    [urDecoder, machineSend, addScan]
  );

  const resetUrDecoder = useCallback(() => {
    setUrDecoder(new URDecoder());
  }, []);

  const startNfc = useCallback(
    (maxAmountSats?: number) => machineSend({ type: 'START_NFC', maxAmountSats }),
    [machineSend]
  );

  const next = useCallback(() => machineSend({ type: 'NEXT' }), [machineSend]);

  const setAmount = useCallback(
    (amount: number) => machineSend({ type: 'SET_AMOUNT', amount }),
    [machineSend]
  );

  const setMint = useCallback(
    (mintUrl: string, mintBalance: number) =>
      machineSend({ type: 'SET_MINT', mintUrl, mintBalance }),
    [machineSend]
  );

  const setManager = useCallback(
    (manager: Manager) => machineSend({ type: 'SET_MANAGER', manager }),
    [machineSend]
  );

  const selectAmount = useCallback(
    (amount: number) => machineSend({ type: 'SELECT_AMOUNT', amount }),
    [machineSend]
  );

  const setPaymentRequest = useCallback(
    (encodedPaymentRequest: string) =>
      machineSend({ type: 'SET_PAYMENT_REQUEST', encodedPaymentRequest }),
    [machineSend]
  );

  const execute = useCallback(() => machineSend({ type: 'EXECUTE' }), [machineSend]);

  const changeMint = useCallback(
    (mintUrl: string, mintBalance: number) =>
      machineSend({ type: 'CHANGE_MINT', mintUrl, mintBalance }),
    [machineSend]
  );

  const finalized = useCallback(
    (historyEntry: SendHistoryEntry) => machineSend({ type: 'FINALIZED', historyEntry }),
    [machineSend]
  );

  const cancel = useCallback(() => machineSend({ type: 'CANCEL' }), [machineSend]);
  const reset = useCallback(() => machineSend({ type: 'RESET' }), [machineSend]);
  const redeem = useCallback(() => machineSend({ type: 'REDEEM' }), [machineSend]);

  const urProgress = useCallback(
    (progress: number) => machineSend({ type: 'UR_PROGRESS', progress }),
    [machineSend]
  );

  const urComplete = useCallback(
    (data: string) => machineSend({ type: 'UR_COMPLETE', data }),
    [machineSend]
  );

  // mintQuote commands
  const requestInvoice = useCallback(() => machineSend({ type: 'REQUEST_INVOICE' }), [machineSend]);

  const setReceiveAmount = useCallback(
    (amount: number) => machineSend({ type: 'SET_RECEIVE_AMOUNT', amount }),
    [machineSend]
  );

  const paymentReceived = useCallback(
    () => machineSend({ type: 'PAYMENT_RECEIVED' }),
    [machineSend]
  );

  const quoteExpired = useCallback(() => machineSend({ type: 'QUOTE_EXPIRED' }), [machineSend]);

  // ---------------------------------------------------------------------------
  // NFC imperative payment (folded in from useNfcPayment)
  // ---------------------------------------------------------------------------

  const startNfcPayment = useCallback(
    async (usdLimit?: number) => {
      if (!manager) {
        setNfcError({ title: 'Error', message: 'Wallet not ready. Please try again.' });
        setNfcStatus('error');
        return;
      }

      const maxAmountSats = usdLimit !== undefined ? input.usdToSats?.(usdLimit) : undefined;

      const mintToUse =
        (input.pubkey ? input.getSelectedMint?.(input.pubkey) : undefined) || input.preferredMint;

      let lastOperationId: string | null = null;
      let lastScannedRaw: string | null = null;

      const rollbackPendingSend = async () => {
        if (!lastOperationId) return;
        try {
          const operation = await manager.send.getOperation(lastOperationId);
          if (operation && ['prepared', 'executing', 'pending'].includes(operation.state)) {
            await manager.send.rollback(lastOperationId);
          }
        } catch {
          // Rollback best-effort
        }
      };

      setNfcError(null);
      setNfcStatus('paying');

      try {
        await NfcPayment.performPayment({
          createToken: async (mintUrl, amount) => {
            const prepared = await manager.send.prepareSend(mintUrl, amount);
            const { token } = await manager.send.executePreparedSend(prepared.id);
            lastOperationId = prepared.id;

            const history = await manager.history.getPaginatedHistory();
            const entry = history.find(
              (h) => h.type === 'send' && (h as SendHistoryEntry).operationId === prepared.id
            ) as SendHistoryEntry | undefined;
            if (entry?.id) await captureAndStoreLocation(entry.id);

            if (lastScannedRaw && entry?.id) {
              linkTransaction(lastScannedRaw, entry.id);
              lastScannedRaw = null;
            }

            return getEncodedTokenV4(token);
          },
          recoverToken: rollbackPendingSend,
          getAvailableMints: () => availableMintsRef.current,
          preferredMint: mintToUse,
          maxAmountSats,
          onScanRead: (raw) => {
            addScan(raw, raw, 'ecash', 'nfc');
            lastScannedRaw = raw;
          },
          onLightningInvoice: (invoice, amount) => {
            addScan(invoice, invoice, 'lightning', 'nfc');
            if (amount) {
              router.navigate({
                pathname: '/(send-flow)/mintSelect' as any,
                params: {
                  to: 'meltQuote',
                  unit: 'sat',
                  minAmount: String(amount),
                  invoice,
                },
              });
            } else {
              router.navigate({
                pathname: '/(send-flow)/currency' as any,
                params: { to: 'meltQuote', lnUrlOrAddress: invoice, unit: 'sat' },
              });
            }
          },
        });

        setNfcStatus('idle');
      } catch (err) {
        const isNfcError = err instanceof NfcError;
        const code = isNfcError ? err.code : 'PAYMENT_FAILED';
        const errorMessage = err instanceof Error ? err.message : String(err);

        if (code === 'TAG_LOST' || code === 'TRANSCEIVE_FAILED' || !isNfcError) {
          await rollbackPendingSend();
        }

        const resolved = getNfcErrorMessage(code, errorMessage, { maxAmountSats });
        setNfcError(resolved);
        setNfcStatus('error');
        nfcErrorPopup({ title: resolved.title, message: resolved.message });
      }
    },
    [
      manager,
      input.preferredMint,
      input.usdToSats,
      input.getSelectedMint,
      input.pubkey,
      addScan,
      linkTransaction,
    ]
  );

  const handleNfcPaymentAlert = useCallback(() => {
    Alert.alert('NFC Payment Limit', 'Select your payment limit', [
      ...PAYMENT_TIERS.map((tier) => ({
        text: tier.label,
        onPress: () => startNfcPayment(tier.usdLimit),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [startNfcPayment]);

  const resetNfcError = useCallback(() => {
    setNfcError(null);
    if (nfcStatus === 'error') setNfcStatus('idle');
  }, [nfcStatus]);

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return useMemo(
    () => ({
      // Raw state
      state: state.value,
      context: state.context,

      // Phase flags
      isIdle: state.matches('idle'),
      isInputting: state.matches('input'),

      // Setup flags
      isSettingUp: state.matches('setup'),
      isSelectingMint: state.matches({ setup: 'selectingMint' }),
      isCheckingOffline: state.matches({ setup: 'checkingOffline' }),
      isOfflineSuggestions: state.matches({ setup: 'offlineSuggestions' }),
      isCheckingFiatOffline: state.matches({ setup: 'checkingFiatOffline' }),

      // Ecash send flags
      isSending:
        state.matches({ ecashSend: 'sending' }) ||
        state.matches({ ecashSend: 'capturingLocation' }),
      isRollingBack:
        state.matches({ ecashSend: 'rollingBack' }) || state.matches({ nfcWrite: 'rollingBack' }),
      isOfflineFallbackSuggestions: state.matches({ ecashSend: 'offlineFallbackSuggestions' }),

      // Melt send flags
      isValidating: state.matches({ meltSend: 'validating' }),
      isResolvingLnUrl: state.matches({ meltSend: 'resolvingLnUrl' }),
      isPreparingQuote: state.matches({ meltSend: 'preparingQuote' }),
      isQuoteReady: state.matches({ meltSend: 'quoteReady' }),
      isExecuting: state.matches({ meltSend: 'executing' }),
      isCancelling: state.matches({ meltSend: 'cancelling' }),

      // NFC machine flags
      isReadingNfc: state.matches({ input: 'readingNfc' }),
      isDecodingNfc: state.matches({ input: 'decodingNfcRequest' }),
      isWritingNfc: state.matches({ nfcWrite: 'writingToken' }),
      isWaitingFinalization: state.matches({ nfcWrite: 'waitingFinalization' }),
      isPaying:
        state.matches('input') ||
        state.matches('setup') ||
        state.matches('ecashSend') ||
        state.matches('nfcWrite'),

      // mintQuote (receive Lightning) flags
      isMintQuote: state.matches('mintQuote'),
      isRequestingInvoice: state.matches({ mintQuote: 'requestingInvoice' }),
      isCapturingLocation: state.matches({ mintQuote: 'capturingLocation' }),
      isInvoiceReady: state.matches({ mintQuote: 'invoiceReady' }),
      isMintQuoteRedeeming: state.matches({ mintQuote: 'redeeming' }),
      mintQuoteData: state.context.mintQuoteData,
      mintHistoryEntry: state.context.mintHistoryEntry as MintHistoryEntry | null,

      // Terminal flags
      isSuccess: state.matches('success'),
      isCancelled: state.matches('cancelled'),
      isExpired: state.matches('expired'),
      isError: state.matches('error'),
      isNoMint: state.matches('noMint'),
      isInsufficientBalance: state.matches('insufficientBalance'),
      isLightningRedirect: state.matches('lightningRedirect'),
      isPaymentRequestSending: state.matches('paymentRequestSending'),
      isPaymentRequestSent: state.matches('paymentRequestSent'),
      isPermissionDenied: state.matches('permissionDenied'),

      // Ecash receive flags
      isReceiveIdle: state.matches({ ecashReceive: 'idle' }),
      isRedeeming: state.matches({ ecashReceive: 'redeeming' }),
      isReceiveCapturingLocation: state.matches({ ecashReceive: 'capturingLocation' }),
      isReceiveRotatingKey: state.matches({ ecashReceive: 'rotatingKey' }),
      isReceiveSuccess: state.matches('receiveSuccess'),
      isAlreadySpent: state.matches('alreadySpent') || (state.context.isAlreadySpent ?? false),
      isReceiveError: state.matches('receiveError'),
      receiveHistoryEntry: state.context.receiveHistoryEntry,

      // Routing terminals (React does navigation)
      isRouteEcashReceive: state.matches('routeEcashReceive'),
      isRoutePaymentRequest: state.matches('routePaymentRequest'),
      isRouteLightning: state.matches('routeLightning'),
      isRouteMintUrl: state.matches('routeMintUrl'),
      isRouteNpub: state.matches('routeNpub'),
      isRouteUR: state.matches('routeUR'),

      // Context accessors
      error: state.context.error,
      token: state.context.token,
      historyEntry: state.context.historyEntry,
      operationId: state.context.operationId,
      offlineSuggestions: state.context.offlineSuggestions as
        | OfflineSendSuggestions
        | OfflineFiatSendSuggestions
        | null,
      quote: state.context.quote,
      meltHistoryEntry: state.context.meltHistoryEntry,
      meltOperationId: state.context.meltOperationId,
      invoice: state.context.invoice,
      parsedResult: state.context.parsedResult,
      sendBranch: state.context.sendBranch,
      rawData: state.context.rawData,
      urProgressValue: state.context.urProgress,
      source: state.context.source,
      cameraPermission: state.context.cameraPermission,

      // NFC imperative state (from useNfcPayment)
      nfcStatus,
      nfcError,
      isNfcIdle: nfcStatus === 'idle',
      isNfcPaying: nfcStatus === 'paying',
      isNfcError: nfcStatus === 'error',
      resetNfcError,
      startNfcPayment,
      handleNfcPaymentAlert,

      // Commands (machine events)
      scan,
      resetUrDecoder,
      startNfc,
      next,
      setAmount,
      setMint,
      setManager,
      setPaymentRequest,
      selectAmount,
      execute,
      changeMint,
      finalized,
      cancel,
      reset,
      redeem,
      urProgress,
      urComplete,

      // mintQuote commands
      requestInvoice,
      setReceiveAmount,
      paymentReceived,
      quoteExpired,
    }),
    [
      state,
      nfcStatus,
      nfcError,
      resetNfcError,
      startNfcPayment,
      handleNfcPaymentAlert,
      scan,
      resetUrDecoder,
      startNfc,
      next,
      setAmount,
      setMint,
      setManager,
      setPaymentRequest,
      selectAmount,
      execute,
      changeMint,
      finalized,
      cancel,
      reset,
      redeem,
      urProgress,
      urComplete,
      requestInvoice,
      setReceiveAmount,
      paymentReceived,
      quoteExpired,
    ]
  );
}

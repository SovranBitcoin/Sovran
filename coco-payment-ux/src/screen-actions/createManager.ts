// ---------------------------------------------------------------------------
// Screen Actions — stateful runtime (mirrors createPaymentMachine pattern)
//
// When `amountConfig` is provided (amountEntry screens), an internal
// AmountActionManager handles `setInput`/`toggle` synchronously and merges
// the AmountResolution into getEntry(). All other actions delegate to the
// wallet-provided handlers.
//
// Also exports entry lifecycle utilities (matching, merging, decoration,
// melt-operation mapping) used as built-in defaults by useScreenActions.
// ---------------------------------------------------------------------------

import { getEncodedTokenV4 } from '@cashu/cashu-ts';

import { createAmountActionManager } from '../amount-actions/createManager';
import type { AmountResolution, CreateAmountActionManagerConfig } from '../amount-actions/types';
import { defaultDetectors } from '../detectors';
import { FormattedString } from '../formatting/FormattedString';
import { FormattedTimestamp } from '../formatting/FormattedTimestamp';
import type { PaymentRequestInfo } from '../types';
import { getAvailableActions } from './availability';
import type {
  ActionState,
  ScreenActionContext,
  ScreenActionHandlerMap,
  ScreenActionManager,
  ScreenActionName,
  ScreenType,
} from './types';

interface CreateScreenActionManagerConfig<S extends ScreenType> {
  screenType: S;
  handlers: ScreenActionHandlerMap[S];
  getContext: () => ScreenActionContext;
  /** When provided (amountEntry screens), creates an internal AmountActionManager. */
  amountConfig?: CreateAmountActionManagerConfig;
}

export function createScreenActionManager<S extends ScreenType>(
  config: CreateScreenActionManagerConfig<S>
): ScreenActionManager<S> {
  const { screenType, handlers, getContext, amountConfig } = config;

  let entry: Record<string, unknown> | null = null;
  const loadingActions = new Set<string>();
  const listeners = new Set<() => void>();

  let cachedState: Record<ScreenActionName[S], ActionState> | null = null;

  const amountMgr = amountConfig ? createAmountActionManager(amountConfig) : null;

  function notify(): void {
    cachedState = null;
    for (const listener of listeners) {
      listener();
    }
  }

  if (amountMgr) {
    amountMgr.subscribe(() => notify());
  }

  function mergeAmountResolution(
    base: Record<string, unknown>,
    resolution: AmountResolution
  ): Record<string, unknown> {
    return {
      ...base,
      inputMode: resolution.inputMode,
      rawInput: resolution.rawInput,
      numericValue: resolution.numericValue,
      effectiveSatAmount: resolution.effectiveSatAmount,
      canSendOffline: resolution.canSendOffline,
      displayFiat: resolution.displayFiat,
      displaySats: resolution.displaySats,
      autoOptimized: resolution.autoOptimized,
      unit: resolution.unit,
      keyboardUnit: resolution.keyboardUnit,
      secondaryDisplay: resolution.secondaryDisplay,
      fiatSymbol: resolution.fiatSymbol,
      suggestions: resolution.suggestions,
    };
  }

  function getEffectiveEntry(): Record<string, unknown> | null {
    if (amountMgr && entry) {
      return mergeAmountResolution(entry, amountMgr.inspect());
    }
    return entry;
  }

  function buildState(): Record<ScreenActionName[S], ActionState> {
    const effectiveEntry = getEffectiveEntry();
    if (!effectiveEntry) {
      const empty = {} as Record<ScreenActionName[S], ActionState>;
      const defaultState: ActionState = { available: false, loading: false };
      const names = getActionNames(screenType);
      for (const name of names) {
        empty[name as ScreenActionName[S]] = defaultState;
      }
      return empty;
    }

    const availability = getAvailableActions(screenType, effectiveEntry);
    const result = {} as Record<ScreenActionName[S], ActionState>;

    for (const [name, avail] of Object.entries(availability) as [
      ScreenActionName[S],
      { available: boolean; reason?: string },
    ][]) {
      result[name] = {
        ...avail,
        loading: loadingActions.has(name as string),
      };
    }

    return result;
  }

  const execute = async (
    action: ScreenActionName[S],
    params?: Record<string, unknown>
  ): Promise<void> => {
    if (amountMgr) {
      if (action === 'setInput') {
        if (params?.mode === 'sat' || params?.mode === 'fiat') {
          amountMgr.setMode(params.mode);
        }
        const raw = typeof params?.input === 'string' ? params.input : '';
        amountMgr.setInput(raw);
        notify();
        return;
      }
      if (action === 'toggle') {
        amountMgr.toggle();
        notify();
        return;
      }
    }

    const handlerMap = handlers as
      | Record<string, ((ctx: ScreenActionContext) => void | Promise<void>) | undefined>
      | undefined;
    const handler = handlerMap?.[action as string];
    if (!handler) return;

    loadingActions.add(action as string);
    notify();

    try {
      const ctx = getContext();
      const effectiveEntry = getEffectiveEntry();
      if (effectiveEntry) {
        ctx.entry = effectiveEntry;
      }
      if (params) {
        Object.assign(ctx, params);
      }
      await handler(ctx);
    } finally {
      loadingActions.delete(action as string);
      notify();
    }
  };

  const getEntry = (): Record<string, unknown> | null => getEffectiveEntry();

  const setEntry = (newEntry: Record<string, unknown>): void => {
    entry = newEntry;
    notify();
  };

  const inspect = (): Record<ScreenActionName[S], ActionState> => {
    if (!cachedState) {
      cachedState = buildState();
    }
    return cachedState;
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { execute, getEntry, setEntry, inspect, subscribe };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTION_NAMES: Record<ScreenType, string[]> = {
  sendToken: ['copy', 'share', 'nfc', 'copyAsEmoji', 'checkStatus', 'cancel'],
  receiveToken: ['redeem'],
  mintQuote: ['copy', 'share'],
  meltQuote: ['pay', 'cancel'],
  paymentRequest: ['confirm', 'cancel'],
  receive: ['copy', 'paste', 'fixedAmount', 'scanQr', 'changeNpcMint'],
  amountEntry: ['setInput', 'toggle', 'next', 'paste', 'scanQr'],
};

function getActionNames(screenType: ScreenType): string[] {
  return ACTION_NAMES[screenType];
}

// ---------------------------------------------------------------------------
// Entry matching — Cashu-aware identity resolution
//
// Matches incoming history updates to the current screen entry by type-
// specific identifiers (operationId for send, quoteId for melt, token
// string for receive, etc.). Used as the built-in default for
// useScreenActions entry updates.
// ---------------------------------------------------------------------------

type EntryRecord = Record<string, unknown>;

function getStringField(entry: EntryRecord | null | undefined, key: string): string | undefined {
  const value = entry?.[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumberField(entry: EntryRecord | null | undefined, key: string): number | undefined {
  const value = entry?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getMetadata(entry: EntryRecord | null | undefined): EntryRecord | undefined {
  const metadata = entry?.metadata;
  return typeof metadata === 'object' && metadata !== null ? (metadata as EntryRecord) : undefined;
}

function getReceiveTokenString(entry: EntryRecord | null | undefined): string | undefined {
  const token = entry?.token;
  if (token) {
    try {
      return getEncodedTokenV4(token as Parameters<typeof getEncodedTokenV4>[0]);
    } catch {
      /* fall through */
    }
  }
  return getStringField(getMetadata(entry), 'rawToken');
}

export function shouldApplyEntryUpdate(
  currentEntry: EntryRecord | null,
  updatedEntry: EntryRecord
): boolean {
  if (!currentEntry) return false;

  const currentType = getStringField(currentEntry, 'type');
  const updatedType = getStringField(updatedEntry, 'type');
  if (!currentType || currentType !== updatedType) return false;

  const currentId = getStringField(currentEntry, 'id');
  const updatedId = getStringField(updatedEntry, 'id');
  if (currentId && updatedId && currentId === updatedId) return true;

  if (currentType === 'send') {
    const co =
      getStringField(currentEntry, 'operationId') ??
      getStringField(getMetadata(currentEntry), 'operationId');
    const uo =
      getStringField(updatedEntry, 'operationId') ??
      getStringField(getMetadata(updatedEntry), 'operationId');
    return !!co && co === uo;
  }

  if (currentType === 'melt') {
    const cq = getStringField(currentEntry, 'quoteId');
    const uq = getStringField(updatedEntry, 'quoteId');
    if (cq && uq && cq === uq) return true;

    const co =
      getStringField(getMetadata(currentEntry), 'operationId') ??
      getStringField(currentEntry, 'operationId') ??
      getStringField(currentEntry, 'id');
    const uo =
      getStringField(getMetadata(updatedEntry), 'operationId') ??
      getStringField(updatedEntry, 'operationId') ??
      getStringField(updatedEntry, 'id');
    return !!co && co === uo;
  }

  if (currentType === 'receive') {
    const ct = getReceiveTokenString(currentEntry);
    const ut = getReceiveTokenString(updatedEntry);
    if (ct && ut && ct === ut) return true;

    const isPreview = currentId?.startsWith('receive-') ?? false;
    if (!isPreview) return false;

    const cm = getStringField(currentEntry, 'mintUrl');
    const um = getStringField(updatedEntry, 'mintUrl');
    const ca = getNumberField(currentEntry, 'amount');
    const ua = getNumberField(updatedEntry, 'amount');
    return !!cm && cm === um && typeof ca === 'number' && ca === ua;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Entry merging — deep-merges metadata on update
// ---------------------------------------------------------------------------

export function mergeEntryUpdate(
  currentEntry: EntryRecord | null,
  updatedEntry: EntryRecord
): EntryRecord {
  const cm = getMetadata(currentEntry);
  const um = getMetadata(updatedEntry);

  return {
    ...(currentEntry ?? {}),
    ...updatedEntry,
    ...((cm || um) && { metadata: { ...(cm ?? {}), ...(um ?? {}) } }),
  };
}

// ---------------------------------------------------------------------------
// Entry decoration — formats timestamps, tokens, p2pk, payment requests
//
// Pure function that adds FormattedTimestamp, FormattedString, and payment
// request metadata to raw screen action entries. Used as the built-in
// default by useScreenActions; wallets can override via the bridge.
// ---------------------------------------------------------------------------

function extractP2PKPubkey(proofs: ReadonlyArray<{ secret: string }>): string | null {
  for (const proof of proofs) {
    try {
      const parsed = JSON.parse(proof.secret);
      if (Array.isArray(parsed) && parsed[0] === 'P2PK' && parsed[1]?.data) {
        return parsed[1].data as string;
      }
    } catch {
      /* not a structured secret */
    }
  }
  return null;
}

function resolveTransportLabel(info: PaymentRequestInfo): string {
  const transports = info.transports;
  if (!transports?.length) return 'Inband';
  if (transports.find((t) => t.type === 'nostr')) return 'Nostr';
  if (transports.find((t) => t.type === 'post')) return 'HTTP POST';
  return transports[0].type;
}

export function decorateEntry(raw: EntryRecord | null, language: string): EntryRecord | null {
  if (!raw) return null;

  let tokenString: FormattedString | null = null;
  const token = raw.token;
  if (token) {
    try {
      tokenString = new FormattedString(
        getEncodedTokenV4(token as Parameters<typeof getEncodedTokenV4>[0]),
        'middle',
        language
      );
    } catch {
      /* skip */
    }
  }

  let p2pkPubkey: FormattedString | null = null;
  const meta = raw.metadata as Record<string, string> | undefined;
  if (meta?.p2pkPubkey) {
    p2pkPubkey = new FormattedString(meta.p2pkPubkey, 'middle', language);
  } else if (token && (token as { proofs?: unknown[] }).proofs) {
    const extracted = extractP2PKPubkey((token as { proofs: { secret: string }[] }).proofs);
    if (extracted) {
      p2pkPubkey = new FormattedString(extracted, 'middle', language);
    }
  }

  let npcAddress: FormattedString | undefined;
  const rawNpc = raw.npcAddress;
  if (typeof rawNpc === 'string' && rawNpc.length > 0) {
    npcAddress = new FormattedString(rawNpc, 'beforeAt', language);
  }

  let paymentRequestInfo: PaymentRequestInfo | null = null;
  let transportLabel: string | null = null;
  const rawMeta = raw.metadata as Record<string, unknown> | undefined;
  const prString = rawMeta?.paymentRequest;
  if (prString && typeof prString === 'string') {
    paymentRequestInfo = defaultDetectors.getPaymentRequestInfo(prString);
    if (paymentRequestInfo) {
      transportLabel = resolveTransportLabel(paymentRequestInfo);
    }
  }

  return {
    ...raw,
    createdAt: new FormattedTimestamp(
      typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      language
    ),
    tokenString,
    p2pkPubkey,
    ...(npcAddress != null && { npcAddress }),
    paymentRequestInfo,
    transportLabel,
  };
}

// ---------------------------------------------------------------------------
// Melt operation → screen entry mapping
// ---------------------------------------------------------------------------

export interface MeltOperationLike {
  id: string;
  mintUrl: string;
  createdAt: number;
  state?: string;
  quoteId?: string;
  amount?: number;
}

function mapMeltOperationState(state?: string): 'UNPAID' | 'PENDING' | 'PAID' {
  if (state === 'finalized') return 'PAID';
  if (state === 'pending' || state === 'executing') return 'PENDING';
  return 'UNPAID';
}

export function meltOperationToScreenActionEntry(operation: MeltOperationLike): EntryRecord | null {
  if (!operation.quoteId || typeof operation.amount !== 'number') return null;

  return {
    id: operation.id,
    type: 'melt',
    createdAt: operation.createdAt,
    mintUrl: operation.mintUrl,
    unit: 'sat',
    quoteId: operation.quoteId,
    amount: operation.amount,
    state: mapMeltOperationState(operation.state),
    metadata: { operationId: operation.id },
  };
}

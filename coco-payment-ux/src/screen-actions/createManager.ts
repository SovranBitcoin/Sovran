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
  /** Default handlers for this screen type. Used as fallback when no wallet handler is registered. */
  defaultHandlers?: ScreenActionHandlerMap[S];
}

export function createScreenActionManager<S extends ScreenType>(
  config: CreateScreenActionManagerConfig<S>
): ScreenActionManager<S> {
  const { screenType, handlers, getContext, amountConfig, defaultHandlers } = config;

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

    const defaultHandlerMap = defaultHandlers as
      | Record<string, ((ctx: ScreenActionContext) => void | Promise<void>) | undefined>
      | undefined;
    const defaultHandler = defaultHandlerMap?.[action as string];

    // Three-tier fallback: wallet override → default handler → built-in copy/share
    const effectiveHandler =
      handler ??
      defaultHandler ??
      (action === 'copy' && CONTENT_EXTRACTORS[screenType]
        ? (ctx: ScreenActionContext) => builtinCopyHandler(screenType, ctx)
        : action === 'share' && CONTENT_EXTRACTORS[screenType]
          ? (ctx: ScreenActionContext) => builtinShareHandler(screenType, ctx)
          : undefined);

    if (!effectiveHandler) return;

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
      await effectiveHandler(ctx);
    } finally {
      loadingActions.delete(action as string);
      notify();
    }
  };

  const getEntry = (): Record<string, unknown> | null => getEffectiveEntry();

  const setEntry = (newEntry: Record<string, unknown>): void => {
    console.info(`[ScreenActionManager:${screenType}] setEntry | id:`, newEntry?.id, '| type:', newEntry?.type, '| state:', newEntry?.state);
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
  receive: ['copy', 'share', 'paste', 'fixedAmount', 'scanQr', 'changeNpcMint'],
  mintInfo: ['trust', 'copy', 'share'],
  amountEntry: ['setInput', 'toggle', 'next', 'paste', 'scanQr'],
  mintSelector: ['select', 'getInfo', 'addMint'],
};

function getActionNames(screenType: ScreenType): string[] {
  return ACTION_NAMES[screenType];
}

// ---------------------------------------------------------------------------
// Built-in copy + share — extracts shareable text per screen type.
//
// Copy writes to clipboard via the injected `writeClipboard` callback.
// Share opens the platform share sheet via `shareContent`.
// Both dispatch notifications (`onCopied` / `onShared`) for wallet feedback.
//
// Wallet-provided handlers override these entirely.
// ---------------------------------------------------------------------------

type EntryLike = Record<string, unknown>;

type ContentExtractor = (
  entry: EntryLike,
  ctx: EntryLike
) => { text: string; target: string } | null;

const CONTENT_EXTRACTORS: Partial<Record<ScreenType, ContentExtractor>> = {
  sendToken: (entry) => {
    const token = entry.token;
    if (!token) return null;
    try {
      return {
        text: getEncodedTokenV4(token as Parameters<typeof getEncodedTokenV4>[0]),
        target: 'token',
      };
    } catch (e) {
      console.warn('[clipboard] Token encode failed:', e instanceof Error ? e.message : e);
      return null;
    }
  },
  mintQuote: (entry) => {
    const pr = entry.paymentRequest;
    return typeof pr === 'string' ? { text: pr, target: 'paymentRequest' } : null;
  },
  receive: (entry, ctx) => {
    const source = (ctx.source ?? 'npc') as string;
    const raw = source === 'p2pk' ? entry.p2pkKey : entry.npcAddress;
    if (raw == null) return null;
    const text = typeof raw === 'string' ? raw : String(raw);
    if (!text) return null;
    return { text, target: source === 'p2pk' ? 'p2pk' : 'address' };
  },
  mintInfo: (entry) => {
    const url = entry.mintUrl;
    return typeof url === 'string' ? { text: url, target: 'mintUrl' } : null;
  },
};

const SHARE_URL_PREFIXES: Partial<Record<string, string>> = {
  token: 'cashu://',
};

function extractContent(
  screenType: ScreenType,
  ctx: ScreenActionContext
): { text: string; target: string } | null {
  const extractor = CONTENT_EXTRACTORS[screenType];
  if (!extractor) return null;
  return extractor(ctx.entry as EntryLike, ctx as EntryLike);
}

async function builtinCopyHandler(
  screenType: ScreenType,
  ctx: ScreenActionContext
): Promise<void> {
  const writeClipboard = (ctx as EntryLike).writeClipboard as
    | ((text: string) => Promise<void>)
    | undefined;
  if (!writeClipboard) return;

  const result = extractContent(screenType, ctx);
  if (!result) return;

  await writeClipboard(result.text);

  const notify = (ctx as EntryLike).notify as
    | ((event: string, ...args: unknown[]) => void)
    | undefined;
  notify?.('onCopied', result.target, result.text);
}

async function builtinShareHandler(
  screenType: ScreenType,
  ctx: ScreenActionContext
): Promise<void> {
  const shareContent = (ctx as EntryLike).shareContent as
    | ((content: { message: string; url?: string }) => Promise<void>)
    | undefined;
  if (!shareContent) return;

  const result = extractContent(screenType, ctx);
  if (!result) return;

  const prefix = SHARE_URL_PREFIXES[result.target];
  await shareContent({
    message: result.text,
    url: prefix ? `${prefix}${result.text}` : undefined,
  });

  const notify = (ctx as EntryLike).notify as
    | ((event: string, ...args: unknown[]) => void)
    | undefined;
  notify?.('onShared', result.target, result.text);
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
    } catch (e) {
      console.warn('[getReceiveTokenString] Token encode failed:', e instanceof Error ? e.message : e);
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

  if (currentType === 'mint') {
    const cq = getStringField(currentEntry, 'quoteId');
    const uq = getStringField(updatedEntry, 'quoteId');
    if (cq && uq && cq === uq) {
      console.info('[shouldApplyEntryUpdate] mint: matched by quoteId |', cq);
      return true;
    }

    const co =
      getStringField(getMetadata(currentEntry), 'operationId') ??
      getStringField(currentEntry, 'operationId');
    const uo =
      getStringField(getMetadata(updatedEntry), 'operationId') ??
      getStringField(updatedEntry, 'operationId');
    if (co && uo && co === uo) {
      console.info('[shouldApplyEntryUpdate] mint: matched by operationId |', co);
      return true;
    }
  }

  if (currentType === 'send') {
    const co =
      getStringField(currentEntry, 'operationId') ??
      getStringField(getMetadata(currentEntry), 'operationId');
    const uo =
      getStringField(updatedEntry, 'operationId') ??
      getStringField(getMetadata(updatedEntry), 'operationId');
    if (co && uo && co === uo) return true;

    // Preview entries (no operationId yet) match by mintUrl + amount
    const isPreview = currentId?.startsWith('pr-preview-') ?? false;
    if (!isPreview) return false;

    const cm = getStringField(currentEntry, 'mintUrl');
    const um = getStringField(updatedEntry, 'mintUrl');
    const ca = getNumberField(currentEntry, 'amount');
    const ua = getNumberField(updatedEntry, 'amount');
    return !!cm && cm === um && typeof ca === 'number' && ca === ua;
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
    if (co && uo && co === uo) return true;

    // Preview entries (no quoteId yet) match by mintUrl + amount
    const isPreview = currentId?.startsWith('melt-preview-') ?? false;
    if (!isPreview) return false;

    const cm = getStringField(currentEntry, 'mintUrl');
    const um = getStringField(updatedEntry, 'mintUrl');
    const ca = getNumberField(currentEntry, 'amount');
    const ua = getNumberField(updatedEntry, 'amount');
    return !!cm && cm === um && typeof ca === 'number' && ca === ua;
  }

  if (currentType === 'receive') {
    const ct = getReceiveTokenString(currentEntry);
    const ut = getReceiveTokenString(updatedEntry);
    if (ct && ut && ct === ut) return true;

    const isPreview = currentId?.startsWith('receive-') ?? false;
    if (!isPreview) {
      console.info('[shouldApplyEntryUpdate] receive: not a preview entry, skipping | currentId:', currentId, '| updatedId:', updatedId);
      return false;
    }

    const cm = getStringField(currentEntry, 'mintUrl');
    const um = getStringField(updatedEntry, 'mintUrl');
    const ca = getNumberField(currentEntry, 'amount');
    const ua = getNumberField(updatedEntry, 'amount');
    const matched = !!cm && cm === um && typeof ca === 'number' && ca === ua;
    console.info('[shouldApplyEntryUpdate] receive preview match:', matched, '| mintUrl:', cm === um, '| amount:', ca, '→', ua);
    return matched;
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

  const merged = {
    ...(currentEntry ?? {}),
    ...updatedEntry,
    ...((cm || um) && { metadata: { ...(cm ?? {}), ...(um ?? {}) } }),
  };

  // When a real operationId arrives, stale phase:'preview' must be upgraded.
  // The real entry from the DB carries operationId but no metadata, so the
  // merge preserves the preview entry's phase. Fix it here to keep the
  // merged entry self-consistent.
  const mergedMeta = getMetadata(merged);
  if (
    mergedMeta?.phase === 'preview' &&
    (typeof merged.operationId === 'string' || typeof mergedMeta?.operationId === 'string')
  ) {
    (mergedMeta as Record<string, unknown>).phase = 'delivered';
  }

  return merged;
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
    } catch (e) {
      console.warn('[buildEntryContent] Token encode failed:', e instanceof Error ? e.message : e);
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

  let mintUrlFormatted: FormattedString | undefined;
  if (typeof raw.mintUrl === 'string' && raw.mintUrl.length > 0) {
    mintUrlFormatted = new FormattedString(raw.mintUrl, 'middle', language);
  }

  let contact: Array<{ method: string; info: FormattedString }> | undefined;
  if (Array.isArray(raw.contact)) {
    contact = (raw.contact as Array<{ method: string; info: string }>).map((c) => ({
      method: c.method,
      info: new FormattedString(c.info, 'middle', language),
    }));
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
    ...(mintUrlFormatted != null && { mintUrl: mintUrlFormatted }),
    ...(contact != null && { contact }),
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

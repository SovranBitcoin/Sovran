import type { JsonRecord } from '../adapters';

export type HistoryEntryType = 'send' | 'receive' | 'melt' | 'mint';

export type SubscriptionEventType =
  | 'history.updated'
  | 'melt.updated'
  | 'mint.updated'
  | 'receive.npcMintChanged'
  | 'receive.p2pkKeyChanged'
  | 'mintInfo.enrichmentChanged'
  | 'mintInfo.fetched'
  | 'mintSelector.itemAdded'
  | 'screenActions.changed';

export type ScreenActionsChangedReason =
  | 'scanHistory'
  | 'transactionDistribution'
  | 'settings'
  | 'unknown';

interface BaseSubscriptionEvent {
  /**
   * Stable event discriminator. Payloads intentionally stay JSON-shaped so
   * host apps can publish from Coco, native modules, or tests without leaking
   * implementation objects into Colada.
   */
  type: SubscriptionEventType;
}

export interface HistoryUpdatedEvent extends BaseSubscriptionEvent {
  type: 'history.updated';
  entry: JsonRecord;
  historyType?: HistoryEntryType;
  entryId?: string;
  quoteId?: string;
  operationId?: string;
  mintUrl?: string;
}

export interface MeltUpdatedEvent extends BaseSubscriptionEvent {
  type: 'melt.updated';
  entry: JsonRecord;
  entryId?: string;
  quoteId?: string;
  operationId?: string;
  mintUrl?: string;
}

export interface MintUpdatedEvent extends BaseSubscriptionEvent {
  type: 'mint.updated';
  entry: JsonRecord;
  entryId?: string;
  quoteId?: string;
  operationId?: string;
  mintUrl?: string;
}

export interface ReceiveNpcMintChangedEvent extends BaseSubscriptionEvent {
  type: 'receive.npcMintChanged';
  mintUrl: string | null;
}

export interface ReceiveP2pkKeyChangedEvent extends BaseSubscriptionEvent {
  type: 'receive.p2pkKeyChanged';
  p2pkKey: string | null;
}

export interface MintInfoEnrichmentChangedEvent extends BaseSubscriptionEvent {
  type: 'mintInfo.enrichmentChanged';
  mintUrl?: string;
}

export interface MintInfoFetchedEvent extends BaseSubscriptionEvent {
  type: 'mintInfo.fetched';
  mintUrl: string;
  entry: JsonRecord;
}

export interface MintSelectorItemAddedEvent extends BaseSubscriptionEvent {
  type: 'mintSelector.itemAdded';
  mintUrl: string;
  item: JsonRecord;
}

export interface ScreenActionsChangedEvent extends BaseSubscriptionEvent {
  type: 'screenActions.changed';
  reason: ScreenActionsChangedReason;
}

export type ColadaSubscriptionEvent =
  | HistoryUpdatedEvent
  | MeltUpdatedEvent
  | MintUpdatedEvent
  | ReceiveNpcMintChangedEvent
  | ReceiveP2pkKeyChangedEvent
  | MintInfoEnrichmentChangedEvent
  | MintInfoFetchedEvent
  | MintSelectorItemAddedEvent
  | ScreenActionsChangedEvent;

export type SubscriptionListener<E extends ColadaSubscriptionEvent = ColadaSubscriptionEvent> = (
  event: E,
) => void;

export type SubscriptionEventForType<T extends SubscriptionEventType> = Extract<
  ColadaSubscriptionEvent,
  { type: T }
>;

type EventTypeFromFilterValue<T> =
  T extends readonly (infer U)[]
    ? Extract<U, SubscriptionEventType>
    : Extract<T, SubscriptionEventType>;

export type SubscriptionEventForFilter<F extends SubscriptionFilter> = F extends {
  type: infer T;
}
  ? SubscriptionEventForType<EventTypeFromFilterValue<T>>
  : ColadaSubscriptionEvent;

export interface SubscriptionFilter<T extends SubscriptionEventType = SubscriptionEventType> {
  type?: T | readonly T[];
  historyType?: HistoryEntryType;
  entryId?: string;
  quoteId?: string;
  operationId?: string;
  mintUrl?: string;
}

export interface ColadaSubscriptionBus {
  subscribe: <F extends SubscriptionFilter>(
    filter: F,
    listener: SubscriptionListener<SubscriptionEventForFilter<F>>,
  ) => () => void;
  subscribeAll: (listener: SubscriptionListener) => () => void;
  publish: (event: ColadaSubscriptionEvent) => void;
}

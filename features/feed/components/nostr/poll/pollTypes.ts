/**
 * @fileoverview NIP-88 poll types (kind:1068 poll, kind:1018 vote).
 */
export type PollType = 'singlechoice' | 'multiplechoice';

export interface PollOption {
  id: string;
  label: string;
}

export interface PollDefinition {
  /** The kind:1068 event id. */
  id: string;
  pubkey: string;
  /** Poll question (the event content). */
  question: string;
  options: PollOption[];
  pollType: PollType;
  /** Unix seconds; undefined = no expiry. */
  endsAt?: number;
  /** Relays where votes should be published/read. */
  relays: string[];
}

export interface PollTally {
  /** optionId → vote count. */
  counts: Record<string, number>;
  /** Distinct voters counted. */
  total: number;
  /** Option ids the viewer voted for (empty if not voted / unknown). */
  myVote: string[];
}

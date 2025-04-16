import { Event, EventTemplate } from "nostr-tools";

declare global {
  interface Window {
    nostr: {
      getPublicKey: () => Promise<string>;
      signEvent: (e: {
        kind: number;
        content: string;
        created_at: number;
        tags: string[][];
      }) => Promise<{
        kind: number;
        content: string;
        created_at: number;
        tags: string[][];
        id: string;
        sig: string;
        pubkey: string;
      }>;
    };
  }
}

export type TokenReponse =
  | { error: true; message: string }
  | { error: false; data: { token: string } };

export type BalanceResponse =
  | { error: true; message: string }
  | { error: false; data: number };

export interface Signer {
  signEvent: (e: EventTemplate) => Promise<Event>;
}

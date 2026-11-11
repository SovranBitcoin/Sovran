// ---------------------------------------------------------------------------
// Screen Actions — the payment request screen entry's phase
// ---------------------------------------------------------------------------
//
// The entry carries its phase as strings the timeline and the app's payment
// request screen read (`metadata.phase`, `tokenCreated: "true"`,
// `nostrSent: "true"`, `operationId`). This file is the one place that reads
// them into a phase and the one place that writes them for a send's outcome.

import type { PaymentRequestConfirmOutcome } from "../machine/types";

/** What a payment request screen entry says happened to its send. */
type PaymentRequestEntryPhase =
  /** Nothing sent yet: Pay is offered. */
  | { kind: "preview" }
  /** The transport took the ecash. */
  | { kind: "delivered" }
  /** Ecash was created, not confirmed delivered and not taken back. */
  | { kind: "undelivered" }
  /** Delivery failed and the ecash was taken back. */
  | { kind: "rolledBack" }
  /**
   * A phase no writer produces, or "undelivered" without the operation id
   * its writer always adds. Neither offers Pay nor claims the send went out.
   */
  | { kind: "unrecognised" };

/** The send outcomes that change what the entry says. */
type SentOutcome = Extract<
  PaymentRequestConfirmOutcome,
  { kind: "delivered" | "undelivered" | "rolledBack" }
>;

type Entry = Record<string, unknown>;

const isRecord = (value: unknown): value is Entry =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const metadataOf = (entry: Entry): Entry =>
  isRecord(entry.metadata) ? entry.metadata : {};

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/**
 * The app gives a payment request preview entry an id with this prefix. It
 * names no operation: the confirm handler writes it as the operation id of a
 * delivered or rolled-back entry when it knows no other.
 */
export const isPaymentRequestPreviewId = (id: unknown): boolean =>
  typeof id === "string" && id.startsWith("pr-preview-");

/**
 * An operation id that names a real operation: a non-empty string, as every
 * writer writes it, and not the preview's own id.
 */
const realOperationId = (value: unknown): boolean =>
  typeof value === "string" && value.length > 0 && !isPaymentRequestPreviewId(value);

/** Reads the phase an entry's strings say, once, for every reader. */
export function decodePaymentRequestEntryPhase(
  entry: Entry,
): PaymentRequestEntryPhase {
  const metadata = metadataOf(entry);
  const phase = metadata.phase;
  const ran =
    realOperationId(entry.operationId) || realOperationId(metadata.operationId);
  switch (phase) {
    case "delivered":
      return { kind: "delivered" };
    case "undelivered":
      return ran ? { kind: "undelivered" } : { kind: "unrecognised" };
    case "rolledBack":
      return { kind: "rolledBack" };
    case "preview":
    case undefined:
      // An entry with a real operation id has run, whatever its phase says.
      return ran ? { kind: "delivered" } : { kind: "preview" };
    default:
      return ran ? { kind: "delivered" } : { kind: "unrecognised" };
  }
}

/** The entry after a send, carrying the strings its readers expect. */
export function withPaymentRequestSendOutcome(
  current: Entry | null | undefined,
  outcome: SentOutcome,
): Entry {
  const entry = current ?? {};
  const metadata = metadataOf(entry);
  // Delivered and rolled back keep the id the entry already has, which for
  // a preview is the preview id.
  const existingOperationId =
    stringOf(metadata.operationId) ??
    stringOf(entry.operationId) ??
    stringOf(entry.id);
  switch (outcome.kind) {
    case "delivered":
      return {
        ...entry,
        state: "pending",
        operationId: existingOperationId,
        metadata: {
          ...metadata,
          operationId: existingOperationId,
          phase: "delivered",
          tokenCreated: "true",
          nostrSent: "true",
        },
      };
    case "undelivered":
      return {
        ...entry,
        state: "pending",
        operationId: outcome.operationId,
        metadata: {
          ...metadata,
          operationId: outcome.operationId,
          phase: "undelivered",
          tokenCreated: "true",
        },
      };
    case "rolledBack":
      return {
        ...entry,
        state: "rolledBack",
        operationId: existingOperationId,
        metadata: {
          ...metadata,
          operationId: existingOperationId,
          phase: "rolledBack",
          tokenCreated: "true",
        },
      };
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

/**
 * The entry a payment request screen opens with when the machine has already
 * acted on the step: an NFC tap pays over the request's transport before any
 * screen is shown.
 */
import { describe, expect, it } from "vitest";

import {
  decodePaymentRequestEntryPhase,
  withPaymentRequestStepPhase,
} from "../../src/screen-actions/paymentRequestPhase";

const preview = {
  id: "pr-preview-1",
  type: "send",
  state: "prepared",
  metadata: { paymentRequest: "creqA…", phase: "preview" },
};

describe("withPaymentRequestStepPhase", () => {
  it("leaves a preview offering Pay", () => {
    const entry = withPaymentRequestStepPhase(preview, { kind: "preview" });
    expect(entry).toBe(preview);
    expect(decodePaymentRequestEntryPhase(entry)).toEqual({ kind: "preview" });
  });

  it("opens a settled step as delivered", () => {
    const entry = withPaymentRequestStepPhase(preview, {
      kind: "settled",
      historyEntry: "{}",
    });
    expect(decodePaymentRequestEntryPhase(entry)).toEqual({ kind: "delivered" });
    expect(entry.metadata).toMatchObject({ tokenCreated: "true", nostrSent: "true" });
  });

  it("opens an undelivered step as undelivered, with its operation", () => {
    const entry = withPaymentRequestStepPhase(preview, {
      kind: "undelivered",
      operationId: "op-1",
    });
    expect(decodePaymentRequestEntryPhase(entry)).toEqual({ kind: "undelivered" });
    expect(entry.operationId).toBe("op-1");
  });
});

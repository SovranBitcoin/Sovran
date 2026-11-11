/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * defaultHandlers.test.ts — Default Screen Action Handlers
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests for createDefaultScreenActionHandlers — the batteries-included
 * default handlers for all screen types. These handlers use:
 *   - operations: async work (checkSendStatus, executeReceive, etc.)
 *   - notifications: fire-and-forget UI feedback (onSendCancelled, etc.)
 *   - navigation: routing callbacks (scanQr, mintInfo, addMint, goBack)
 *   - machine: PaymentMachine instance for delegated actions
 *
 * Each test creates a standalone handler config (no React, no provider)
 * and exercises the handler through the ScreenActionManager's execute().
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { getDecodedToken } from "@cashu/cashu-ts";

import {
  createDefaultScreenActionHandlers,
  startNewEcashSendIfFinished,
} from "../../src/screen-actions/defaultHandlers";
import { createScreenActionManager } from "../../src/screen-actions/createManager";
import { deriveMintMethodCapabilityMapFromTrustedMints } from "../../src/mint-capabilities";
import { setLogger } from "../../src/logger";
import type {
  MachineOperations,
  PaymentMachine,
  ProcessResult,
  ReceiveExecuteResult,
} from "../../src/machine/types";
import type {
  ScreenActionContext,
  ScreenActionHandlerMap,
  ScreenActionManager,
  ScreenType,
} from "../../src/screen-actions/types";
import type {
  DefaultScreenActionHandlersConfig,
  NavigationCallbacks,
} from "../../src/screen-actions/defaultHandlers";
import {
  LEGACY_BASE64_KEYSET_V3_TOKEN,
  NUT00_V3_TOKEN,
} from "../_harness/tokenVectors";
import { createTestMachine, INPUTS } from "../_harness";
import {
  AuthoredError,
  PaymentRequestUndeliveredError,
} from "../../src/errors";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const MINT1 = "https://mint1.example.com";
const MINT2 = "https://mint2.example.com";
type MockFn = ReturnType<typeof vi.fn>;

afterEach(() => {
  setLogger(null);
});

function createMockConfig(overrides?: {
  operations?: Partial<MachineOperations>;
  machine?: Partial<PaymentMachine>;
  navigation?: Partial<NavigationCallbacks>;
  getOffline?: () => boolean;
}) {
  const notifications: { event: string; args: unknown[] }[] = [];
  const ops: Partial<MachineOperations> = {
    checkSendStatus: vi.fn(async () => ({ state: "pending" })),
    rollbackSend: vi.fn(async () => ({ kind: "reclaimed" as const })),
    executeReceive: vi.fn(async () => ({
      historyEntry: JSON.stringify({
        id: "rx-1",
        type: "receive",
        mintUrl: MINT1,
        amount: 100,
      }),
    })),
    isMintTrusted: vi.fn(async () => true),
    trustMint: vi.fn(async () => {}),
    rollbackMelt: vi.fn(async () => {}),
    buildMintReviewInfo: vi.fn(async (mintUrl: string) => ({
      mintUrl,
      displayName: mintUrl,
      balance: 0,
      unit: "sat",
      isPreferred: false,
      isTrusted: true,
    })) as MachineOperations["buildMintReviewInfo"],
    linkTransaction: vi.fn(() => {}),
    ...overrides?.operations,
  };

  const machine: Partial<PaymentMachine> = {
    confirmMelt: vi.fn(async () => {}),
    confirmPaymentRequest: vi.fn(async () => ({ kind: "delivered" as const })),
    scan: vi.fn(async (): Promise<ProcessResult> => ({ urInProgress: false })),
    startReceiveLightning: vi.fn(async () => {}),
    showReceiveQr: vi.fn(async () => {}),
    requestMintSelector: vi.fn(async () => {}),
    changeMint: vi.fn(async () => {}),
    enterAmount: vi.fn(async () => {}),
    reviewMint: vi.fn(async () => {}),
    getContext: vi.fn(() => ({ unit: "sat" })),
    getStep: vi.fn(() => "enterAmount" as const),
    ...overrides?.machine,
  };

  const navigation: NavigationCallbacks = {
    scanQr: vi.fn(),
    nutDrop: vi.fn(),
    mintInfo: vi.fn(),
    addMint: vi.fn(),
    goBack: vi.fn(),
    ...overrides?.navigation,
  };

  const config: DefaultScreenActionHandlersConfig = {
    getMachine: () => machine as PaymentMachine,
    getOperations: () => ops,
    getOffline: overrides?.getOffline,
    notify: (event: string, ...args: unknown[]) => {
      notifications.push({ event, args });
    },
    navigation,
  };

  const handlers = createDefaultScreenActionHandlers(config);

  return { handlers, ops, machine, navigation, notifications };
}

function createManager(
  screenType: ScreenType,
  handlers: ScreenActionHandlerMap,
  entry: Record<string, unknown>,
  extraContext?: Record<string, unknown>,
) {
  const setEntry = vi.fn();
  let mgrRef: ScreenActionManager<ScreenType> | null = null;
  const mgr: ScreenActionManager<ScreenType> = createScreenActionManager({
    screenType,
    handlers: {},
    defaultHandlers: handlers[screenType],
    getContext: (): ScreenActionContext => ({
      entry: mgrRef?.getEntry() ?? {},
      manager: null,
      setEntry: (e: Record<string, unknown>) => {
        setEntry(e);
        mgrRef?.setEntry(e);
      },
      ...extraContext,
    }),
  });
  mgrRef = mgr;
  mgr.setEntry(entry);
  return { mgr, setEntry };
}

// ---------------------------------------------------------------------------
// built-in copy/share targets
// ---------------------------------------------------------------------------

describe("back default handlers", () => {
  const screens: ScreenType[] = [
    "sendToken",
    "receiveToken",
    "mintQuote",
    "meltQuote",
    "paymentRequest",
    "receive",
    "mintInfo",
    "amountEntry",
    "mintSelector",
  ];

  it.each(screens)("%s delegates to navigation.goBack", async (screenType) => {
    const { handlers, navigation } = createMockConfig();
    const { mgr } = createManager(screenType, handlers, {});

    await mgr.execute("back");

    expect(navigation.goBack).toHaveBeenCalled();
  });
});

describe("built-in copy/share targets", () => {
  it("labels mint quote clipboard copies as Lightning invoices", async () => {
    const writeClipboard = vi.fn(async () => {});
    const notify = vi.fn();
    const mgr = createScreenActionManager({
      screenType: "mintQuote",
      handlers: {},
      getContext: () => {
        const context: ScreenActionContext = {
          entry: {},
          manager: null,
          setEntry: () => {},
          writeClipboard,
          notify,
        };
        return context;
      },
    });

    mgr.setEntry({ paymentRequest: "lnbc1invoice" });

    await mgr.execute("copy");

    expect(writeClipboard).toHaveBeenCalledWith("lnbc1invoice");
    expect(notify).toHaveBeenCalledWith(
      "onCopied",
      "lightningInvoice",
      "lnbc1invoice",
    );
  });

  it("copies operation-backed onchain mint quotes as exact-amount BIP321 URIs", async () => {
    const writeClipboard = vi.fn(async () => {});
    const notify = vi.fn();
    const mgr = createScreenActionManager({
      screenType: "mintQuote",
      handlers: {},
      getContext: () => {
        const context: ScreenActionContext = {
          entry: {},
          manager: null,
          setEntry: () => {},
          writeClipboard,
          notify,
        };
        return context;
      },
    });
    const address = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080";
    const bip321 = `bitcoin:${address}?amount=0.00001234&message=For%20coffee`;

    mgr.setEntry({
      paymentRequest: address,
      amount: 0,
      unit: "sat",
      metadata: {
        method: "onchain",
        onchainAddress: address,
        requestedAmount: "1234",
        memo: "For coffee",
      },
    });

    await mgr.execute("copy");

    expect(writeClipboard).toHaveBeenCalledWith(bip321);
    expect(notify).toHaveBeenCalledWith("onCopied", "address", bip321);
  });

  it("labels mint quote shares as Lightning invoices", async () => {
    const shareContent = vi.fn(async () => {});
    const notify = vi.fn();
    const mgr = createScreenActionManager({
      screenType: "mintQuote",
      handlers: {},
      getContext: () => {
        const context: ScreenActionContext = {
          entry: {},
          manager: null,
          setEntry: () => {},
          shareContent,
          notify,
        };
        return context;
      },
    });

    mgr.setEntry({ paymentRequest: "lnbc1invoice" });

    await mgr.execute("share");

    expect(shareContent).toHaveBeenCalledWith({
      message: "lnbc1invoice",
      url: undefined,
    });
    expect(notify).toHaveBeenCalledWith(
      "onShared",
      "lightningInvoice",
      "lnbc1invoice",
    );
  });

  it("shares operation-backed onchain mint quotes as exact-amount BIP321 URIs", async () => {
    const shareContent = vi.fn(async () => {});
    const notify = vi.fn();
    const mgr = createScreenActionManager({
      screenType: "mintQuote",
      handlers: {},
      getContext: () => {
        const context: ScreenActionContext = {
          entry: {},
          manager: null,
          setEntry: () => {},
          shareContent,
          notify,
        };
        return context;
      },
    });
    const address = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080";
    const bip321 = `bitcoin:${address}?amount=0.00001234`;

    mgr.setEntry({
      paymentRequest: address,
      amount: 0,
      unit: "sat",
      metadata: {
        method: "onchain",
        onchainAddress: address,
        requestedAmount: "1234",
      },
    });

    await mgr.execute("share");

    expect(shareContent).toHaveBeenCalledWith({
      message: bip321,
      url: undefined,
    });
    expect(notify).toHaveBeenCalledWith("onShared", "address", bip321);
  });
});

// ---------------------------------------------------------------------------
// sendToken
// ---------------------------------------------------------------------------

describe("sendToken default handlers", () => {
  describe("checkStatus", () => {
    it("calls checkSendStatus and notifies with result", async () => {
      const { handlers, ops, notifications } = createMockConfig({
        operations: {
          checkSendStatus: vi.fn(async () => ({ state: "finalized" })),
        },
      });

      const { mgr } = createManager("sendToken", handlers, {
        type: "send",
        operationId: "op-123",
        token: null,
      });

      await mgr.execute("checkStatus");

      expect(ops.checkSendStatus).toHaveBeenCalledWith("op-123");
      expect(notifications).toContainEqual({
        event: "onSendStatusChecked",
        args: [{ operationId: "op-123", state: "finalized", redeemed: true }],
      });
    });

    it("reports non-finalized as not redeemed", async () => {
      const { handlers, notifications } = createMockConfig({
        operations: {
          checkSendStatus: vi.fn(async () => ({ state: "pending" })),
        },
      });

      const { mgr } = createManager("sendToken", handlers, {
        type: "send",
        operationId: "op-456",
        token: null,
      });

      await mgr.execute("checkStatus");

      expect(notifications).toContainEqual({
        event: "onSendStatusChecked",
        args: [{ operationId: "op-456", state: "pending", redeemed: false }],
      });
    });

    it("does nothing without operationId", async () => {
      const { handlers, ops } = createMockConfig();
      const { mgr } = createManager("sendToken", handlers, {
        type: "send",
        token: null,
      });

      await mgr.execute("checkStatus");
      expect(ops.checkSendStatus).not.toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("calls rollbackSend and notifies on success", async () => {
      const { handlers, ops, notifications } = createMockConfig();
      const { mgr } = createManager("sendToken", handlers, {
        type: "send",
        operationId: "op-789",
        token: null,
      });

      await mgr.execute("cancel");

      expect(ops.rollbackSend).toHaveBeenCalledWith("op-789");
      expect(notifications).toContainEqual({
        event: "onSendCancelled",
        args: [{ operationId: "op-789" }],
      });
    });

    it("blocks cancellation while offline", async () => {
      const { handlers, ops, notifications } = createMockConfig({
        getOffline: () => true,
      });
      const { mgr } = createManager("sendToken", handlers, {
        type: "send",
        operationId: "op-offline",
        token: null,
      });

      await mgr.execute("cancel");

      expect(ops.rollbackSend).not.toHaveBeenCalled();
      expect(notifications).toContainEqual({
        event: "onSendCancelFailed",
        args: [
          {
            operationId: "op-offline",
            message: "Cancel transaction is not possible while offline.",
            offline: true,
          },
        ],
      });
    });

    // A cancel that could not tell what happened to the send (not found, a
    // lookup that failed, a send redeemed or already being taken back) did
    // not cancel it: the token may still be out.
    it("does not say cancelled when it could not tell", async () => {
      const { handlers, notifications } = createMockConfig({
        operations: {
          rollbackSend: vi.fn(async () => ({ kind: "unknown" as const, reason: "notFound" as const })),
        },
      });
      const { mgr } = createManager("sendToken", handlers, {
        type: "send",
        operationId: "op-lost",
        token: null,
      });

      await mgr.execute("cancel");

      expect(notifications.map((n) => n.event)).toEqual(["onSendCancelFailed"]);
      expect(notifications[0].args[0]).toMatchObject({ operationId: "op-lost" });
    });

    it("notifies onSendCancelFailed on error", async () => {
      const { handlers, notifications } = createMockConfig({
        operations: {
          rollbackSend: vi.fn(async () => {
            throw new Error("Cannot rollback");
          }),
        },
      });

      const { mgr } = createManager("sendToken", handlers, {
        type: "send",
        operationId: "op-fail",
        token: null,
      });

      await mgr.execute("cancel");

      expect(notifications).toContainEqual({
        event: "onSendCancelFailed",
        args: [
          {
            operationId: "op-fail",
            message: "Cannot rollback",
            mintUnreachable: false,
          },
        ],
      });
    });
  });
});

// ---------------------------------------------------------------------------
// receiveToken
// ---------------------------------------------------------------------------

describe("receiveToken default handlers", () => {
  const VALID_TOKEN = {
    mint: MINT1,
    proofs: [
      {
        amount: 1,
        secret: "test-secret-string",
        C: "02" + "0".repeat(64),
        id: "00" + "0".repeat(14),
      },
    ],
    unit: "sat",
  };

  function tokenEntry() {
    return {
      id: "receive-preview-1",
      type: "receive",
      mintUrl: MINT1,
      amount: 1,
      unit: "sat",
      token: VALID_TOKEN,
    };
  }

  describe("redeem — happy path", () => {
    it("calls executeReceive and notifies on success", async () => {
      const { handlers, ops, notifications } = createMockConfig();
      const { mgr } = createManager("receiveToken", handlers, tokenEntry());

      await mgr.execute("redeem");

      expect(ops.isMintTrusted).toHaveBeenCalledWith(MINT1);
      expect(ops.executeReceive).toHaveBeenCalled();
      expect(
        notifications.find((n) => n.event === "onReceiveProcessing"),
      ).toBeTruthy();
      expect(
        notifications.find((n) => n.event === "onReceiveConfirmed"),
      ).toBeTruthy();
    });

    it("redeems an entry whose token is only in metadata.rawToken (scan/paste)", async () => {
      const { handlers, ops } = createMockConfig();
      const rawToken = "cashuBexampletoken";
      const { mgr } = createManager("receiveToken", handlers, {
        id: "receive-preview-2",
        type: "receive",
        mintUrl: MINT1,
        amount: 1,
        unit: "sat",
        metadata: { rawToken },
      });

      await mgr.execute("redeem");

      expect(ops.executeReceive).toHaveBeenCalledWith({ tokenString: rawToken, mintUrl: MINT1, amount: 1 });
    });

    it("upgrades a decoded V3 entry to V4 at the redeem boundary", async () => {
      const { handlers, ops } = createMockConfig();
      const { mgr } = createManager("receiveToken", handlers, {
        id: "receive-v3",
        type: "receive",
        mintUrl: "https://8333.space:3338",
        amount: 10,
        unit: "sat",
        token: getDecodedToken(NUT00_V3_TOKEN, []),
      });

      await mgr.execute("redeem");

      const [{ tokenString: upgraded, mintUrl, amount }] = (
        ops.executeReceive as MockFn
      ).mock.calls[0]!;
      expect(upgraded).toMatch(/^cashuB/);
      expect(mintUrl).toBe("https://8333.space:3338");
      expect(amount).toBe(10);
    });

    it("keeps a legacy base64-keyset token in V3 when V4 encoding is impossible", async () => {
      const { handlers, ops } = createMockConfig();
      const { mgr } = createManager("receiveToken", handlers, {
        id: "receive-legacy-v3",
        type: "receive",
        mintUrl: "https://legacy.example",
        amount: 1,
        unit: "sat",
        token: getDecodedToken(LEGACY_BASE64_KEYSET_V3_TOKEN, []),
        metadata: { rawToken: LEGACY_BASE64_KEYSET_V3_TOKEN },
      });

      await mgr.execute("redeem");

      expect(ops.executeReceive).toHaveBeenCalledWith({ tokenString: LEGACY_BASE64_KEYSET_V3_TOKEN, mintUrl: "https://legacy.example", amount: 1 });
    });

    it("notification sequence: onReceiveProcessing → onReceiveConfirmed → onTransactionCreated", async () => {
      const { handlers, notifications } = createMockConfig();
      const { mgr } = createManager("receiveToken", handlers, tokenEntry());

      await mgr.execute("redeem");

      const events = notifications.map((n) => n.event);
      expect(events).toEqual([
        "onReceiveProcessing",
        "onReceiveConfirmed",
        "onTransactionCreated",
      ]);
    });

    it("onReceiveProcessing carries id, mintUrl, amount, unit", async () => {
      const { handlers, notifications } = createMockConfig();
      const { mgr } = createManager("receiveToken", handlers, tokenEntry());

      await mgr.execute("redeem");

      const processing = notifications.find(
        (n) => n.event === "onReceiveProcessing",
      );
      expect(processing!.args[0]).toMatchObject({
        id: "receive-preview-1",
        mintUrl: MINT1,
        amount: 1,
        unit: "sat",
      });
    });

    it("onReceiveConfirmed carries historyEntry", async () => {
      const { handlers, notifications } = createMockConfig();
      const { mgr } = createManager("receiveToken", handlers, tokenEntry());

      await mgr.execute("redeem");

      const confirmed = notifications.find(
        (n) => n.event === "onReceiveConfirmed",
      );
      const data = confirmed!.args[0] as Record<string, unknown>;
      expect(data.historyEntry).toEqual(expect.any(String));
      expect(data.id).toBe("receive-preview-1");
    });

    it("onTransactionCreated carries type=receive", async () => {
      const { handlers, notifications } = createMockConfig();
      const { mgr } = createManager("receiveToken", handlers, tokenEntry());

      await mgr.execute("redeem");

      const txCreated = notifications.find(
        (n) => n.event === "onTransactionCreated",
      );
      expect(txCreated!.args[0]).toMatchObject({
        type: "receive",
        mintUrl: MINT1,
      });
    });

    it("updates entry with real history data", async () => {
      const realEntry = {
        id: "rx-real",
        type: "receive",
        mintUrl: MINT1,
        amount: 1,
      };
      const { handlers } = createMockConfig({
        operations: {
          executeReceive: vi.fn(async () => ({
            historyEntry: JSON.stringify(realEntry),
          })),
          isMintTrusted: vi.fn(async () => true),
        },
      });

      const { mgr, setEntry } = createManager(
        "receiveToken",
        handlers,
        tokenEntry(),
      );
      await mgr.execute("redeem");

      expect(setEntry).toHaveBeenCalledWith(realEntry);
    });

    it("calls linkTransaction when available", async () => {
      const realEntry = {
        id: "rx-link",
        type: "receive",
        mintUrl: MINT1,
        amount: 1,
      };
      const { handlers, ops } = createMockConfig({
        operations: {
          executeReceive: vi.fn(async () => ({
            historyEntry: JSON.stringify(realEntry),
          })),
          isMintTrusted: vi.fn(async () => true),
          linkTransaction: vi.fn(),
        },
      });

      const { mgr } = createManager("receiveToken", handlers, tokenEntry());
      await mgr.execute("redeem");

      expect(ops.linkTransaction).toHaveBeenCalled();
    });

    it("updates entry and notifies pending without failing for recoverable receives", async () => {
      const logs: Array<{
        level: string;
        event: string;
        fields?: Record<string, unknown>;
      }> = [];
      setLogger({
        debug: (event, fields) => logs.push({ level: "debug", event, fields }),
        info: (event, fields) => logs.push({ level: "info", event, fields }),
        warn: (event, fields) => logs.push({ level: "warn", event, fields }),
        error: (event, fields) => logs.push({ level: "error", event, fields }),
      });
      const pendingEntry = {
        id: "receive-op-1",
        type: "receive",
        mintUrl: MINT1,
        amount: 1,
        unit: "sat",
        state: "executing",
        operationId: "op-1",
      };
      const { handlers, notifications } = createMockConfig({
        operations: {
          executeReceive: vi.fn(async (): Promise<ReceiveExecuteResult> => ({
            status: "pending",
            operationId: "op-1",
            pendingReason: "network",
            historyEntry: JSON.stringify(pendingEntry),
            message: "We'll add it to your wallet when you're back online.",
          })),
          isMintTrusted: vi.fn(async () => true),
        },
      });

      const { mgr, setEntry } = createManager(
        "receiveToken",
        handlers,
        tokenEntry(),
      );
      await mgr.execute("redeem");

      expect(setEntry).toHaveBeenCalledWith(pendingEntry);
      expect(notifications.map((n) => n.event)).toEqual([
        "onReceiveProcessing",
        "onReceivePending",
      ]);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "screenAction.receiveToken.redeem.pending",
            fields: expect.objectContaining({
              id: "receive-preview-1",
              operationId: "op-1",
              pendingReason: "network",
              expectedNext: "wallet_core_recovery_finalizes_receive",
            }),
          }),
        ]),
      );
      expect(JSON.stringify(logs)).not.toContain("test-secret-string");
    });
  });

  describe("redeem — untrusted mint", () => {
    it("calls machine.reviewMint instead of receiving", async () => {
      const { handlers, ops, machine } = createMockConfig({
        operations: {
          isMintTrusted: vi.fn(async () => false),
        },
      });

      const entry = tokenEntry();
      const { mgr } = createManager("receiveToken", handlers, entry);
      await mgr.execute("redeem");

      expect(machine.reviewMint).toHaveBeenCalled();
      expect(ops.executeReceive).not.toHaveBeenCalled();
    });
  });

  describe("redeem — failure", () => {
    it("notifies onReceiveFailed and re-throws", async () => {
      const { handlers, notifications } = createMockConfig({
        operations: {
          executeReceive: vi.fn(async () => {
            throw new Error("Token already spent");
          }),
          isMintTrusted: vi.fn(async () => true),
        },
      });

      const { mgr } = createManager("receiveToken", handlers, tokenEntry());

      await expect(mgr.execute("redeem")).rejects.toThrow(
        "Token already spent",
      );
      expect(
        notifications.find((n) => n.event === "onReceiveFailed"),
      ).toBeTruthy();
    });

    it("notification sequence on failure: onReceiveProcessing → onReceiveFailed (no confirmed/txCreated)", async () => {
      const { handlers, notifications } = createMockConfig({
        operations: {
          executeReceive: vi.fn(async () => {
            throw new Error("Already spent");
          }),
          isMintTrusted: vi.fn(async () => true),
        },
      });

      const { mgr } = createManager("receiveToken", handlers, tokenEntry());
      await expect(mgr.execute("redeem")).rejects.toThrow();

      const events = notifications.map((n) => n.event);
      expect(events).toEqual(["onReceiveProcessing", "onReceiveFailed"]);
    });
  });
});

// ---------------------------------------------------------------------------
// meltQuote
// ---------------------------------------------------------------------------

describe("meltQuote default handlers", () => {
  describe("pay", () => {
    it("delegates to machine.confirmMelt", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("meltQuote", handlers, {
        type: "melt",
        quoteId: "q-1",
        state: "UNPAID",
      });

      await mgr.execute("pay");
      expect(machine.confirmMelt).toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("calls rollbackMelt and notifies on success", async () => {
      const { handlers, ops, notifications } = createMockConfig();
      const { mgr } = createManager("meltQuote", handlers, {
        type: "melt",
        quoteId: "q-cancel",
        metadata: { operationId: "melt-op-1" },
      });

      await mgr.execute("cancel");

      expect(ops.rollbackMelt).toHaveBeenCalledWith("melt-op-1");
      expect(notifications).toContainEqual({
        event: "onMeltCancelled",
        args: [{ operationId: "melt-op-1" }],
      });
    });

    it("falls back to quoteId when no operationId", async () => {
      const { handlers, ops } = createMockConfig();
      const { mgr } = createManager("meltQuote", handlers, {
        type: "melt",
        quoteId: "q-fallback",
      });

      await mgr.execute("cancel");
      expect(ops.rollbackMelt).toHaveBeenCalledWith("q-fallback");
    });

    it('silently ignores "not found" errors', async () => {
      const { handlers, notifications } = createMockConfig({
        operations: {
          rollbackMelt: vi.fn(async () => {
            throw new Error("No melt operation found");
          }),
        },
      });

      const { mgr } = createManager("meltQuote", handlers, {
        type: "melt",
        quoteId: "q-gone",
      });

      await mgr.execute("cancel");
      expect(
        notifications.find((n) => n.event === "onMeltCancelFailed"),
      ).toBeFalsy();
    });

    it("notifies on non-ignorable errors", async () => {
      const { handlers, notifications } = createMockConfig({
        operations: {
          rollbackMelt: vi.fn(async () => {
            throw new Error("Network timeout");
          }),
        },
      });

      const { mgr } = createManager("meltQuote", handlers, {
        type: "melt",
        quoteId: "q-err",
      });

      await mgr.execute("cancel");
      expect(
        notifications.find((n) => n.event === "onMeltCancelFailed"),
      ).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// paymentRequest
// ---------------------------------------------------------------------------

describe("paymentRequest default handlers", () => {
  describe("confirm", () => {
    it("delegates to machine.confirmPaymentRequest", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("paymentRequest", handlers, {
        type: "send",
        metadata: { paymentRequest: "pr-1" },
      });

      await mgr.execute("confirm");
      expect(machine.confirmPaymentRequest).toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("calls navigation.goBack", async () => {
      const { handlers, navigation } = createMockConfig();
      const { mgr } = createManager("paymentRequest", handlers, {
        type: "send",
      });

      await mgr.execute("cancel");
      expect(navigation.goBack).toHaveBeenCalled();
    });
  });
});

// The confirm handler driven by the real machine: what the screen entry says
// after each way a payment-request send can end.
describe("paymentRequest confirm outcome on the screen entry", () => {
  const previewEntry = {
    id: "pr-preview-1",
    type: "send",
    amount: 100,
    unit: "sat",
    metadata: { paymentRequest: "creq-1", phase: "preview" },
  };

  async function confirmWith(
    executePaymentRequest: MachineOperations["executePaymentRequest"],
  ) {
    const tm = createTestMachine({ operations: { executePaymentRequest } });
    await tm.machine.execute(INPUTS.paymentRequestBasic, { reset: true });
    tm.assertStep("navigateToPaymentRequest");
    const handlers = createDefaultScreenActionHandlers({
      getMachine: () => tm.machine,
      getOperations: () => ({}),
      notify: () => {},
      navigation: {
        scanQr: vi.fn(),
        nutDrop: vi.fn(),
        mintInfo: vi.fn(),
        addMint: vi.fn(),
        goBack: vi.fn(),
      },
    });
    const { mgr } = createManager("paymentRequest", handlers, previewEntry);
    await mgr.execute("confirm");
    return { tm, mgr };
  }

  it("keeps the preview, with confirm available, when the send fails before any token exists", async () => {
    const execute = vi.fn(async () => {
      throw new AuthoredError("This payment request does not accept that mint");
    });
    const { mgr } = await confirmWith(execute);

    expect(mgr.getEntry()).toEqual(previewEntry);
    expect(mgr.inspect().confirm.available).toBe(true);

    // The person can retry: a second Pay runs the operation again.
    await mgr.execute("confirm");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("says token created but not sent, and offers no retry, when delivery and rollback both failed", async () => {
    const { mgr } = await confirmWith(async () => {
      throw new PaymentRequestUndeliveredError("op-9", new Error("relay down"));
    });

    const entry = mgr.getEntry() as Record<string, any>;
    expect(entry.operationId).toBe("op-9");
    expect(entry.metadata).toMatchObject({
      operationId: "op-9",
      phase: "undelivered",
      tokenCreated: "true",
    });
    expect(entry.metadata.nostrSent).toBeUndefined();
    expect(mgr.inspect().confirm.available).toBe(false);
    expect(mgr.inspect().cancel.available).toBe(false);
  });

  it("marks the entry delivered after a successful send", async () => {
    const { mgr } = await confirmWith(async () => ({
      historyEntry: JSON.stringify({ id: "op-1", type: "send", state: "pending" }),
    }));

    expect(mgr.getEntry()?.metadata).toMatchObject({
      phase: "delivered",
      tokenCreated: "true",
      nostrSent: "true",
    });
    expect(mgr.inspect().confirm.available).toBe(false);
  });

  // The strings the timeline and the payment request screen read.
  it("writes the delivered entry with the preview id as its operation id", async () => {
    const { mgr } = await confirmWith(async () => ({
      historyEntry: JSON.stringify({ id: "op-1", type: "send", state: "pending" }),
    }));

    expect(mgr.getEntry()).toEqual({
      ...previewEntry,
      state: "pending",
      operationId: "pr-preview-1",
      metadata: {
        ...previewEntry.metadata,
        operationId: "pr-preview-1",
        phase: "delivered",
        tokenCreated: "true",
        nostrSent: "true",
      },
    });
    expect(mgr.inspect().cancel.available).toBe(false);
  });

  it("writes the undelivered entry with the operation's id and no sent flag", async () => {
    const { mgr } = await confirmWith(async () => {
      throw new PaymentRequestUndeliveredError("op-9", new Error("relay down"));
    });

    expect(mgr.getEntry()).toEqual({
      ...previewEntry,
      state: "pending",
      operationId: "op-9",
      metadata: {
        ...previewEntry.metadata,
        operationId: "op-9",
        phase: "undelivered",
        tokenCreated: "true",
      },
    });
  });

  it("marks the entry rolled back, with Cancel but no Pay, when the ecash was taken back", async () => {
    const { mgr } = await confirmWith(async () => ({
      historyEntry: JSON.stringify({ id: "op-2", type: "send", state: "rolledBack" }),
      rolledBack: true,
      errorMessage: "relay down",
    }));

    expect(mgr.getEntry()).toEqual({
      ...previewEntry,
      state: "rolledBack",
      operationId: "pr-preview-1",
      metadata: {
        ...previewEntry.metadata,
        operationId: "pr-preview-1",
        phase: "rolledBack",
        tokenCreated: "true",
      },
    });
    expect(mgr.inspect().confirm.available).toBe(false);
    expect(mgr.inspect().cancel.available).toBe(true);
  });

  it("tells a tap locked out by a send in flight that it was ignored", async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.paymentRequestBasic, { reset: true });

    const outcomes = await Promise.all([
      tm.machine.confirmPaymentRequest(),
      tm.machine.confirmPaymentRequest(),
    ]);
    expect(outcomes.map((o) => o.kind)).toEqual(["delivered", "ignored"]);
  });
});

// ---------------------------------------------------------------------------
// receiveHub — the receive modal's method chooser
// ---------------------------------------------------------------------------

describe("receiveHub default handlers", () => {
  const hubEntry = {
    type: "receive",
    id: "receive-hub",
    unit: "sat",
  };

  describe("qrDisplay", () => {
    it("opens the QR display via machine.showReceiveQr with reset", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("receiveHub", handlers, hubEntry);

      await mgr.execute("qrDisplay");
      expect(machine.showReceiveQr).toHaveBeenCalledWith({ reset: true });
    });
  });

  describe("paste", () => {
    it("delegates to machine.scan with reset (fresh flow from the hub)", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("receiveHub", handlers, hubEntry);

      await mgr.execute("paste");
      expect(machine.scan).toHaveBeenCalledWith(undefined, { reset: true });
    });
  });

  describe("fixedAmount", () => {
    it("delegates to machine.startReceiveLightning", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("receiveHub", handlers, hubEntry);

      await mgr.execute("fixedAmount");
      expect(machine.startReceiveLightning).toHaveBeenCalledWith({
        reset: true,
      });
    });
  });

  describe("scanQr", () => {
    it("calls navigation.scanQr with receive context", async () => {
      const { handlers, navigation } = createMockConfig();
      const { mgr } = createManager("receiveHub", handlers, hubEntry);

      await mgr.execute("scanQr");
      expect(navigation.scanQr).toHaveBeenCalledWith({
        unit: "sat",
        context: "receive",
      });
    });
  });

  describe("nutDrop", () => {
    // Pure navigation to the shared radar: the drop is redeemed by the app's
    // own mesh pipeline, so starting a machine flow here would leave a receive
    // operation stranded.
    it("navigates to the shared Nut Drop radar without touching the machine", async () => {
      const { handlers, navigation, machine } = createMockConfig();
      const { mgr } = createManager("receiveHub", handlers, hubEntry);

      await mgr.execute("nutDrop");
      expect(navigation.nutDrop).toHaveBeenCalledWith({ unit: "sat" });
      expect(machine.showReceiveQr).not.toHaveBeenCalled();
      expect(machine.startReceiveLightning).not.toHaveBeenCalled();
      expect(machine.scan).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// receive — the QR display
// ---------------------------------------------------------------------------

describe("receive default handlers", () => {
  const receiveEntry = {
    type: "receive",
    unit: "sat",
    selectedMintUrl: MINT1,
  };

  describe("changeNpcMint", () => {
    it("delegates to machine.requestMintSelector with npc scope", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("receive", handlers, receiveEntry);

      await mgr.execute("changeNpcMint");
      expect(machine.requestMintSelector).toHaveBeenCalledWith({
        scope: "npc",
      });
    });
  });
});

// ---------------------------------------------------------------------------
// mintInfo
// ---------------------------------------------------------------------------

describe("mintInfo default handlers", () => {
  describe("trust", () => {
    it("calls trustMint and notifies", async () => {
      const { handlers, ops, notifications } = createMockConfig();
      const { mgr } = createManager("mintInfo", handlers, {
        mintUrl: MINT1,
        fromAccepter: true,
      });

      await mgr.execute("trust");

      expect(ops.trustMint).toHaveBeenCalledWith(MINT1);
      expect(notifications).toContainEqual({
        event: "onMintTrustedFromScreen",
        args: [{ mintUrl: MINT1, fromAccepter: true }],
      });
    });

    it("sets fromAccepter false when not present", async () => {
      const { handlers, notifications } = createMockConfig();
      const { mgr } = createManager("mintInfo", handlers, {
        mintUrl: MINT1,
      });

      await mgr.execute("trust");

      expect(notifications).toContainEqual({
        event: "onMintTrustedFromScreen",
        args: [{ mintUrl: MINT1, fromAccepter: false }],
      });
    });
  });
});

// ---------------------------------------------------------------------------
// mintSelector
// ---------------------------------------------------------------------------

describe("mintSelector default handlers", () => {
  describe("select", () => {
    it("delegates to machine.changeMint", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("mintSelector", handlers, {
        scope: "selected",
      });

      await mgr.execute("select", { mintUrl: MINT1 });
      expect(machine.changeMint).toHaveBeenCalledWith(MINT1, {
        scope: "selected",
      });
    });
  });

  describe("getInfo", () => {
    it("mintSelector.getInfo navigates before mint info resolves", async () => {
      // Mint info that never arrives on its own: the page must still open.
      let release: () => void = () => {};
      const pending = new Promise((resolve) => {
        release = () => resolve({ mintUrl: MINT1 });
      });
      const { handlers, navigation } = createMockConfig({
        operations: {
          buildMintReviewInfo: vi.fn(
            () => pending,
          ) as unknown as MachineOperations["buildMintReviewInfo"],
        },
      });
      const { mgr } = createManager("mintSelector", handlers, {});
      const item = {
        mintUrl: MINT1,
        displayName: "Mint One",
        iconUrl: "https://mint1.example/icon.png",
        kymScore: 4.2,
        reviewCount: 7,
        auditScore: 4.9,
      };

      // Not awaited: on a handler that waits for the info this would hang.
      const run = mgr.execute("getInfo", { mintUrl: MINT1, item });
      try {
        await vi.waitFor(
          () => expect(navigation.mintInfo).toHaveBeenCalled(),
          { timeout: 500 },
        );
        const parsed = JSON.parse(
          (navigation.mintInfo as MockFn).mock.calls[0][0],
        );
        // Seed keys only, so the page's own NUT-06 read still runs.
        expect(parsed).toEqual({
          mintUrl: MINT1,
          seedDisplayName: "Mint One",
          seedIconUrl: "https://mint1.example/icon.png",
          seedKymScore: 4.2,
          seedReviewCount: 7,
        });
      } finally {
        // Resolve, not reject: a rejected promise nobody awaits fails the run.
        release();
        await run;
      }
    });

    it("navigates with bare mintUrl when buildMintReviewInfo is unavailable", async () => {
      const { handlers, navigation } = createMockConfig({
        operations: { buildMintReviewInfo: undefined },
      });
      const { mgr } = createManager("mintSelector", handlers, {});

      await mgr.execute("getInfo", { mintUrl: MINT1 });

      const call = (navigation.mintInfo as MockFn).mock.calls[0];
      const parsed = JSON.parse(call[0]);
      expect(parsed.mintUrl).toBe(MINT1);
    });
  });

  describe("addMint", () => {
    it("calls navigation.addMint", async () => {
      const { handlers, navigation } = createMockConfig();
      const { mgr } = createManager("mintSelector", handlers, {});

      await mgr.execute("addMint");
      expect(navigation.addMint).toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("calls navigation.goBack", async () => {
      const { handlers, navigation } = createMockConfig();
      const { mgr } = createManager("mintSelector", handlers, {});

      await mgr.execute("cancel");
      expect(navigation.goBack).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// amountEntry
// ---------------------------------------------------------------------------

describe("amountEntry default handlers", () => {
  describe("cancel", () => {
    it("calls navigation.goBack", async () => {
      const { handlers, navigation } = createMockConfig();
      const { mgr } = createManager("amountEntry", handlers, {
        destination: "sendEcash",
      });

      await mgr.execute("cancel");
      expect(navigation.goBack).toHaveBeenCalled();
    });
  });

  describe("next", () => {
    it("delegates to machine.enterAmount", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("amountEntry", handlers, {
        effectiveAmount: { value: 100, unit: "sat" },
        selectedMintUrl: MINT1,
        destination: "sendEcash",
      });

      await mgr.execute("next");
      expect(machine.enterAmount).toHaveBeenCalledWith(
        { value: 100, unit: "sat" },
        MINT1,
        {
          destination: "sendEcash",
          meltTarget: undefined,
          recipientPubkey: undefined,
          recipientProfile: undefined,
          amountEntryDisplay: {
            inputMode: "unit",
            rawInput: "",
            fiatCurrency: null,
            fiatSymbol: null,
            btcPrice: 0,
            displayFiat: null,
            displayAmount: 100,
            unit: "sat",
            autoOptimized: false,
          },
        },
      );
    });

    it("carries amount-entry display metadata to machine.enterAmount", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("amountEntry", handlers, {
        effectiveAmount: { value: 20, unit: "sat" },
        selectedMintUrl: MINT1,
        destination: "sendEcash",
        inputMode: "fiat",
        rawInput: "0.01",
        fiatCurrency: "usd",
        fiatSymbol: "$",
        btcPrice: 47_619,
        displayFiat: 0.01,
        displayAmount: 20,
        autoOptimized: true,
      });

      await mgr.execute("next");
      expect(machine.enterAmount).toHaveBeenCalledWith(
        { value: 20, unit: "sat" },
        MINT1,
        {
          destination: "sendEcash",
          meltTarget: undefined,
          recipientPubkey: undefined,
          recipientProfile: undefined,
          amountEntryDisplay: {
            inputMode: "fiat",
            rawInput: "0.01",
            fiatCurrency: "usd",
            fiatSymbol: "$",
            btcPrice: 47_619,
            displayFiat: 0.01,
            displayAmount: 20,
            unit: "sat",
            autoOptimized: true,
          },
        },
      );
    });

    it("forwards recipientPubkey from the entry to machine.enterAmount", async () => {
      const { handlers, machine } = createMockConfig();
      const recipientPubkey = "a".repeat(64);
      const { mgr } = createManager("amountEntry", handlers, {
        effectiveAmount: { value: 100, unit: "sat" },
        selectedMintUrl: MINT1,
        destination: "sendEcash",
        recipientPubkey,
      });

      await mgr.execute("next");
      expect(machine.enterAmount).toHaveBeenCalledWith(
        { value: 100, unit: "sat" },
        MINT1,
        {
          destination: "sendEcash",
          meltTarget: undefined,
          recipientPubkey,
          amountEntryDisplay: expect.any(Object),
        },
      );
    });

    it("prioritizes per-call recipient identity over entry identity", async () => {
      const { handlers, machine } = createMockConfig();
      const entryProfile = {
        displayName: "Entry Alice",
        avatarUrl: null,
        nip05: "entry@example.com",
      };
      const ctxProfile = {
        displayName: "Fresh Alice",
        avatarUrl: "https://example.com/alice.png",
        nip05: "fresh@example.com",
      };
      const { mgr } = createManager("amountEntry", handlers, {
        effectiveAmount: { value: 100, unit: "sat" },
        selectedMintUrl: MINT1,
        destination: "sendEcash",
        recipientPubkey: "a".repeat(64),
        recipientProfile: entryProfile,
      });

      await mgr.execute("next", {
        recipientPubkey: "b".repeat(64),
        recipientProfile: ctxProfile,
      });

      expect(machine.enterAmount).toHaveBeenCalledWith(
        { value: 100, unit: "sat" },
        MINT1,
        {
          destination: "sendEcash",
          meltTarget: undefined,
          recipientPubkey: "b".repeat(64),
          recipientProfile: ctxProfile,
          amountEntryDisplay: expect.any(Object),
        },
      );
    });

    it("switches send-money to lightning with recipient identity intact", async () => {
      const { handlers, machine } = createMockConfig();
      const recipientProfile = {
        displayName: "Alice",
        avatarUrl: "https://example.com/alice.png",
        nip05: "alice@example.com",
      };
      const recipientPubkey = "a".repeat(64);
      const { mgr } = createManager("amountEntry", handlers, {
        effectiveAmount: { value: 100, unit: "sat" },
        selectedMintUrl: MINT1,
        destination: "sendEcash",
        meltTarget: "alice@example.com",
        recipientPubkey,
        recipientProfile,
      });

      await mgr.execute("next", { variantId: "lightning" });

      expect(machine.enterAmount).toHaveBeenCalledWith(
        { value: 100, unit: "sat" },
        MINT1,
        {
          destination: "meltQuote",
          meltQuoteMethod: "bolt11",
          meltTarget: "alice@example.com",
          recipientPubkey,
          recipientProfile,
          amountEntryDisplay: expect.any(Object),
        },
      );
    });

    it("enters onchain receive from the default next handler (coco v2)", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("amountEntry", handlers, {
        effectiveAmount: { value: 500, unit: "sat" },
        selectedMintUrl: MINT1,
        destination: "mintQuote",
        unit: "sat",
        methodContext: {
          trustedMintUrls: [MINT1],
          mintBalances: { [MINT1]: 0 },
          mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(
            [
              {
                mintUrl: MINT1,
                mintInfo: {
                  nuts: {
                    "4": {
                      methods: [
                        { method: "bolt11", unit: "sat", min_amount: 1 },
                        // 500 sat clears the onchain minimum — bounds gating has
                        // its own tests; this one exercises the happy-path handler.
                        { method: "onchain", unit: "sat", min_amount: 100 },
                      ],
                    },
                  },
                },
              },
            ],
          ),
        },
      });

      await mgr.execute("next", { variantId: "onchain" });

      expect(machine.enterAmount).toHaveBeenCalledWith(
        { value: 500, unit: "sat" },
        MINT1,
        expect.objectContaining({
          destination: "mintQuote",
          mintQuoteMethod: "onchain",
        }),
      );
    });

    it("enters onchain receive when an alternate mint also advertises it (coco v2)", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("amountEntry", handlers, {
        effectiveAmount: { value: 500, unit: "sat" },
        selectedMintUrl: MINT1,
        destination: "mintQuote",
        unit: "sat",
        methodContext: {
          trustedMintUrls: [MINT1, MINT2],
          mintBalances: { [MINT1]: 0, [MINT2]: 0 },
          mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(
            [
              {
                mintUrl: MINT1,
                mintInfo: {
                  nuts: {
                    "4": {
                      methods: [
                        { method: "bolt11", unit: "sat", min_amount: 1 },
                        { method: "onchain", unit: "sat", min_amount: 1_000 },
                      ],
                    },
                  },
                },
              },
              {
                mintUrl: MINT2,
                mintInfo: {
                  nuts: {
                    "4": {
                      methods: [
                        { method: "onchain", unit: "sat", min_amount: 100 },
                      ],
                    },
                  },
                },
              },
            ],
          ),
        },
      });

      await mgr.execute("next", { variantId: "onchain" });

      expect(machine.enterAmount).toHaveBeenCalledWith(
        { value: 500, unit: "sat" },
        MINT1,
        expect.objectContaining({
          destination: "mintQuote",
          mintQuoteMethod: "onchain",
        }),
      );
    });

    it("does nothing when effectiveSatAmount is 0", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("amountEntry", handlers, {
        effectiveAmount: { value: 0, unit: "sat" },
        selectedMintUrl: MINT1,
        destination: "sendEcash",
      });

      await mgr.execute("next");
      expect(machine.enterAmount).not.toHaveBeenCalled();
    });

    it("does nothing without destination", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("amountEntry", handlers, {
        effectiveAmount: { value: 100, unit: "sat" },
        selectedMintUrl: MINT1,
      });

      await mgr.execute("next");
      expect(machine.enterAmount).not.toHaveBeenCalled();
    });
  });

  // ── Receive "as Ecash" (Fixed Amount → Next → as Ecash) ────────────────
  //
  // The receive-side ecash variant drives the machine into its own lane
  // (destination 'receivePaymentRequest' → createPaymentRequestReceive →
  // paymentRequestReceived) so its display screen is reached by a machine step
  // handler — NOT a side-channel navigation callback. These lock that the
  // handler hands off to the machine with the receive-request destination (the
  // app bug where "as Ecash" did nothing traced to a navigate() no-op that the
  // machine lane replaces).
  describe('next — receive "as Ecash" (mintQuote + ecash variant)', () => {
    const bolt11MintContext = {
      trustedMintUrls: [MINT1],
      mintBalances: { [MINT1]: 0 },
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
        {
          mintUrl: MINT1,
          mintInfo: {
            nuts: { "4": { methods: [{ method: "bolt11", unit: "sat" }] } },
          },
        },
      ]),
    };

    function ecashReceiveEntry() {
      return {
        effectiveAmount: { value: 100, unit: "sat" },
        selectedMintUrl: MINT1,
        destination: "mintQuote",
        unit: "sat",
        methodContext: bolt11MintContext,
      };
    }

    it("hands off to the machine with the receivePaymentRequest destination", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager(
        "amountEntry",
        handlers,
        ecashReceiveEntry(),
      );

      await mgr.execute("next", { variantId: "ecash" });

      expect(machine.enterAmount).toHaveBeenCalledWith(
        { value: 100, unit: "sat" },
        MINT1,
        expect.objectContaining({ destination: "receivePaymentRequest" }),
      );
    });

    it("does not carry a mint-quote/melt method into the receive-request lane", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager(
        "amountEntry",
        handlers,
        ecashReceiveEntry(),
      );

      await mgr.execute("next", { variantId: "ecash" });

      const opts = (machine.enterAmount as MockFn).mock.calls[0][2] as Record<
        string,
        unknown
      >;
      expect(opts.mintQuoteMethod).toBeUndefined();
      expect(opts.meltQuoteMethod).toBeUndefined();
    });

    it("does nothing when the effective amount is zero (gate closed)", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("amountEntry", handlers, {
        ...ecashReceiveEntry(),
        effectiveAmount: { value: 0, unit: "sat" },
      });

      await mgr.execute("next", { variantId: "ecash" });

      expect(machine.enterAmount).not.toHaveBeenCalled();
    });
  });

  describe("paste", () => {
    it("delegates to machine.scan for sendEcash", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("amountEntry", handlers, {
        destination: "sendEcash",
      });

      await mgr.execute("paste");
      expect(machine.scan).toHaveBeenCalled();
    });

    it("delegates to machine.scan for meltQuote", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("amountEntry", handlers, {
        destination: "meltQuote",
      });

      await mgr.execute("paste");
      expect(machine.scan).toHaveBeenCalled();
    });

    it("does nothing for receive destinations", async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager("amountEntry", handlers, {
        destination: "mintQuote",
      });

      await mgr.execute("paste");
      expect(machine.scan).not.toHaveBeenCalled();
    });
  });

  describe("scanQr", () => {
    it("calls navigation.scanQr for sendEcash", async () => {
      const { handlers, navigation } = createMockConfig();
      const { mgr } = createManager("amountEntry", handlers, {
        destination: "sendEcash",
        unit: "sat",
      });

      await mgr.execute("scanQr");
      expect(navigation.scanQr).toHaveBeenCalledWith({
        unit: "sat",
        context: "amount",
      });
    });

    it("calls navigation.scanQr for meltQuote", async () => {
      const { handlers, navigation } = createMockConfig();
      const { mgr } = createManager("amountEntry", handlers, {
        destination: "meltQuote",
        unit: "sat",
      });

      await mgr.execute("scanQr");
      expect(navigation.scanQr).toHaveBeenCalledWith({
        unit: "sat",
        context: "amount",
      });
    });

    it("does nothing for receive destinations", async () => {
      const { handlers, navigation } = createMockConfig();
      const { mgr } = createManager("amountEntry", handlers, {
        destination: "mintQuote",
        unit: "sat",
      });

      await mgr.execute("scanQr");
      expect(navigation.scanQr).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Three-tier fallback
// ---------------------------------------------------------------------------

describe("three-tier fallback", () => {
  it("wallet override takes priority over default handler", async () => {
    const walletHandler = vi.fn();
    const { handlers } = createMockConfig();

    let mgrRef: ScreenActionManager<"mintInfo"> | null = null;
    const mgr: ScreenActionManager<"mintInfo"> = createScreenActionManager({
      screenType: "mintInfo",
      handlers: { trust: walletHandler },
      defaultHandlers: handlers.mintInfo,
      getContext: (): ScreenActionContext => ({
        entry: mgrRef?.getEntry() ?? {},
        manager: null,
        setEntry: () => {},
      }),
    });
    mgrRef = mgr;
    mgr.setEntry({ mintUrl: MINT1 });

    await mgr.execute("trust");

    expect(walletHandler).toHaveBeenCalled();
  });

  it("default handler is used when no wallet handler exists", async () => {
    const { handlers, ops } = createMockConfig();

    let mgrRef: ScreenActionManager<"mintInfo"> | null = null;
    const mgr: ScreenActionManager<"mintInfo"> = createScreenActionManager({
      screenType: "mintInfo",
      handlers: {},
      defaultHandlers: handlers.mintInfo,
      getContext: (): ScreenActionContext => ({
        entry: mgrRef?.getEntry() ?? {},
        manager: null,
        setEntry: () => {},
      }),
    });
    mgrRef = mgr;
    mgr.setEntry({ mintUrl: MINT1 });

    await mgr.execute("trust");

    expect(ops.trustMint).toHaveBeenCalledWith(MINT1);
  });
});

// ---------------------------------------------------------------------------
// The amount screen of an ecash send that finished
// ---------------------------------------------------------------------------

// The token screen sits over the amount screen that made it. Going Back and
// entering another amount, or choosing a mint there, is a new token the
// person asked for: it starts a new send, and the finished one stays as it
// is (`settled-preview-final.test.ts` pins that a bare amount or mint on it
// changes nothing).
describe("amount screen after its ecash send finished", () => {
  const sends = (tm: ReturnType<typeof createTestMachine>) =>
    tm.operationCalls.filter(
      (call) => call.name === "executeSend" || call.name === "executeOfflineSend",
    );

  function amountScreen(
    tm: ReturnType<typeof createTestMachine>,
    entry: Record<string, unknown> = {},
  ) {
    const handlers = createDefaultScreenActionHandlers({
      getMachine: () => tm.machine,
      getOperations: () => undefined,
      notify: () => {},
      navigation: { goBack: vi.fn() },
    });
    const enter = async (value: number) => {
      const { mgr } = createManager("amountEntry", handlers, {
        destination: "sendEcash",
        unit: "sat",
        selectedMintUrl: MINT1,
        effectiveAmount: { value, unit: "sat" },
        ...entry,
      });
      await mgr.execute("next");
    };
    return { enter };
  }

  it("sends a new token for the amount entered after Back", async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash({ reset: true });
    const screen = amountScreen(tm);
    await screen.enter(100);
    tm.assertStep("sendComplete");

    await screen.enter(40);

    tm.assertStep("sendComplete");
    expect(sends(tm).map((call) => (call.args[0] as { amount: number }).amount)).toEqual([
      100, 40,
    ]);
  });

  it("keeps the recipient's mints and lock, and nothing of the old payment", async () => {
    const lock = `02${"ab".repeat(32)}`;
    const tm = createTestMachine();
    await tm.machine.startSendEcash({
      reset: true,
      allowedMints: [MINT2],
      p2pkLockPubkey: lock,
    });
    const screen = amountScreen(tm, {
      selectedMintUrl: MINT2,
      p2pkLockPubkey: lock,
    });
    await screen.enter(100);
    tm.assertStep("sendComplete");

    await screen.enter(40);

    tm.assertStep("sendComplete");
    expect(sends(tm)[1]?.args[0]).toMatchObject({
      mintUrl: MINT2,
      amount: 40,
      p2pkLock: { pubkey: lock },
    });
    expect(tm.machine.getContext().supportedMintUrls).toEqual([MINT2]);
  });

  it("opens the mint list of a new send from the amount screen", async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash({ reset: true });
    await amountScreen(tm).enter(100);
    tm.assertStep("sendComplete");

    await startNewEcashSendIfFinished(tm.machine, "sendEcash");
    await tm.machine.requestMintSelector();

    tm.assertStep("selectMint");
    tm.assertContext({ destination: "sendEcash" });
    expect(tm.machine.getContext().amount).toBeUndefined();
    expect(sends(tm)).toHaveLength(1);
  });

  it("leaves a send that has not finished alone", async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash({ reset: true, entrySource: "createEcash" });
    const context = tm.machine.getContext();

    await startNewEcashSendIfFinished(tm.machine, "sendEcash");

    expect(tm.machine.getContext()).toBe(context);
  });
});

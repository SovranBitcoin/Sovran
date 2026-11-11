/**
 * `useScreenActions` mounted as a screen mounts it: the provider context is
 * the only thing replaced. For each post-payment screen and entry state it
 * pins which actions are offered, and what pressing each one calls on the
 * wallet's operations, payment machine, navigation, clipboard, share sheet
 * and notifications. Also what the hook does when its entry changes, when a
 * history update arrives, and on unmount.
 */
import { getEncodedToken } from "@cashu/cashu-ts";
import { createRequire } from "node:module";
import {
  act,
  createElement,
  useContext,
  createContext,
  type ReactElement,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSubscriptionBus } from "../../src/subscriptions";
import type { ScreenType } from "../../src/screen-actions/types";
import {
  useScreenActions,
  type BoundAction,
} from "../../src/react/useScreenActions";

interface TestRoot {
  update: (element: ReactElement) => void;
  unmount: () => void;
}
const { create }: { create: (element: ReactElement) => TestRoot } =
  createRequire(new URL("../../../app/package.json", import.meta.url))(
    "react-test-renderer",
  );

const providerContext = createContext<Record<string, unknown> | null>(null);
vi.mock("../../src/react/ColadaProvider", () => ({
  useColadaContext: () => useContext(providerContext),
}));

const MINT_URL = "https://mint.example";
const TOKEN = {
  mint: MINT_URL,
  unit: "sat",
  proofs: [
    {
      id: "009a1f293253e41e",
      amount: 8,
      secret: "send-secret",
      C: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
  ],
};
const ENCODED = getEncodedToken(TOKEN as never);

function walletFixture(options: { offline?: boolean } = {}) {
  const bus = createSubscriptionBus();
  const entryUpdateListeners = new Set<
    (entry: Record<string, unknown>) => void
  >();
  const unsubscribeEntryUpdates = vi.fn();
  const operations = {
    rollbackSend: vi.fn(async () => ({ kind: "reclaimed" as const })),
    checkSendStatus: vi.fn(async () => ({ state: "finalized" })),
    rollbackMelt: vi.fn(async () => {}),
    isMintTrusted: vi.fn(async () => true),
    executeReceive: vi.fn(async () => ({
      status: "finalized" as const,
      historyEntry: JSON.stringify({
        id: "receive:op-1",
        type: "receive",
        state: "finalized",
        mintUrl: MINT_URL,
        amount: 8,
        operationId: "op-1",
      }),
      hadP2PKProofs: false,
    })),
    linkTransaction: vi.fn(),
  };
  const machine = {
    getContext: vi.fn(() => ({ rawInput: "scanned-raw", source: "scan" })),
    reviewMint: vi.fn(async () => {}),
    confirmMelt: vi.fn(async () => {}),
    confirmPaymentRequest: vi.fn(async () => ({ kind: "delivered" })),
  };
  const navigation = { goBack: vi.fn() };
  const notifications = {
    onCopied: vi.fn(),
    onShared: vi.fn(),
    onSendCancelled: vi.fn(),
    onSendCancelFailed: vi.fn(),
    onSendStatusChecked: vi.fn(),
    onReceiveProcessing: vi.fn(),
    onReceiveConfirmed: vi.fn(),
    onTransactionCreated: vi.fn(),
    onMeltCancelled: vi.fn(),
  };
  const writeClipboard = vi.fn(async (_text: string) => {});
  const shareContent = vi.fn(async (_content: unknown) => {});
  const walletHandlers: Record<string, Record<string, unknown>> = {};
  const value = {
    machine,
    walletContextSource: undefined,
    walletContextRef: { current: undefined },
    screenActionHandlers: walletHandlers,
    screenActionsBridge: {
      subscribeEntryUpdates: (
        _type: ScreenType,
        callback: (entry: Record<string, unknown>) => void,
      ) => {
        entryUpdateListeners.add(callback);
        return () => {
          entryUpdateListeners.delete(callback);
          unsubscribeEntryUpdates();
        };
      },
    },
    getLocaleRef: { current: () => "en" },
    getOfflineRef: { current: () => options.offline ?? false },
    getBtcPriceRef: { current: undefined },
    getDisplayCurrencyRef: { current: undefined },
    adaptersRef: { current: undefined },
    subscriptionBusRef: { current: bus },
    notificationsRef: { current: notifications },
    operationsRef: { current: operations },
    navigationRef: { current: navigation },
    writeClipboardRef: { current: writeClipboard },
    shareContentRef: { current: shareContent },
  };
  return {
    value,
    walletHandlers,
    operations,
    machine,
    navigation,
    notifications,
    writeClipboard,
    shareContent,
    unsubscribeEntryUpdates,
    pushEntryUpdate: (entry: Record<string, unknown>) => {
      for (const listener of [...entryUpdateListeners]) listener(entry);
    },
  };
}

type Mounted = {
  current: {
    actions: unknown;
    entry: unknown;
    error: string | null;
    mintUrl: string | undefined;
  } | null;
  root: TestRoot;
  rerender: (entry: Record<string, unknown> | string | undefined) => void;
};

const roots: TestRoot[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
});

async function mount(
  wallet: ReturnType<typeof walletFixture>,
  screenType: Exclude<ScreenType, "amountEntry">,
  entry: Record<string, unknown> | string | undefined,
): Promise<Mounted> {
  const mounted = { current: null } as Mounted;
  function Probe(props: {
    entry: Record<string, unknown> | string | undefined;
  }) {
    mounted.current = useScreenActions(screenType as "sendToken", props.entry);
    return null;
  }
  const tree = (e: Record<string, unknown> | string | undefined) =>
    createElement(
      providerContext.Provider,
      { value: wallet.value },
      createElement(Probe, { entry: e }),
    );
  await act(async () => {
    mounted.root = create(tree(entry));
  });
  roots.push(mounted.root);
  mounted.rerender = (e) => mounted.root.update(tree(e));
  return mounted;
}

function offered(mounted: Mounted): string[] {
  const actions = mounted.current!.actions as Record<string, BoundAction>;
  return Object.entries(actions)
    .filter(([, state]) => state.available)
    .map(([name]) => name)
    .sort();
}

async function press(mounted: Mounted, action: string) {
  const actions = mounted.current!.actions as Record<string, BoundAction>;
  await act(async () => actions[action]!.execute());
}

const sendEntry = (fields: Record<string, unknown> = {}) => ({
  id: "send:op-1",
  type: "send",
  mintUrl: MINT_URL,
  amount: 8,
  unit: "sat",
  operationId: "op-1",
  state: "pending",
  token: TOKEN,
  ...fields,
});

const meltEntry = (fields: Record<string, unknown> = {}) => ({
  id: "op-9",
  type: "melt",
  mintUrl: MINT_URL,
  amount: 10,
  quoteId: "quote-9",
  state: "UNPAID",
  metadata: { operationId: "op-9" },
  ...fields,
});

describe("which actions each screen offers for each entry state", () => {
  it.each<[string, ScreenType, Record<string, unknown>, string[]]>([
    [
      "a pending send",
      "sendToken",
      sendEntry(),
      ["back", "cancel", "checkStatus", "copy", "nfc", "share"],
    ],
    [
      "a prepared send",
      "sendToken",
      sendEntry({ state: "prepared" }),
      ["back", "cancel", "copy", "nfc", "share"],
    ],
    [
      "a finalized send",
      "sendToken",
      sendEntry({ state: "finalized" }),
      ["back"],
    ],
    [
      "a rolled-back send",
      "sendToken",
      sendEntry({ state: "rolledBack" }),
      ["back"],
    ],
    [
      "a pending send with no operation id",
      "sendToken",
      sendEntry({ operationId: undefined }),
      ["back", "checkStatus", "copy", "nfc", "share"],
    ],
    [
      "a scanned token not yet redeemed",
      "receiveToken",
      {
        id: "receive-scan",
        type: "receive",
        mintUrl: MINT_URL,
        metadata: { rawToken: ENCODED },
      },
      ["back", "redeem"],
    ],
    [
      "a scanned token whose redeem is pending",
      "receiveToken",
      {
        id: "receive-scan",
        state: "executing",
        mintUrl: MINT_URL,
        metadata: { rawToken: ENCODED },
      },
      ["back"],
    ],
    // QUIRK: whether a receive counts as already redeemed comes only from the
    // id: anything not starting "receive-" is treated as redeemed, so a failed
    // (rolled back) Coco receive row offers no Redeem.
    [
      "a rolled-back Coco receive row",
      "receiveToken",
      {
        id: "receive:op-2",
        state: "rolled_back",
        mintUrl: MINT_URL,
        metadata: { rawToken: ENCODED },
      },
      ["back"],
    ],
    [
      "an unpaid mint quote",
      "mintQuote",
      {
        id: "mint:op",
        type: "mint",
        state: "UNPAID",
        paymentRequest: "lnbc1invoice",
      },
      ["back", "copy", "share"],
    ],
    [
      "an issued mint quote",
      "mintQuote",
      {
        id: "mint:op",
        type: "mint",
        state: "ISSUED",
        paymentRequest: "lnbc1invoice",
      },
      ["back"],
    ],
    [
      "an unpaid melt quote",
      "meltQuote",
      meltEntry(),
      ["back", "cancel", "pay"],
    ],
    // QUIRK: Cancel is offered on a PENDING melt, whose payment may already be
    // in flight at the mint.
    [
      "a pending melt",
      "meltQuote",
      meltEntry({ state: "PENDING" }),
      ["back", "cancel"],
    ],
    ["a paid melt", "meltQuote", meltEntry({ state: "PAID" }), ["back"]],
    [
      "a melt preview with no quote yet",
      "meltQuote",
      meltEntry({ quoteId: undefined }),
      ["back", "pay"],
    ],
    [
      "a payment request preview",
      "paymentRequest",
      { id: "pr-1", metadata: { phase: "preview" } },
      ["back", "cancel", "confirm"],
    ],
    [
      "a delivered payment request",
      "paymentRequest",
      { id: "pr-1", operationId: "op-3", metadata: { phase: "delivered" } },
      ["back"],
    ],
  ])("%s", async (_label, screenType, entry, expected) => {
    const wallet = walletFixture();
    const mounted = await mount(
      wallet,
      screenType as Exclude<ScreenType, "amountEntry">,
      entry,
    );
    expect(offered(mounted)).toEqual(expected);
    expect(mounted.current!.error).toBeNull();
  });

  it("explains why Cancel is off on a send with no operation id", async () => {
    const mounted = await mount(
      walletFixture(),
      "sendToken",
      sendEntry({ operationId: undefined }),
    );
    expect(
      (mounted.current!.actions as Record<string, BoundAction>).cancel,
    ).toMatchObject({
      available: false,
      reason: "Missing operation ID — cannot cancel",
    });
  });
});

describe("what pressing each action calls", () => {
  it("send Copy writes the encoded token and reports it", async () => {
    const wallet = walletFixture();
    const mounted = await mount(wallet, "sendToken", sendEntry());
    await press(mounted, "copy");
    expect(wallet.writeClipboard).toHaveBeenCalledExactlyOnceWith(ENCODED);
    expect(wallet.notifications.onCopied).toHaveBeenCalledWith(
      "token",
      ENCODED,
    );
  });

  it("send Share opens the share sheet with a cashu:// link", async () => {
    const wallet = walletFixture();
    const mounted = await mount(wallet, "sendToken", sendEntry());
    await press(mounted, "share");
    expect(wallet.shareContent).toHaveBeenCalledExactlyOnceWith({
      message: ENCODED,
      url: `cashu://${ENCODED}`,
    });
    expect(wallet.notifications.onShared).toHaveBeenCalledWith(
      "token",
      ENCODED,
    );
  });

  it("send Check status asks the wallet and reports whether it was redeemed", async () => {
    const wallet = walletFixture();
    const mounted = await mount(wallet, "sendToken", sendEntry());
    await press(mounted, "checkStatus");
    expect(wallet.operations.checkSendStatus).toHaveBeenCalledExactlyOnceWith(
      "op-1",
    );
    expect(wallet.notifications.onSendStatusChecked).toHaveBeenCalledWith({
      operationId: "op-1",
      state: "finalized",
      redeemed: true,
    });
  });

  it("send Cancel rolls the send back by operation id", async () => {
    const wallet = walletFixture();
    const mounted = await mount(wallet, "sendToken", sendEntry());
    await press(mounted, "cancel");
    expect(wallet.operations.rollbackSend).toHaveBeenCalledExactlyOnceWith(
      "op-1",
    );
    expect(wallet.notifications.onSendCancelled).toHaveBeenCalledWith({
      operationId: "op-1",
    });
  });

  it("send Cancel while offline refuses a pending send but releases a prepared one", async () => {
    const wallet = walletFixture({ offline: true });
    const pending = await mount(wallet, "sendToken", sendEntry());
    await press(pending, "cancel");
    expect(wallet.operations.rollbackSend).not.toHaveBeenCalled();
    expect(wallet.notifications.onSendCancelFailed).toHaveBeenCalledWith({
      operationId: "op-1",
      message: "Cancel transaction is not possible while offline.",
      offline: true,
    });

    const prepared = await mount(
      wallet,
      "sendToken",
      sendEntry({ state: "prepared" }),
    );
    await press(prepared, "cancel");
    expect(wallet.operations.rollbackSend).toHaveBeenCalledExactlyOnceWith(
      "op-1",
    );
  });

  it("a wallet-registered handler replaces the default one", async () => {
    const wallet = walletFixture();
    const walletCancel = vi.fn();
    wallet.walletHandlers.sendToken = { cancel: walletCancel };
    const mounted = await mount(wallet, "sendToken", sendEntry());
    await press(mounted, "cancel");
    expect(walletCancel).toHaveBeenCalledTimes(1);
    expect(walletCancel.mock.calls[0]![0]).toMatchObject({
      entry: expect.objectContaining({ operationId: "op-1" }),
    });
    expect(wallet.operations.rollbackSend).not.toHaveBeenCalled();
  });

  it("Redeem on a trusted mint receives the scanned token and swaps in Coco's row", async () => {
    const wallet = walletFixture();
    const mounted = await mount(wallet, "receiveToken", {
      id: "receive-scan",
      type: "receive",
      mintUrl: MINT_URL,
      amount: 8,
      unit: "sat",
      metadata: { rawToken: ENCODED },
    });
    await press(mounted, "redeem");

    expect(wallet.notifications.onReceiveProcessing).toHaveBeenCalledWith({
      id: "receive-scan",
      mintUrl: MINT_URL,
      amount: 8,
      unit: "sat",
    });
    expect(wallet.operations.executeReceive).toHaveBeenCalledExactlyOnceWith({
      tokenString: ENCODED,
      mintUrl: MINT_URL,
      amount: 8,
    });
    expect(wallet.operations.linkTransaction).toHaveBeenCalledWith({
      scannedInput: "scanned-raw",
      transactionId: "receive:op-1",
    });
    expect(wallet.notifications.onTransactionCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: "receive:op-1",
        type: "receive",
      }),
    );
    expect(mounted.current!.entry).toMatchObject({
      id: "receive:op-1",
      state: "finalized",
    });
    expect(offered(mounted)).toEqual(["back"]);
  });

  it("Redeem on an untrusted mint opens the mint review instead of receiving", async () => {
    const wallet = walletFixture();
    wallet.operations.isMintTrusted.mockResolvedValue(false);
    const mounted = await mount(wallet, "receiveToken", {
      id: "receive-scan",
      mintUrl: MINT_URL,
      metadata: { rawToken: ENCODED },
    });
    await press(mounted, "redeem");
    expect(wallet.machine.reviewMint).toHaveBeenCalledExactlyOnceWith(
      MINT_URL,
      ENCODED,
    );
    expect(wallet.operations.executeReceive).not.toHaveBeenCalled();
  });

  it("mint quote Copy writes the invoice", async () => {
    const wallet = walletFixture();
    const mounted = await mount(wallet, "mintQuote", {
      id: "mint:op",
      state: "UNPAID",
      paymentRequest: "lnbc1invoice",
    });
    await press(mounted, "copy");
    expect(wallet.writeClipboard).toHaveBeenCalledExactlyOnceWith(
      "lnbc1invoice",
    );
    expect(wallet.notifications.onCopied).toHaveBeenCalledWith(
      "lightningInvoice",
      "lnbc1invoice",
    );
  });

  it("melt Pay confirms the melt on the payment machine", async () => {
    const wallet = walletFixture();
    const mounted = await mount(wallet, "meltQuote", meltEntry());
    await press(mounted, "pay");
    expect(wallet.machine.confirmMelt).toHaveBeenCalledTimes(1);
  });

  it("melt Cancel rolls back the melt operation named in metadata", async () => {
    const wallet = walletFixture();
    const mounted = await mount(
      wallet,
      "meltQuote",
      meltEntry({ state: "PENDING" }),
    );
    await press(mounted, "cancel");
    expect(wallet.operations.rollbackMelt).toHaveBeenCalledExactlyOnceWith(
      "op-9",
    );
    expect(wallet.notifications.onMeltCancelled).toHaveBeenCalledWith({
      operationId: "op-9",
    });
  });

  it("payment request Confirm pays it and marks the entry delivered", async () => {
    const wallet = walletFixture();
    const mounted = await mount(wallet, "paymentRequest", {
      id: "pr-1",
      metadata: { phase: "preview" },
    });
    await press(mounted, "confirm");
    expect(wallet.machine.confirmPaymentRequest).toHaveBeenCalledTimes(1);
    expect(mounted.current!.entry).toMatchObject({
      state: "pending",
      operationId: "pr-1",
      metadata: { phase: "delivered", nostrSent: "true", tokenCreated: "true" },
    });
    expect(offered(mounted)).toEqual(["back"]);
  });

  it("payment request Confirm that rolled back marks the entry rolled back", async () => {
    const wallet = walletFixture();
    wallet.machine.confirmPaymentRequest.mockResolvedValue({
      kind: "rolledBack",
    });
    const mounted = await mount(wallet, "paymentRequest", {
      id: "pr-1",
      metadata: { phase: "preview" },
    });
    await press(mounted, "confirm");
    expect(mounted.current!.entry).toMatchObject({
      state: "rolledBack",
      metadata: { phase: "rolledBack" },
    });
  });

  it.each<Exclude<ScreenType, "amountEntry">>([
    "sendToken",
    "receiveToken",
    "mintQuote",
    "meltQuote",
    "paymentRequest",
  ])("%s Back goes back", async (screenType) => {
    const wallet = walletFixture();
    const mounted = await mount(wallet, screenType, { id: "x" });
    await press(mounted, "back");
    expect(wallet.navigation.goBack).toHaveBeenCalledTimes(1);
  });
});

describe("entry lifecycle", () => {
  it("parses a JSON route param and reports missing or broken data as an error", async () => {
    const parsed = await mount(
      walletFixture(),
      "sendToken",
      JSON.stringify(sendEntry()),
    );
    expect(parsed.current!.entry).toMatchObject({ id: "send:op-1" });
    expect(parsed.current!.mintUrl).toBe(MINT_URL);

    const missing = await mount(walletFixture(), "sendToken", undefined);
    expect(missing.current!.error).toBe(
      "Missing transaction data. Please try again.",
    );

    const broken = await mount(walletFixture(), "sendToken", "{not json");
    expect(broken.current!.error).toBe(
      "Invalid transaction data. Please try again.",
    );
  });

  it("follows a new route param and a history update for the same send", async () => {
    const wallet = walletFixture();
    const mounted = await mount(wallet, "sendToken", sendEntry());
    expect(offered(mounted)).toContain("checkStatus");

    await act(async () => mounted.rerender(sendEntry({ state: "prepared" })));
    expect(offered(mounted)).not.toContain("checkStatus");
    expect(offered(mounted)).toContain("cancel");

    await act(async () =>
      wallet.pushEntryUpdate({ ...sendEntry(), state: "finalized" }),
    );
    expect(mounted.current!.entry).toMatchObject({ state: "finalized" });
    expect(offered(mounted)).toEqual(["back"]);
  });

  it("ignores a history update for another operation", async () => {
    const wallet = walletFixture();
    const mounted = await mount(wallet, "sendToken", sendEntry());
    await act(async () =>
      wallet.pushEntryUpdate(
        sendEntry({ id: "send:op-2", operationId: "op-2", state: "finalized" }),
      ),
    );
    expect(mounted.current!.entry).toMatchObject({ state: "pending" });
  });

  it("stops listening for history updates on unmount", async () => {
    const wallet = walletFixture();
    const mounted = await mount(wallet, "sendToken", sendEntry());
    await act(async () => mounted.root.unmount());
    roots.splice(roots.indexOf(mounted.root), 1);
    expect(wallet.unsubscribeEntryUpdates).toHaveBeenCalledTimes(1);
  });
});

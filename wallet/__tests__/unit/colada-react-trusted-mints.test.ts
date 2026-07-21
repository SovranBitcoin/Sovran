import { describe, expect, it, vi } from "vitest";

import type { WalletContext } from "../../src/types";
import { createColadaTrustedMintUrlsStore } from "../../src/react/ColadaProvider";

const MINT_ONE = "https://mint.one";
const MINT_TWO = "https://mint.two";

function walletContext(trustedMintUrls: string[]): WalletContext {
  return {
    trustedMintUrls,
    mintBalances: {},
    proofAmounts: {},
  };
}

describe("createColadaTrustedMintUrlsStore", () => {
  it("follows source emissions and returns its subscription cleanup", () => {
    let context = walletContext([MINT_ONE]);
    const listeners = new Set<() => void>();
    const getWalletContext = vi.fn(() => context);
    const subscribeWalletContext = vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    const source = {
      getWalletContext,
      subscribeWalletContext,
    };
    const store = createColadaTrustedMintUrlsStore(source);
    const notified = vi.fn();
    const unsubscribe = store.subscribe(notified);

    expect(store.getSnapshot()).toEqual([MINT_ONE]);
    expect(listeners.size).toBe(1);

    context = walletContext([MINT_ONE, MINT_TWO]);
    listeners.forEach((listener) => listener());
    expect(notified).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual([MINT_ONE, MINT_TWO]);

    unsubscribe();
    expect(listeners.size).toBe(0);
    listeners.forEach((listener) => listener());
    expect(notified).toHaveBeenCalledTimes(1);
  });
});

/**
 * Screen-entry decoration encodes the entry's structured token for display and
 * export. Malformed proof hex must leave the token unexported, never throw.
 */

import { Amount, getEncodedToken } from "@cashu/cashu-ts";
import { describe, expect, it } from "vitest";

import { decorateEntry } from "../../src/screen-actions/createManager";

function entry(proofOverrides: Record<string, unknown> = {}) {
  const proof = {
    amount: Amount.from(2),
    id: "009a1f293253e41e",
    secret: "11".repeat(32),
    C: `02${"ef".repeat(32)}`,
    ...proofOverrides,
  };
  return {
    id: "send-1",
    type: "send",
    token: { mint: "https://mint.test", unit: "sat", proofs: [proof] },
  };
}

describe("decorateEntry token export", () => {
  it("formats a well-formed token", () => {
    const raw = entry();
    const decorated = decorateEntry(raw, "en");
    expect(String(decorated?.tokenString)).toBe(
      getEncodedToken(raw.token as never),
    );
  });

  it.each([
    ["id", "error"],
    ["id", "12345"],
    ["C", "false"],
    ["C", "12345"],
    ["dleq", { e: "12345", s: "aa".repeat(32), r: "bb".repeat(32) }],
  ])("leaves tokenString empty for a malformed %s", (key, value) => {
    const raw = entry({ [key]: value });
    const before = JSON.stringify(raw);
    let decorated: ReturnType<typeof decorateEntry> = null;
    expect(() => {
      decorated = decorateEntry(raw, "en");
    }).not.toThrow();
    expect(decorated).toMatchObject({ tokenString: null });
    expect(JSON.stringify(raw)).toBe(before);
  });
});

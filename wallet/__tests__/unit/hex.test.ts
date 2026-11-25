/**
 * hex.ts and the checked token encoder: odd-length or non-hex strings must be
 * refused before they reach a hex decoder ("hex string expected, got unpadded
 * hex of length 5").
 */

import { Amount, getDecodedToken, getEncodedToken } from "@cashu/cashu-ts";
import { describe, expect, it } from "vitest";

import { encodeTokenChecked, isEvenHex, isFixedHex } from "../../src";

const MALFORMED = ["error", "false", "12345"];

describe("isFixedHex", () => {
  it("accepts hex of exactly the byte length, either case", () => {
    expect(isFixedHex("ab".repeat(32), 32)).toBe(true);
    expect(isFixedHex("AB".repeat(32), 32)).toBe(true);
    expect(isFixedHex(`02${"cd".repeat(32)}`, 33)).toBe(true);
  });

  it.each(MALFORMED)("rejects %s", (value) => {
    expect(isFixedHex(value, 32)).toBe(false);
  });

  it("rejects the wrong length, non-strings and non-hex", () => {
    expect(isFixedHex("ab".repeat(31), 32)).toBe(false);
    expect(isFixedHex(`${"ab".repeat(32)}a`, 32)).toBe(false);
    expect(isFixedHex("zz".repeat(32), 32)).toBe(false);
    expect(isFixedHex(undefined, 32)).toBe(false);
    expect(isFixedHex(42, 32)).toBe(false);
  });
});

describe("isEvenHex", () => {
  it("accepts non-empty even-length hex", () => {
    expect(isEvenHex("009a1f293253e41e")).toBe(true);
    expect(isEvenHex("00")).toBe(true);
  });

  it.each([...MALFORMED, "", "0", "0g"])("rejects %j", (value) => {
    expect(isEvenHex(value)).toBe(false);
  });
});

function proof(overrides: Record<string, unknown> = {}) {
  return {
    amount: Amount.from(2),
    id: "009a1f293253e41e",
    secret: "11".repeat(32),
    C: `02${"ef".repeat(32)}`,
    ...overrides,
  };
}

function token(overrides: Record<string, unknown> = {}) {
  return { mint: "https://mint.test", unit: "sat", proofs: [proof(overrides)] };
}

describe("encodeTokenChecked", () => {
  it("round-trips a well-formed token, DLEQ included", () => {
    const dleq = { e: "aa".repeat(32), s: "bb".repeat(32), r: "cc".repeat(32) };
    const result = encodeTokenChecked(token({ dleq }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token).toBe(getEncodedToken(token({ dleq }) as never));
    const decoded = getDecodedToken(result.token, ["009a1f293253e41e"]);
    expect(decoded.proofs[0]).toMatchObject({ id: "009a1f293253e41e", dleq });
  });

  it.each(MALFORMED)("refuses keyset id %s without throwing", (id) => {
    expect(encodeTokenChecked(token({ id }))).toEqual({
      ok: false,
      reason: "malformed-proof",
      field: "proofs[0].id",
    });
  });

  it.each(MALFORMED)("refuses C %s without throwing", (C) => {
    expect(encodeTokenChecked(token({ C }))).toEqual({
      ok: false,
      reason: "malformed-proof",
      field: "proofs[0].C",
    });
  });

  it.each(["e", "s", "r"])("refuses an odd-length DLEQ %s", (key) => {
    const dleq = { e: "aa".repeat(32), s: "bb".repeat(32), r: "cc".repeat(32) };
    expect(
      encodeTokenChecked(token({ dleq: { ...dleq, [key]: "12345" } })),
    ).toEqual({
      ok: false,
      reason: "malformed-proof",
      field: `proofs[0].dleq.${key}`,
    });
  });

  it("refuses a malformed P2BK ephemeral key", () => {
    expect(encodeTokenChecked(token({ p2pk_e: "false" }))).toEqual({
      ok: false,
      reason: "malformed-proof",
      field: "proofs[0].p2pk_e",
    });
  });

  it("refuses a token without a proofs array", () => {
    expect(encodeTokenChecked({ mint: "https://mint.test" })).toEqual({
      ok: false,
      reason: "malformed-proof",
      field: "proofs",
    });
    expect(encodeTokenChecked("error")).toEqual({
      ok: false,
      reason: "malformed-proof",
      field: "proofs",
    });
  });

  it("refuses a legacy base64 keyset id, which no V4 token can carry", () => {
    expect(encodeTokenChecked(token({ id: "I2yN+iRYfkzT" }))).toMatchObject({
      ok: false,
      field: "proofs[0].id",
    });
  });

  it("returns cashu-ts's own refusal as encode-failed instead of throwing", () => {
    // A DLEQ without its blinding factor is well-formed hex; cashu-ts refuses it.
    const dleq = { e: "aa".repeat(32), s: "bb".repeat(32) };
    const result = encodeTokenChecked(token({ dleq }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("encode-failed");
  });
});

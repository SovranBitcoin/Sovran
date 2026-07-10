/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ecash.ts — canonical cashu token metadata decoder.
 */

import { getDecodedToken, getEncodedToken } from "@cashu/cashu-ts";
import { describe, expect, it } from "vitest";

import { decodeEcashTokenMetadata, isValidEcashToken } from "../../src/ecash";
import { defaultDetectors } from "../../src/detectors";
import { parsePaymentInput } from "../../src/parse";
import { INPUTS, MINT1 } from "../_harness/fixtures";
import {
  NUT00_V3_PADDED_TOKEN,
  NUT00_V3_TOKEN,
  NUT00_V4_TOKEN,
} from "../_harness/tokenVectors";

const SPEC_MINT = "https://8333.space:3338";

function duplicateSecretToken(): string {
  const secret = "11".repeat(32);
  return getEncodedToken({
    mint: "https://mint.test",
    unit: "sat",
    proofs: [
      {
        amount: 2,
        id: "009a1f293253e41e",
        secret,
        C: `02${"ef".repeat(32)}`,
      },
      {
        amount: 8,
        id: "009a1f293253e41e",
        secret,
        C: `03${"ab".repeat(32)}`,
      },
    ],
  });
}

describe("decodeEcashTokenMetadata", () => {
  it("decodes amount, mint, and unit from a valid token", () => {
    const meta = decodeEcashTokenMetadata(INPUTS.cashuTokenV3);
    expect(meta).not.toBeNull();
    expect(meta!.amount).toBe(1);
    expect(meta!.mint).toBe(MINT1);
    expect(meta!.unit).toBe("sat");
    expect(meta!.p2pkPubkey).toBeNull();
  });

  it("returns null for non-token input", () => {
    expect(decodeEcashTokenMetadata(INPUTS.randomString)).toBeNull();
    expect(decodeEcashTokenMetadata("")).toBeNull();
  });

  it.each([
    ["V3 padded", NUT00_V3_PADDED_TOKEN, "Thank you very much."],
    [
      "V3 unpadded",
      NUT00_V3_PADDED_TOKEN.replace(/=+$/, ""),
      "Thank you very much.",
    ],
    ["V4", NUT00_V4_TOKEN, "Thank you."],
  ])("decodes the NUT-00 %s interoperability vector", (_name, token, memo) => {
    expect(decodeEcashTokenMetadata(token)).toEqual({
      amount: 10,
      mint: SPEC_MINT,
      unit: "sat",
      memo,
      p2pkPubkey: null,
    });
  });

  it("round-trips a valid V3 token through the supported V4 encoder", () => {
    const upgraded = getEncodedToken(getDecodedToken(NUT00_V3_TOKEN, []));

    expect(upgraded).toMatch(/^cashuB/);
    expect(decodeEcashTokenMetadata(upgraded)).toEqual(
      decodeEcashTokenMetadata(NUT00_V3_TOKEN),
    );
  });

  it.each(["cashuCnot-supported", "cashuBnot-cbor", "invalid"])(
    "rejects unsupported or malformed token input: %s",
    (token) => {
      expect(decodeEcashTokenMetadata(token)).toBeNull();
      expect(isValidEcashToken(token)).toBe(false);
    },
  );

  it("rejects duplicate proof secrets before the parser can display an inflated amount", () => {
    const token = duplicateSecretToken();

    expect(decodeEcashTokenMetadata(token)).toBeNull();
    expect(isValidEcashToken(token)).toBe(false);

    const parsed = parsePaymentInput(token, defaultDetectors);
    expect(parsed.options).toEqual([]);
    expect(parsed.type).toBe("unknown");
  });
});

describe("isValidEcashToken", () => {
  it("is true for a valid token, false otherwise", () => {
    expect(isValidEcashToken(INPUTS.cashuTokenV3)).toBe(true);
    expect(isValidEcashToken(INPUTS.randomString)).toBe(false);
  });
});

/**
 * Requests other wallets actually emit, which cashu-ts rejects as written.
 */
import { describe, expect, it } from "vitest";

import { defaultDetectors } from "../../src/detectors";
import { parsePaymentInput } from "../../src/parse";
import { PaymentRequest, decodePaymentRequest } from "@cashu/cashu-ts";
import { canonicalMintUrl, decodePaymentRequestInfo } from "../../src/payment-request";
import { canonicalizePaymentRequest } from "../../src/payment-request-canonical";

// {i: "abc", a: null, u: "sat", d: null, m: ["https://m.x"]} — the shape
// cashubtc/wallet's Android PaymentRequestBuilder writes for an amountless
// request (absent optionals as CBOR null).
const ANDROID_CBOR =
  "a5" +
  "6169" + "63616263" +
  "6161" + "f6" +
  "6175" + "63736174" +
  "6164" + "f6" +
  "616d" + "81" + "6b68747470733a2f2f6d2e78";

const base64Url = (hex: string, padded: boolean) => {
  const encoded = Buffer.from(hex, "hex").toString("base64url");
  return padded ? encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=") : encoded;
};

describe("canonicalizePaymentRequest", () => {
  it.each([false, true])("decodes a null-field request (padded: %s)", (padded) => {
    const raw = `creqA${base64Url(ANDROID_CBOR, padded)}`;
    expect(() => decodePaymentRequest(raw)).toThrow();

    const info = decodePaymentRequestInfo(raw);
    expect(info).toMatchObject({ requestId: "abc", unit: "sat", mints: ["https://m.x"] });
    expect(info?.amount).toBeUndefined();
  });

  it("accepts an upper-case CREQA prefix", () => {
    const raw = `CREQA${base64Url(ANDROID_CBOR, false)}`;
    expect(decodePaymentRequestInfo(raw)?.requestId).toBe("abc");
  });

  it("hands the canonical spelling downstream from the parser", () => {
    const raw = `bitcoin:?creq=creqA${base64Url(ANDROID_CBOR, true)}`;
    const option = parsePaymentInput(raw, defaultDetectors).options.find(
      (o) => o.kind === "paymentRequest",
    );
    expect(option?.value).toBeDefined();
    expect(decodePaymentRequest(option!.value).id).toBe("abc");
  });

  it("leaves creqB and non-requests untouched", () => {
    expect(canonicalizePaymentRequest(" creqb1abc ")).toBe("creqb1abc");
    expect(canonicalizePaymentRequest("lnbc1")).toBe("lnbc1");
    expect(canonicalizePaymentRequest("creqA!!!")).toBe("creqA!!!");
  });
});

describe("request mint spelling", () => {
  it("matches our canonical mints and keeps the request's spelling", () => {
    const raw = new PaymentRequest(
      undefined, "r", 5, "sat",
      ["https://Mint.Example:443/Bitcoin/", "https://mint.example/Bitcoin"],
    ).toEncodedRequest();
    const info = decodePaymentRequestInfo(raw);
    expect(info?.mints).toEqual(["https://mint.example/Bitcoin"]);
    expect(info?.requestedMints).toEqual([
      "https://Mint.Example:443/Bitcoin/",
      "https://mint.example/Bitcoin",
    ]);
    expect(canonicalMintUrl("https://m.x/")).toBe("https://m.x");
    expect(canonicalMintUrl("not a url")).toBe("not a url");
  });
});

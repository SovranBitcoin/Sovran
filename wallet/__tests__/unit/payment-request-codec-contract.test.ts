/**
 * Payment-request wire boundary.
 *
 * cashu-ts owns CBOR, TLV, and bech32m. Colada owns the throw-safe classifier
 * and the subset of decoded request data used to route funds. These tests pin
 * both without reproducing either wire codec.
 */
import {
  PaymentRequest,
  PaymentRequestTransportType,
  decodePaymentRequest,
  type NUT10Option,
} from "@cashu/cashu-ts";
import { describe, expect, it } from "vitest";

import { defaultDetectors } from "../../src/detectors";
import {
  decodePaymentRequestInfo,
  lockableMintsFromRequest,
} from "../../src/payment-request";
import { parsePaymentInput } from "../../src/parse";

const LOCK_HEX = "a".repeat(64);
const LOCK_KEY = `02${LOCK_HEX}`;
const REFUND_KEY = `03${"b".repeat(64)}`;
const MINTS = ["https://mint.one", "https://mint.two"];
const NOSTR_TARGET =
  "npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqshp52w2";
const SPEC_VECTOR =
  "CREQB1QYQQWER9D4HNZV3NQGQQSQQQQQQQQQQRAQPSQQGQQSQQZQG9QQVXSAR5WPEN5TE0D45KUAPWV4UXZMTSD3JJUCM0D5RQQRJRDANXVET9YPCXZ7TDV4H8GXHR3TQ";
const MALFORMED_SINGLE_USE_TAG = "CREQB1QSQQQDTFLFU";
const MALFORMED_SHORT_AMOUNT_TAG = "CREQB1QGQQYQGZSWP0M3";

const parse = (value: string) => parsePaymentInput(value, defaultDetectors);

describe("NUT-18 creqA installed-codec boundary", () => {
  it("round-trips unit, mints, transports, tags, and the embedded NUT-10 lock", () => {
    const lock: NUT10Option = {
      kind: "P2PK",
      data: LOCK_KEY,
      tags: [
        ["locktime", "1700000000"],
        ["refund", REFUND_KEY],
      ],
    };
    const request = new PaymentRequest(
      [
        {
          type: PaymentRequestTransportType.POST,
          target: "https://callback.example/pay",
          tags: [["auth", "bearer"]],
        },
        {
          type: PaymentRequestTransportType.NOSTR,
          target: NOSTR_TARGET,
          tags: [["n", "17"]],
        },
      ],
      "request-18",
      4_200,
      "usd",
      MINTS,
      "Locked request",
      true,
      lock,
    );

    const encoded = request.toEncodedCreqA();
    const decoded = decodePaymentRequest(encoded);
    const sovranInfo = decodePaymentRequestInfo(encoded);

    expect(encoded).toMatch(/^creqA/);
    expect(decoded.id).toBe("request-18");
    expect(decoded.amount?.toNumber()).toBe(4_200);
    expect(decoded.unit).toBe("usd");
    expect(decoded.mints).toEqual(MINTS);
    expect(decoded.transport).toEqual(request.transport);
    expect(decoded.singleUse).toBe(true);
    expect(decoded.nut10).toEqual(lock);
    expect(sovranInfo).toEqual({
      amount: 4_200,
      unit: "usd",
      mints: MINTS,
      transports: [
        {
          type: PaymentRequestTransportType.POST,
          target: "https://callback.example/pay",
        },
        {
          type: PaymentRequestTransportType.NOSTR,
          target: NOSTR_TARGET,
        },
      ],
      lockP2pkPubkey: LOCK_KEY,
    });
    expect(lockableMintsFromRequest(encoded, LOCK_HEX)).toEqual(MINTS);
  });
});

describe("NUT-26 CREQB1 installed-codec boundary", () => {
  it("matches and decodes the published bech32m vector", () => {
    const encoded = new PaymentRequest(
      undefined,
      "demo123",
      1_000,
      "sat",
      ["https://mint.example.com"],
      "Coffee payment",
      true,
    ).toEncodedCreqB();
    const decoded = decodePaymentRequest(SPEC_VECTOR);

    expect(encoded).toBe(SPEC_VECTOR);
    expect(decoded.id).toBe("demo123");
    expect(decoded.amount?.toNumber()).toBe(1_000);
    expect(decoded.unit).toBe("sat");
    expect(decoded.singleUse).toBe(true);
    expect(decoded.mints).toEqual(["https://mint.example.com"]);
    expect(decoded.description).toBe("Coffee payment");
    expect(decodePaymentRequestInfo(SPEC_VECTOR)).toMatchObject({
      amount: 1_000,
      unit: "sat",
      mints: ["https://mint.example.com"],
    });
  });

  it("accepts all-upper and all-lower forms", () => {
    expect(decodePaymentRequestInfo(SPEC_VECTOR)).not.toBeNull();
    expect(decodePaymentRequestInfo(SPEC_VECTOR.toLowerCase())).toEqual(
      decodePaymentRequestInfo(SPEC_VECTOR),
    );
  });

  it("rejects an invalid checksum at the throw-safe Sovran boundary", () => {
    const replacement = SPEC_VECTOR.endsWith("Q") ? "P" : "Q";
    const corrupted = `${SPEC_VECTOR.slice(0, -1)}${replacement}`;

    expect(decodePaymentRequestInfo(corrupted)).toBeNull();
    expect(defaultDetectors.isPaymentRequest(corrupted)).toBe(false);
    expect(parse(corrupted)).toMatchObject({ type: "unknown", options: [] });
  });

  it("rejects mixed-case bech32m even though the installed decoder lowercases it", () => {
    const mixedCase = `c${SPEC_VECTOR.slice(1)}`;

    expect(decodePaymentRequestInfo(mixedCase)).toBeNull();
    expect(defaultDetectors.isPaymentRequest(mixedCase)).toBe(false);
    expect(parse(mixedCase)).toMatchObject({ type: "unknown", options: [] });
  });

  it("rejects the wrong HRP and malformed fixed-width TLV tags", () => {
    const wrongHrp = `CREQX${SPEC_VECTOR.slice("CREQB".length)}`;

    for (const value of [
      wrongHrp,
      MALFORMED_SINGLE_USE_TAG,
      MALFORMED_SHORT_AMOUNT_TAG,
    ]) {
      expect(decodePaymentRequestInfo(value)).toBeNull();
      expect(defaultDetectors.isPaymentRequest(value)).toBe(false);
    }
  });

  it("dispatches both standalone encodings and a BIP-321 creq parameter", () => {
    const creqA = new PaymentRequest(
      undefined,
      "dispatch-a",
      50,
      "sat",
      MINTS,
    ).toEncodedCreqA();

    for (const value of [creqA, SPEC_VECTOR]) {
      expect(parse(value)).toMatchObject({
        type: "payment",
        options: [expect.objectContaining({ kind: "paymentRequest" })],
      });
    }

    expect(parse(`bitcoin:?creq=${SPEC_VECTOR}`)).toMatchObject({
      type: "payment",
      container: "bip321",
      options: [
        expect.objectContaining({
          kind: "paymentRequest",
          paramKey: "creq",
          value: SPEC_VECTOR,
        }),
      ],
    });
  });
});

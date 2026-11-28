/**
 * BIP-321 parameter names and values as each peer writes them.
 *
 * Numo upper-cases the whole URI for QR alphanumeric mode
 * (Numo payment/UnifiedPaymentRequest.kt:16-37); macadamia, cashu.me and
 * cashu-wallet read the keys case-insensitively (macadamia Misc/InputView.swift:32-62,
 * cashu.me src/stores/wallet.ts:1536-1556, cashubtc/wallet
 * android/.../PaymentRequestDecoder.kt:262); eNuts also reads `cashu`
 * (eNuts src/util/paymentStringParser.ts:75-84).
 */
import { describe, expect, it } from "vitest";

import { defaultDetectors } from "../../src/detectors";
import { parsePaymentInput } from "../../src/parse";

// cashubtc/nuts tests/26-test.md, the basic vector (also macadamiaTests.swift:589).
const CREQB =
  "CREQB1QYQQWER9D4HNZV3NQGQQSQQQQQQQQQQRAQPSQQGQQSQQZQG9QQVXSAR5WPEN5TE0D45KUAPWV4UXZMTSD3JJUCM0D5RQQRJRDANXVET9YPCXZ7TDV4H8GXHR3TQ";
// cdk crates/cashu/src/nuts/nut18/payment_request.rs:728 `legacy_encoded`:
// standard base64 with `+`, `/` and padding, as cashu-ts rc.4 (and so Sovran) emits.
const CREQA_STANDARD =
  "creqAqGF0gaNhdGRwb3N0YWF4G2h0dHBzOi8vYXBpLmV4YW1wbGUuY29tL3BheWFn92FpaDQ4NDBmNTFlYWEZA+hhdWNzYXRhbYF4GGh0dHBzOi8vbWludC5leGFtcGxlLmNvbWFkcFByb2R1Y3QgcHVyY2hhc2Vhc/VlbnV0MTCjYWtkUDJQS2FkeEIwM2JhZjBjM2FjMjIwMzY2YzJjMzk3YmY5MzA1NzljNDE2MzQzNTU4NGY1NzNiMTA5MTA5ODdjNTQ0YzU5ZTYxZjFhdIGCZ3B1cnBvc2Vnb2ZmbGluZQ==";
/** 1000-sat bolt11 (10u); the same invoice lightning-melt.test.ts pays. */
const BOLT11 =
  "lnbc10u1p4pcn75pp5nx5zweympssrmvmecek6n3ynhj7emfe3dynls8q3yu62uhje9rksdqqcqzzsxqyz5vqsp5lersjjw2atsnqhzhqac00xvvcelcw6gqfy7u2jka25q9y2dhczns9qxpqysgqckuv826yw544mrwgnt6k0r529wrczsj03hwrtgg0ch4gewreqt75gg838wrd6twg5dp7n9m9eze6km22svvx8jq5jmrv4pvr0q4dffqpp0ftc3";
const BOLT12 = "lno1qcp4256ypqpq86q69t5wv5629arxqurn8cxg9p5qmmqy2e5xq0wmf3";

const options = (input: string) =>
  parsePaymentInput(input, defaultDetectors).options.map(
    (option) => `${option.kind}:${option.paramKey}`,
  );

describe("BIP-321 parameter names in any case", () => {
  it.each([
    ["creq", `bitcoin:?creq=${CREQB}`, "paymentRequest:creq"],
    ["CREQ, whole URI upper-case (Numo)", `BITCOIN:?CREQ=${CREQB}`, "paymentRequest:creq"],
    ["Creq", `bitcoin:?Creq=${CREQB.toLowerCase()}`, "paymentRequest:creq"],
    ["cashu", `bitcoin:?cashu=${CREQB}`, "paymentRequest:cashu"],
    ["CASHU", `BITCOIN:?CASHU=${CREQB}`, "paymentRequest:cashu"],
    ["lightning", `bitcoin:?lightning=${BOLT11}`, "lightningInvoice:lightning"],
    ["LIGHTNING (Numo)", `BITCOIN:?LIGHTNING=${BOLT11.toUpperCase()}`, "lightningInvoice:lightning"],
    ["lno", `bitcoin:?lno=${BOLT12}`, "bolt12Offer:lno"],
    ["LNO", `BITCOIN:?LNO=${BOLT12.toUpperCase()}`, "bolt12Offer:lno"],
  ])("%s", (_name, uri, expected) => {
    expect(options(uri)).toContain(expected);
  });

  it("reads Numo's unified URI: amount, lightning and creq together", () => {
    const uri = `BITCOIN:?AMOUNT=0.00001&LIGHTNING=${BOLT11.toUpperCase()}&CREQ=${CREQB}`;
    expect(options(uri)).toEqual(["paymentRequest:creq", "lightningInvoice:lightning"]);
  });
});

describe("BIP-321 values with a literal plus", () => {
  // A query is not form-encoded: `+` is a plus, never a space. A standard
  // base64 creqA put in a URI unescaped used to lose every `+`.
  it("reads a standard-base64 creqA placed in the URI unescaped", () => {
    expect(CREQA_STANDARD).toContain("+");
    expect(options(`bitcoin:?creq=${CREQA_STANDARD}`)).toEqual(["paymentRequest:creq"]);
  });

  it("reads the same request percent-encoded", () => {
    expect(options(`bitcoin:?creq=${encodeURIComponent(CREQA_STANDARD)}`)).toEqual([
      "paymentRequest:creq",
    ]);
  });

  it("keeps a BOLT12 offer's `+` continuation", () => {
    const offer = `${BOLT12.slice(0, 20)}+${BOLT12.slice(20)}`;
    const parsed = parsePaymentInput(`bitcoin:?lno=${offer}`, defaultDetectors);
    expect(parsed.options.map((option) => option.value)).toEqual([offer]);
  });

  it("still reads a plus in a label or message as a space", () => {
    const parsed = parsePaymentInput(
      `bitcoin:?label=Coffee+shop&message=Two+flat+whites&lightning=${BOLT11}`,
      defaultDetectors,
    );
    expect(parsed.bip321).toMatchObject({ label: "Coffee shop", message: "Two flat whites" });
  });
});

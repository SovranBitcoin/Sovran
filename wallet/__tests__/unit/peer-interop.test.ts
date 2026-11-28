/**
 * What the peer wallets emit, read by Sovran's own boundary.
 *
 * Every fixture names where it comes from, in a checkout of the peer:
 *  - "copied": the encoded string stands in the peer's own tests.
 *  - "encoder": the output of the peer's encoder, run on the stated inputs.
 *    minibits and cashu.me encode with `@cashu/cashu-ts` 4.11.0 and 4.9.0
 *    (their package.json); those releases' `PaymentRequest.toEncodedRequest`
 *    and `getEncodedTokenBinary` produced the strings here.
 *  - "rebuilt": written here field by field from the peer's encoder source,
 *    because that encoder (Kotlin, Swift) was not run. The bytes follow the
 *    code; they are not captured output.
 *
 * Not covered: macadamia's creqA, which cashu-swift encodes and is not in a
 * checkout. Nothing here was tapped or paid between devices.
 */
import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import { defaultDetectors } from "../../src/detectors";
import {
  decodeEcashTokenMetadata,
  ecashTokenTextFromBinary,
} from "../../src/ecash";
import { parsePaymentInput } from "../../src/parse";
import { decodePaymentRequestInfo } from "../../src/payment-request";

// ── A CBOR writer for the "rebuilt" fixtures ───────────────────────────────

type Cbor = string | number | boolean | null | Cbor[] | [string, Cbor][] | CborMap;
class CborMap {
  constructor(readonly entries: [string, Cbor][]) {}
}
const map = (...entries: [string, Cbor][]) => new CborMap(entries);

function head(major: number, arg: number): number[] {
  if (arg < 24) return [(major << 5) | arg];
  if (arg < 0x100) return [(major << 5) | 24, arg];
  return [(major << 5) | 25, arg >> 8, arg & 0xff];
}
function cbor(value: Cbor): number[] {
  if (value === null) return [0xf6];
  if (value === true) return [0xf5];
  if (value === false) return [0xf4];
  if (typeof value === "number") return head(0, value);
  if (typeof value === "string") {
    const bytes = [...new TextEncoder().encode(value)];
    return [...head(3, bytes.length), ...bytes];
  }
  if (value instanceof CborMap) {
    return [
      ...head(5, value.entries.length),
      ...value.entries.flatMap(([key, item]) => [...cbor(key), ...cbor(item)]),
    ];
  }
  return [...head(4, value.length), ...(value as Cbor[]).flatMap(cbor)];
}
const base64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");
const base64Url = (bytes: number[]) => Buffer.from(bytes).toString("base64url");

// ── Payment requests ───────────────────────────────────────────────────────

/** The nprofile minibits' encoder was given: its three default relays. */
const MINIBITS_TARGET =
  "nprofile1qyvhwumn8ghj7un9d3shjtndd9hxjcnfw3ejucmpwd5qz9nhwden5te0wfjkccte9ec8y6tdv9kzumn9wsq3gamnwvaz7tmjv4kxz7fwv3sk6atn9e5k7qpq0elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qc8vd3u";
/** The nprofile cashu.me's encoder was given: its three default relays. */
const CASHU_ME_TARGET =
  "nprofile1qy28wumn8ghj7un9d3shjtnyv9kh2uewd9hszrthwden5te0dehhxtnvdakqz9nhwden5te0wfjkccte9ec8y6tdv9kzumn9wsqzqln7n3p2jxl77x06j209lksmwtswhsdycy2pvulz09prfkr2mh6w5tlgyp";
const CDK_NPROFILE =
  "nprofile1qy28wumn8ghj7un9d3shjtnyv9kh2uewd9hsz9mhwden5te0wfjkccte9curxven9eehqctrv5hszrthwden5te0dehhxtnvdakqqgydaqy7curk439ykptkysv7udhdhu68sucm295akqefdehkf0d495cwunl5";
const NUT26_BASIC =
  "CREQB1QYQQWER9D4HNZV3NQGQQSQQQQQQQQQQRAQPSQQGQQSQQZQG9QQVXSAR5WPEN5TE0D45KUAPWV4UXZMTSD3JJUCM0D5RQQRJRDANXVET9YPCXZ7TDV4H8GXHR3TQ";

interface RequestFixture {
  peer: string;
  /** `repo/path:line`, and how the string was obtained. */
  source: string;
  encoded: string;
  amount: number | undefined;
  unit: string;
  mints: string[];
  /** The transport types offered, in order; empty means "hand it over". */
  transports: string[];
  target?: string;
  /** For a target that is the same key and relays under another spelling. */
  sameProfileAs?: string;
  locked?: boolean;
  supportedMethods?: { method: string; fee: number }[];
}

const REQUESTS: RequestFixture[] = [
  // ── Numo ────────────────────────────────────────────────────────────────
  {
    peer: "Numo, Cashu tab / NFC (no transport, unpadded base64url)",
    source:
      "rebuilt: Numo app/src/main/java/com/electricdreams/numo/ndef/CashuPaymentHelper.kt:70-95 (keys i, a, u, d, s, m; URL_SAFE|NO_PADDING)",
    encoded: `creqA${base64Url(
      cbor(
        map(
          ["i", "3f9c1a7e"],
          ["a", 2100],
          ["u", "sat"],
          ["d", "Payment for 2100 sats"],
          ["s", true],
          ["m", ["https://mint.minibits.cash/Bitcoin"]],
        ),
      ),
    )}`,
    amount: 2100,
    unit: "sat",
    mints: ["https://mint.minibits.cash/Bitcoin"],
    transports: [],
  },
  {
    peer: "Numo, nostr request (creqA form, before its CDK bech32 conversion)",
    source:
      "rebuilt: Numo ndef/CashuPaymentHelper.kt:105-146 (transport t=nostr, a=nprofile, g=[[n,17]])",
    encoded: `creqA${base64Url(
      cbor(
        map(
          ["i", "3f9c1a7e"],
          ["a", 2100],
          ["u", "sat"],
          ["d", "Payment for 2100 sats"],
          ["s", true],
          ["t", [map(["t", "nostr"], ["a", CDK_NPROFILE], ["g", [["n", "17"]]])]],
        ),
      ),
    )}`,
    amount: 2100,
    unit: "sat",
    mints: [],
    transports: ["nostr"],
    target: CDK_NPROFILE,
  },
  // ── macadamia ───────────────────────────────────────────────────────────
  {
    peer: "macadamia, creqB (the vector its NUT-26 codec is tested against)",
    source: "copied: macadamia macadamiaTests/macadamiaTests.swift:589",
    encoded: NUT26_BASIC,
    amount: 1000,
    unit: "sat",
    mints: ["https://mint.example.com"],
    transports: [],
  },
  // ── minibits ────────────────────────────────────────────────────────────
  {
    peer: "minibits (padded standard base64, nprofile + n:17, one mint)",
    source:
      "encoder: cashu-ts v4.11.0 toEncodedRequest on the inputs of minibits_wallet src/services/wallet/operations/cashuPaymentRequestApi.ts:213-232",
    encoded:
      "creqApmF0gaNhdGVub3N0cmFheLtucHJvZmlsZTFxeXZod3VtbjhnaGo3dW45ZDNzaGp0bmRkOWh4amNuZnczZWp1Y21wd2Q1cXo5bmh3ZGVuNXRlMHdmamtjY3RlOWVjOHk2dGR2OWt6dW1uOXdzcTNnYW1ud3Zhejd0bWp2NGt4ejdmd3Yzc2s2YXRuOWU1azdxcHEwZWxmY3M0ZnIwbDByOGFmOThqbG1nZGg5Yzh0Y3hqdno5cWt3MDM4anMzNW1wNGRtYThxYzh2ZDN1YWeBgmFuYjE3YWloYTFiMmMzZDRhYRVhdWNzYXRhbYF4Imh0dHBzOi8vbWludC5taW5pYml0cy5jYXNoL0JpdGNvaW5hZGZjb2ZmZWU=",
    amount: 21,
    unit: "sat",
    mints: ["https://mint.minibits.cash/Bitcoin"],
    transports: ["nostr"],
    target: MINIBITS_TARGET,
  },
  // ── cashu-wallet (cashubtc/wallet) ──────────────────────────────────────
  {
    peer: "cashu-wallet (padded base64url, `s: null`, nprofile + n:17)",
    source:
      "copied: cashubtc/wallet android/app/src/test/java/com/cashu/me/Core/PaymentRequestBuilderTest.kt:40",
    encoded:
      "creqAp2FpanJlcXVlc3QtaWRhYRgqYXVjc2F0YXP2YW2BdGh0dHBzOi8vbWludC5leGFtcGxlYWRmY29mZmVlYXSBo2F0ZW5vc3RyYWF4Z25wcm9maWxlMXFxczhuMG54MG11YWV3YXYya3N4OTl3d3N1OXN3cTVtbG5kam1uM2dtOXZsOXEybXptdXAweHFwemRtaHh1ZTY5dWhoeWV0dnY5dWp1ZXRjdjlraHFtcjk5bXZ0NTRhZ4GCYW5iMTc=",
    amount: 42,
    unit: "sat",
    mints: ["https://mint.example"],
    transports: ["nostr"],
    target:
      "nprofile1qqs8n0nx0muaewav2ksx99wwsu9swq5mlndjmn3gm9vl9q2mzmup0xqpzdmhxue69uhhyetvv9ujuetcv9khqmr99mvt54",
  },
  {
    peer: "cashu-wallet, NFC tag without an amount (`a`, `s`, `d` written as null)",
    source:
      "rebuilt: cashubtc/wallet android/app/src/main/java/com/cashu/me/Core/PaymentRequestBuilder.kt:8-26 (buildNfc; padded getUrlEncoder)",
    encoded: `creqA${base64(
      cbor(
        map(
          ["i", "tap-1"],
          ["a", null],
          ["u", "sat"],
          ["s", null],
          ["m", ["https://mint.example"]],
          ["d", null],
        ),
      ),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")}`,
    amount: undefined,
    unit: "sat",
    mints: ["https://mint.example"],
    transports: [],
  },
  // ── cashu.me ────────────────────────────────────────────────────────────
  {
    peer: "cashu.me (padded standard base64, seed nprofile + n:17)",
    source:
      "encoder: cashu-ts v4.9.0 toEncodedRequest on the inputs of cashu.me src/stores/payment-request.ts:81-109",
    encoded:
      "creqApWF0gaNhdGVub3N0cmFheKducHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6cnRod2RlbjV0ZTBkZWhoeHRudmRha3F6OW5od2RlbjV0ZTB3ZmprY2N0ZTllYzh5NnRkdjlrenVtbjl3c3F6cWxuN24zcDJqeGw3N3gwNmoyMDlsa3Ntd3Rzd2hzZHljeTJwdnVsejA5cHJma3IybWg2dzV0bGd5cGFngYJhbmIxN2FpaDVjM2I5YTQxYWEYZGF1Y3NhdGFtgXVodHRwczovL21pbnQuY2FzaHUubWU=",
    amount: 100,
    unit: "sat",
    mints: ["https://mint.cashu.me"],
    transports: ["nostr"],
    target: CASHU_ME_TARGET,
  },
  {
    peer: "cashu.me, no amount and no mint",
    source:
      "encoder: cashu-ts v4.9.0 toEncodedRequest, cashu.me src/stores/payment-request.ts:81-109 with amount and mint unset",
    encoded:
      "creqApGF0gaNhdGVub3N0cmFheKducHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6cnRod2RlbjV0ZTBkZWhoeHRudmRha3F6OW5od2RlbjV0ZTB3ZmprY2N0ZTllYzh5NnRkdjlrenVtbjl3c3F6cWxuN24zcDJqeGw3N3gwNmoyMDlsa3Ntd3Rzd2hzZHljeTJwdnVsejA5cHJma3IybWg2dzV0bGd5cGFngYJhbmIxN2FpaDVjM2I5YTQyYXVjc2F0YWRjdGlw",
    amount: undefined,
    unit: "sat",
    mints: [],
    transports: ["nostr"],
    target: CASHU_ME_TARGET,
  },
  // ── cdk ─────────────────────────────────────────────────────────────────
  {
    peer: "cdk, `s` and `d` as CBOR null",
    source: "copied: cdk crates/cashu/src/nuts/nut18/payment_request.rs:336",
    encoded:
      "creqAp2FpaGI3YTkwMTc2YWEKYXVjc2F0YXP2YW2BeCJodHRwczovL25vZmVlcy50ZXN0bnV0LmNhc2h1LnNwYWNlYWT2YXSBo2F0ZW5vc3RyYWF4qW5wcm9maWxlMXFxc2dtNnFmYTNjOGR0ejJmdnpodmZxZWFjbXdtMGU1MHBlM2s1dGZtdnBqam1uMHZqN20ydGdwejNtaHh1ZTY5dWhoeWV0dnY5dWp1ZXJwZDQ2aHh0bmZkdXEzd2Ftbnd2YXo3dG1qdjRreHo3Znc4cWVueHZld3dkY3h6Y205OXVxczZhbW53dmF6N3Rtd2RhZWp1bXIwZHM0bGpoN25hZ4GCYW5iMTc=",
    amount: 10,
    unit: "sat",
    mints: ["https://nofees.testnut.cashu.space"],
    transports: ["nostr"],
  },
  {
    peer: "cdk, nostr nprofile, mint with a port",
    source: "copied: cdk crates/cashu/src/nuts/nut18/payment_request.rs:661",
    encoded:
      "creqApWF0gaNhdGVub3N0cmFheKlucHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6OW1od2RlbjV0ZTB3ZmprY2N0ZTljdXJ4dmVuOWVlaHFjdHJ2NWhzenJ0aHdkZW41dGUwZGVoaHh0bnZkYWtxcWd5ZGFxeTdjdXJrNDM5eWtwdGt5c3Y3dWRoZGh1NjhzdWNtMjk1YWtxZWZkZWhrZjBkNDk1Y3d1bmw1YWeBgmFuYjE3YWloYjdhOTAxNzZhYQphdWNzYXRhbYF3aHR0cHM6Ly84MzMzLnNwYWNlOjMzMzg=",
    amount: 10,
    unit: "sat",
    mints: ["https://8333.space:3338"],
    transports: ["nostr"],
    target: CDK_NPROFILE,
  },
  {
    peer: "cdk, HTTP POST + P2PK lock, base64url",
    source: "copied: cdk crates/cashu/src/nuts/nut18/payment_request.rs:727",
    encoded:
      "creqAqGF0gaNhdGRwb3N0YWF4G2h0dHBzOi8vYXBpLmV4YW1wbGUuY29tL3BheWFn92FpaDQ4NDBmNTFlYWEZA-hhdWNzYXRhbYF4GGh0dHBzOi8vbWludC5leGFtcGxlLmNvbWFkcFByb2R1Y3QgcHVyY2hhc2Vhc_VlbnV0MTCjYWtkUDJQS2FkeEIwM2JhZjBjM2FjMjIwMzY2YzJjMzk3YmY5MzA1NzljNDE2MzQzNTU4NGY1NzNiMTA5MTA5ODdjNTQ0YzU5ZTYxZjFhdIGCZ3B1cnBvc2Vnb2ZmbGluZQ==",
    amount: 1000,
    unit: "sat",
    mints: ["https://mint.example.com"],
    transports: ["post"],
    target: "https://api.example.com/pay",
    locked: true,
  },
  {
    peer: "cdk, the same request in legacy standard base64 (`+`, `/`)",
    source: "copied: cdk crates/cashu/src/nuts/nut18/payment_request.rs:728",
    encoded:
      "creqAqGF0gaNhdGRwb3N0YWF4G2h0dHBzOi8vYXBpLmV4YW1wbGUuY29tL3BheWFn92FpaDQ4NDBmNTFlYWEZA+hhdWNzYXRhbYF4GGh0dHBzOi8vbWludC5leGFtcGxlLmNvbWFkcFByb2R1Y3QgcHVyY2hhc2Vhc/VlbnV0MTCjYWtkUDJQS2FkeEIwM2JhZjBjM2FjMjIwMzY2YzJjMzk3YmY5MzA1NzljNDE2MzQzNTU4NGY1NzNiMTA5MTA5ODdjNTQ0YzU5ZTYxZjFhdIGCZ3B1cnBvc2Vnb2ZmbGluZQ==",
    amount: 1000,
    unit: "sat",
    mints: ["https://mint.example.com"],
    transports: ["post"],
    target: "https://api.example.com/pay",
    locked: true,
  },
  {
    peer: "cdk, nostr target that is an npub, two mints",
    source: "copied: cdk crates/cashu/src/nuts/nut18/payment_request.rs:809",
    encoded:
      "creqApWF0gaNhdGVub3N0cmFheD9ucHViMXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXEyOHNwajNhZ4KCYW5iMTeCYW5kOTczNWFpaGY5MmE1MWI4YWEYZGF1Y3NhdGFtgngZaHR0cHM6Ly9taW50MS5leGFtcGxlLmNvbXgZaHR0cHM6Ly9taW50Mi5leGFtcGxlLmNvbQ==",
    amount: 100,
    unit: "sat",
    mints: ["https://mint1.example.com", "https://mint2.example.com"],
    transports: ["nostr"],
    target: "npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq28spj3",
  },
  {
    peer: "cdk, minimal: no amount, no transport",
    source: "copied: cdk crates/cashu/src/nuts/nut18/payment_request.rs:864",
    encoded: "creqAo2FpaDdmNGEyYjM5YXVjc2F0YW2BeBhodHRwczovL21pbnQuZXhhbXBsZS5jb20=",
    amount: undefined,
    unit: "sat",
    mints: ["https://mint.example.com"],
    transports: [],
  },
  {
    peer: "cdk, P2PK lock with a tag, no transport",
    source: "copied: cdk crates/cashu/src/nuts/nut18/payment_request.rs:909",
    encoded:
      "creqApWFpaGM5ZTQ1ZDJhYWEZAfRhdWNzYXRhbYF4GGh0dHBzOi8vbWludC5leGFtcGxlLmNvbWVudXQxMKNha2RQMlBLYWR4QjAyYzNiNWJiMjdlMzYxNDU3YzkyZDkzZDc4ZGQ3M2QzZDUzNzMyMTEwYjJjZmU4YjUwZmJjMGFiYzYxNWU5YzMzMWF0gYJndGltZW91dGQzNjAw",
    amount: 500,
    unit: "sat",
    mints: ["https://mint.example.com"],
    transports: [],
    locked: true,
  },
  {
    peer: "cdk, preferred mints with supported methods (`mp`, `sm`)",
    source: "copied: cdk crates/cashu/src/nuts/nut18/payment_request.rs:952",
    encoded:
      "creqApmFpdXByZWZlcnJlZF9mZWVfbWV0aG9kc2FhGGRhdWNzYXRhbYF4GGh0dHBzOi8vbWludC5leGFtcGxlLmNvbWJtcPVic22CoWJtbmZib2x0MTGiYm1uZmJvbHQxMmJtZgU=",
    amount: 100,
    unit: "sat",
    mints: ["https://mint.example.com"],
    transports: [],
    supportedMethods: [
      { method: "bolt11", fee: 0 },
      { method: "bolt12", fee: 5 },
    ],
  },
  // ── nutshell ────────────────────────────────────────────────────────────
  {
    peer: "nutshell, nostr request (unpadded standard base64)",
    source: "copied: nutshell tests/wallet/test_wallet_payment_request.py:37",
    encoded:
      "creqApWF0gaNhdGVub3N0cmFheKlucHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6OW1od2RlbjV0ZTB3ZmprY2N0ZTljdXJ4dmVuOWVlaHFjdHJ2NWhzenJ0aHdkZW41dGUwZGVoaHh0bnZkYWtxcWd5ZGFxeTdjdXJrNDM5eWtwdGt5c3Y3dWRoZGh1NjhzdWNtMjk1YWtxZWZkZWhrZjBkNDk1Y3d1bmw1YWeBgmFuYjE3YWloYjdhOTAxNzZhYQphdWNzYXRhbYF4Imh0dHBzOi8vbm9mZWVzLnRlc3RudXQuY2FzaHUuc3BhY2U",
    amount: 10,
    unit: "sat",
    mints: ["https://nofees.testnut.cashu.space"],
    transports: ["nostr"],
    target: CDK_NPROFILE,
  },
  {
    peer: "nutshell, creqB",
    source: "copied: nutshell tests/wallet/test_wallet_payment_request.py:142-145",
    encoded: NUT26_BASIC,
    amount: 1000,
    unit: "sat",
    mints: ["https://mint.example.com"],
    transports: [],
  },
  // ── cashu-ts ────────────────────────────────────────────────────────────
  {
    peer: "cashu-ts, nostr request without an amount",
    source: "copied: cashu-ts test/wallet/paymentRequests.test.ts:73",
    encoded:
      "creqApGF0gaNhdGVub3N0cmFheKlucHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6OW1od2RlbjV0ZTB3ZmprY2N0ZTljdXJ4dmVuOWVlaHFjdHJ2NWhzenJ0aHdkZW41dGUwZGVoaHh0bnZkYWtxcWd5bWRleDNndmZzZnVqcDN4eW43ZTdxcnM4eXlxOWQ4enN1MnpxdWp4dXhjYXBmcXZ6YzhncnFka3RzYWeBgmFuYjE3YWloNDg0MGY1MWVhdWNzYXRhbYFwaHR0cHM6Ly9taW50LmNvbQ==",
    amount: undefined,
    unit: "sat",
    mints: ["https://mint.com"],
    transports: ["nostr"],
  },
  {
    peer: "cashu-ts v4, request without a transport",
    source: "encoder: cashu-ts v4.11.0 toEncodedRequest (id b7a90176, 10 sat, one mint)",
    encoded:
      "creqApGFpaGI3YTkwMTc2YWEKYXVjc2F0YW2BeCJodHRwczovL25vZmVlcy50ZXN0bnV0LmNhc2h1LnNwYWNl",
    amount: 10,
    unit: "sat",
    mints: ["https://nofees.testnut.cashu.space"],
    transports: [],
  },
  {
    peer: "cashu-ts v4, creqB with a nostr target and relay tags",
    source:
      "encoder: cashu-ts v4.11.0 toEncodedCreqB on minibits' request above (relays become `r` tags)",
    encoded:
      "CREQB1QYQQSCF3VGEXXVMYXSPQQZQQQQQQQQQQQQ2SXQQPQQZQQQGQQ5QZY6R5W3C8XW309AKKJMN59EKKJMNFVF5HGUEWVDSHX6P0GF5HGCM0D9HQVQQXVDHKVEN9V5RSPPQPQQQSQQSQYPL8A8ZZ4YDLAUVL4Y57TLDPKUHQA0Q6FSG5ZEE7Y72ZXNVX4H05UQCQRSQHYXTHWDEN5TE0WFJKCCTE9EKKJMNFVF5HGUEWVDSHX6QRQQVSZUSKWAEHXW309AEX2MRP0YH8QUNFD4SKCTNWV46QXQQHQ9EPGAMNWVAZ7TMJV4KXZ7FWV3SK6ATN9E5K7QCQQ5QKUQ33XUGLFT8V",
    amount: 21,
    unit: "sat",
    mints: ["https://mint.minibits.cash/Bitcoin"],
    transports: ["nostr"],
    // A creqB target is the bare key plus `r` tags; it decodes to an nprofile
    // of the same key and relays, spelled in its own TLV order.
    sameProfileAs: MINIBITS_TARGET,
  },
  {
    peer: "cashu-ts, creqB from the NUT-26 interop vectors",
    source: "copied: cashu-ts test/wallet/paymentRequests.test.ts:793",
    encoded:
      "CREQB1QYQQSC3HVYUNQVFHXCPQQZQQQQQQQQQQQQ9QXQQPQQZSQ9MGW368QUE69UHNSVENXVH8XURPVDJN5VENXVUQWQREQYQQZQQZQQSGM6QFA3C8DTZ2FVZHVFQEACMWM0E50PE3K5TFMVPJJMN0VJ7M2TGRQQZSZMSZXYMSXQQHQ9EPGAMNWVAZ7TMJV4KXZ7FWV3SK6ATN9E5K7QCQRGQHY9MHWDEN5TE0WFJKCCTE9CURXVEN9EEHQCTRV5HSXQQSQ9EQ6AMNWVAZ7TMWDAEJUMR0DSRYDPGF",
    amount: 10,
    unit: "sat",
    mints: ["https://8333.space:3338"],
    transports: ["nostr"],
  },
  // ── coco / cocod ────────────────────────────────────────────────────────
  {
    peer: "cocod (NUT-24 X-Cashu request, HTTP POST + P2PK lock)",
    source: "copied: coco packages/cocod/src/routes.test.ts:18",
    encoded:
      "CREQB1QYQQ2UN9WYKNZQSQPQQQQQQQQQQQQ9GRQQQSQPQQQYQQ2QQCDP68GURN8GHJ7MTFDE6ZUETCV9KHQMR99E3K7MGXQQX8GETNWSS8QCTED4JKUAQ8QQ0QZQQPQYPQQ9MGW368QUE69UHK27RPD4CXCEFWVDHK6TMSV9USSQZFQYQQZQQZQPPRQVNP89SKXCE3V56RSCEJX4JK2ETZ8YERSWTZX5CRXVTRVV6NWERP89NX2DEJVCEKVEFJ8QMRZEPJXC6XYERRXQMNGV3S893RZVPHVFSNYU24ZDV",
    amount: 21,
    unit: "sat",
    mints: ["https://mint.example.com"],
    transports: ["post"],
    target: "https://example.com/pay",
    locked: true,
  },
];

describe("payment requests the peers emit", () => {
  it.each(REQUESTS)("$peer", (fixture) => {
    const info = decodePaymentRequestInfo(fixture.encoded);
    expect(info, fixture.source).not.toBeNull();
    expect({
      amount: info!.amount,
      unit: info!.unit,
      mints: info!.mints,
      transports: (info!.transports ?? []).map((transport) => transport.type),
      locked: !!info!.lockP2pkPubkey,
      supportedMethods: info!.supportedMethods,
    }).toEqual({
      amount: fixture.amount,
      unit: fixture.unit,
      mints: fixture.mints,
      transports: fixture.transports,
      locked: fixture.locked ?? false,
      supportedMethods: fixture.supportedMethods,
    });
    if (fixture.target) {
      expect(info!.transports?.[0]?.target).toBe(fixture.target);
    }
    if (fixture.sameProfileAs) {
      expect(nip19.decode(info!.transports![0].target)).toEqual(
        nip19.decode(fixture.sameProfileAs),
      );
    }
  });

  it.each(REQUESTS)("$peer: scanned, pasted or tapped, it is a payment request", (fixture) => {
    const parsed = parsePaymentInput(fixture.encoded, defaultDetectors);
    expect(parsed.options.map((option) => option.kind)).toEqual(["paymentRequest"]);
  });

  // Each peer's own spelling, respelled the ways the others write theirs.
  describe.each(REQUESTS.filter((fixture) => /^creqA/.test(fixture.encoded)))(
    "$peer, respelled",
    (fixture) => {
      const bytes = [...Buffer.from(fixture.encoded.slice(5), "base64")];
      const spellings: [string, string][] = [
        ["unpadded base64url", `creqA${base64Url(bytes)}`],
        [
          "padded base64url",
          `creqA${base64(bytes).replace(/\+/g, "-").replace(/\//g, "_")}`,
        ],
        ["padded standard base64", `creqA${base64(bytes)}`],
        ["unpadded standard base64", `creqA${base64(bytes).replace(/=+$/, "")}`],
        ["upper-case CREQA prefix", `CREQA${base64Url(bytes)}`],
        ["lower-case creqa prefix", `creqa${base64Url(bytes)}`],
      ];
      it.each(spellings)("%s", (_name, spelling) => {
        expect(decodePaymentRequestInfo(spelling)).toEqual(
          decodePaymentRequestInfo(fixture.encoded),
        );
      });
    },
  );

  describe.each(REQUESTS.filter((fixture) => /^CREQB1/.test(fixture.encoded)))(
    "$peer, respelled",
    (fixture) => {
      it("lower case", () => {
        expect(decodePaymentRequestInfo(fixture.encoded.toLowerCase())).toEqual(
          decodePaymentRequestInfo(fixture.encoded),
        );
      });
      it("mixed case is not bech32m and is refused", () => {
        const mixed = `creqb1${fixture.encoded.slice(6)}`;
        expect(decodePaymentRequestInfo(mixed)).toBeNull();
      });
    },
  );
});

describe("fields a request may carry that Sovran does not know", () => {
  const known: [string, Cbor][] = [
    ["i", "future-1"],
    ["a", 7],
    ["u", "sat"],
    ["m", ["https://mint.example.com"]],
  ];
  const encode = (...extra: [string, Cbor][]) =>
    `creqA${base64Url(cbor(map(...known, ...extra)))}`;

  it.each([
    ["an unknown text field", ["zz", "later"] as [string, Cbor]],
    ["an unknown nested field", ["zz", map(["x", [1, 2, 3]], ["y", null])] as [string, Cbor]],
    ["an unknown null field", ["zz", null] as [string, Cbor]],
  ])("ignores %s", (_name, extra) => {
    expect(decodePaymentRequestInfo(encode(extra))).toMatchObject({
      requestId: "future-1",
      amount: 7,
      unit: "sat",
      mints: ["https://mint.example.com"],
    });
  });

  it("reads every known field written as null as absent", () => {
    const allNull = `creqA${base64Url(
      cbor(
        map(
          ["i", null],
          ["a", null],
          ["u", null],
          ["s", null],
          ["m", null],
          ["mp", null],
          ["d", null],
          ["t", null],
          ["nut10", null],
        ),
      ),
    )}`;
    expect(decodePaymentRequestInfo(allNull)).toMatchObject({
      amount: undefined,
      unit: "sat",
      mints: [],
      lockP2pkPubkey: null,
    });
  });
});

// ── Tokens ─────────────────────────────────────────────────────────────────

/** cashu.me's `getEncodedTokenBinary` output for the NUT-00 V4 example token. */
const CRAWB_HEX =
  "6372617742a4616d7768747470733a2f2f383333332e73706163653a33333338617563736174617481a2616948009a1f293253e41e617082a361610261737840343037393135626332313262653631613737653365366432616562346337323739383062646135316364303661366166633239653238363137363861373833376163582102bc9097997d81afb2cc7346b5e4345a9346bd2a506eb7958598a72f0cf85163eaa3616108617378406665313531303933313465363164373735366230663865653066323361363234616361613366346530343266363134333363373238633730353762393331626561635821029e8e5050b890a7d6c0968db16bc1d5d5fa040ea1de284f6ec69d61299f67105961646a5468616e6b20796f752e";

const TOKENS: {
  format: string;
  source: string;
  token: string | null;
  amount: number;
  mint: string;
  memo?: string;
}[] = [
  {
    format: "cashuA, one mint, padded",
    source: "copied: cdk crates/cashu/src/nuts/nut00/token.rs:641",
    token:
      "cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vODMzMy5zcGFjZTozMzM4IiwicHJvb2ZzIjpbeyJhbW91bnQiOjIsImlkIjoiMDA5YTFmMjkzMjUzZTQxZSIsInNlY3JldCI6IjQwNzkxNWJjMjEyYmU2MWE3N2UzZTZkMmFlYjRjNzI3OTgwYmRhNTFjZDA2YTZhZmMyOWUyODYxNzY4YTc4MzciLCJDIjoiMDJiYzkwOTc5OTdkODFhZmIyY2M3MzQ2YjVlNDM0NWE5MzQ2YmQyYTUwNmViNzk1ODU5OGE3MmYwY2Y4NTE2M2VhIn0seyJhbW91bnQiOjgsImlkIjoiMDA5YTFmMjkzMjUzZTQxZSIsInNlY3JldCI6ImZlMTUxMDkzMTRlNjFkNzc1NmIwZjhlZTBmMjNhNjI0YWNhYTNmNGUwNDJmNjE0MzNjNzI4YzcwNTdiOTMxYmUiLCJDIjoiMDI5ZThlNTA1MGI4OTBhN2Q2YzA5NjhkYjE2YmMxZDVkNWZhMDQwZWExZGUyODRmNmVjNjlkNjEyOTlmNjcxMDU5In1dfV0sInVuaXQiOiJzYXQiLCJtZW1vIjoiVGhhbmsgeW91IHZlcnkgbXVjaC4ifQ==",
    amount: 10,
    mint: "https://8333.space:3338",
    memo: "Thank you very much.",
  },
  {
    format: "cashuA, one mint, unpadded",
    source: "copied: cdk crates/cashu/src/nuts/nut00/token.rs:645",
    token:
      "cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vODMzMy5zcGFjZTozMzM4IiwicHJvb2ZzIjpbeyJhbW91bnQiOjIsImlkIjoiMDA5YTFmMjkzMjUzZTQxZSIsInNlY3JldCI6IjQwNzkxNWJjMjEyYmU2MWE3N2UzZTZkMmFlYjRjNzI3OTgwYmRhNTFjZDA2YTZhZmMyOWUyODYxNzY4YTc4MzciLCJDIjoiMDJiYzkwOTc5OTdkODFhZmIyY2M3MzQ2YjVlNDM0NWE5MzQ2YmQyYTUwNmViNzk1ODU5OGE3MmYwY2Y4NTE2M2VhIn0seyJhbW91bnQiOjgsImlkIjoiMDA5YTFmMjkzMjUzZTQxZSIsInNlY3JldCI6ImZlMTUxMDkzMTRlNjFkNzc1NmIwZjhlZTBmMjNhNjI0YWNhYTNmNGUwNDJmNjE0MzNjNzI4YzcwNTdiOTMxYmUiLCJDIjoiMDI5ZThlNTA1MGI4OTBhN2Q2YzA5NjhkYjE2YmMxZDVkNWZhMDQwZWExZGUyODRmNmVjNjlkNjEyOTlmNjcxMDU5In1dfV0sInVuaXQiOiJzYXQiLCJtZW1vIjoiVGhhbmsgeW91IHZlcnkgbXVjaC4ifQ",
    amount: 10,
    mint: "https://8333.space:3338",
    memo: "Thank you very much.",
  },
  {
    format: "cashuB",
    source: "copied: cdk crates/cashu/src/nuts/nut00/token.rs:654",
    token:
      "cashuBpGF0gaJhaUgArSaMTR9YJmFwgaNhYQFhc3hAOWE2ZGJiODQ3YmQyMzJiYTc2ZGIwZGYxOTcyMTZiMjlkM2I4Y2MxNDU1M2NkMjc4MjdmYzFjYzk0MmZlZGI0ZWFjWCEDhhhUP_trhpXfStS6vN6So0qWvc2X3O4NfM-Y1HISZ5JhZGlUaGFuayB5b3VhbXVodHRwOi8vbG9jYWxob3N0OjMzMzhhdWNzYXQ=",
    amount: 1,
    mint: "http://localhost:3338",
    memo: "Thank you",
  },
  {
    format: "crawB (binary, as cashu.me writes it to an NFC tag)",
    source:
      "encoder: cashu-ts v4.9.0 getEncodedTokenBinary, as called at cashu.me src/components/DisplayTokenComponent.vue:595-600, on the NUT-00 V4 example token",
    token: ecashTokenTextFromBinary(Buffer.from(CRAWB_HEX, "hex")),
    amount: 10,
    mint: "https://8333.space:3338",
    memo: "Thank you.",
  },
];

describe("tokens the peers emit", () => {
  it.each(TOKENS)("$format", ({ token, amount, mint, memo, source }) => {
    expect(token, source).not.toBeNull();
    expect(decodeEcashTokenMetadata(token!)).toMatchObject({
      amount,
      mint,
      unit: "sat",
      ...(memo ? { memo } : {}),
    });
    expect(
      parsePaymentInput(token!, defaultDetectors).options.map((option) => option.kind),
    ).toEqual(["ecashToken"]);
  });

  it("takes only crawB for a binary token", () => {
    const bytes = Buffer.from(CRAWB_HEX, "hex");
    expect(ecashTokenTextFromBinary(bytes)).toMatch(/^cashuB/);
    expect(ecashTokenTextFromBinary(Buffer.from("crawA"))).toBeNull();
    expect(ecashTokenTextFromBinary(Buffer.from("crawB"))).toBeNull();
    expect(ecashTokenTextFromBinary(Buffer.from("cashuBabc"))).toBeNull();
  });
});

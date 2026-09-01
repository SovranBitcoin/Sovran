import { describe, expect, it } from "vitest";

import {
  annotationKey,
  candidateKeys,
  createInMemoryAnnotationStore,
  decodeAnnotation,
  encodeAnnotation,
  firstAnnotationRecord,
  mergeAnnotationRecords,
  getCounterparty,
  getScanSource,
  getSwap,
  isP2PKLocked,
  mergeAnnotationsIntoEntry,
  normaliseAnnotationRaw,
  rawAnnotationKey,
  type AnnotationEntryLike,
  type TransactionAnnotation,
} from "../../src/annotations";

describe("encodeAnnotation / decodeAnnotation", () => {
  it("round-trips a full annotation", () => {
    const annotation: TransactionAnnotation = {
      counterparty: {
        pubkey: "abc",
        displayName: "Alice",
        avatarUrl: "https://x/y.png",
        nip05: "alice@x",
        direction: "recipient",
      },
      scan: {
        method: "qr",
        raw: "bitcoin:bc1...",
        container: "bip321",
        optionKinds: ["lightning", "onchain"],
        inputType: "payment",
      },
      lock: { type: "p2pk", pubkey: "02deadbeef", direction: "incoming" },
      distribution: { source: "airdrop" },
      location: { lat: 51.5, lng: -0.12 },
      swap: { groupId: "g1", role: "mint", chainId: "c1", hopIndex: 2 },
      creqCustomization: {
        p2pkLock: true,
        excludedMints: ["https://m1", "https://m2"],
      },
      zap: {
        eventId: "e".repeat(64),
        eventKind: 1,
        authorPubkey: "f".repeat(64),
        authorName: "Alice",
        authorAvatarUrl: "https://x/a.png",
        contentPreview: "gm nostr",
        emoji: "👍",
        comment: "Great post 👍",
        receiptKind: "nip57",
      },
    };
    expect(decodeAnnotation(encodeAnnotation(annotation))).toEqual(annotation);
  });

  it("drops an unknown zap receiptKind but keeps the rest of the zap", () => {
    const record = encodeAnnotation({
      zap: { eventId: "abc", eventKind: 1, receiptKind: "plain" },
    });
    record.zapReceiptKind = "bogus";
    expect(decodeAnnotation(record).zap).toEqual({
      eventId: "abc",
      eventKind: 1,
    });
  });

  it("round-trips the numeric zap eventKind through the string record", () => {
    const record = encodeAnnotation({
      zap: { eventId: "abc", eventKind: 30023 },
    });
    expect(record.zapEventKind).toBe("30023");
    expect(decodeAnnotation(record).zap?.eventKind).toBe(30023);
  });

  it("persists a per-request p2pkLock:false and empty exclusions (overrides global)", () => {
    // A per-request 'off'/'advertise all' must be stored explicitly so it wins
    // over a global default of 'on'/excluded — not fall back to the global.
    const record = encodeAnnotation({
      creqCustomization: { p2pkLock: false, excludedMints: [] },
    });
    expect(record).toEqual({ creqP2pkLock: "0", creqExcludedMints: "[]" });
    expect(decodeAnnotation(record).creqCustomization).toEqual({
      p2pkLock: false,
      excludedMints: [],
    });
  });

  it("treats a malformed creqExcludedMints JSON as absent on decode", () => {
    expect(
      decodeAnnotation({ creqExcludedMints: "not-json" }).creqCustomization,
    ).toBeUndefined();
  });

  it("omits undefined and empty fields", () => {
    const record = encodeAnnotation({
      counterparty: { pubkey: "abc", displayName: undefined },
      scan: { optionKinds: [] },
    });
    expect(record).toEqual({ counterpartyPubkey: "abc" });
  });

  it("drops a location that is not fully finite", () => {
    expect(encodeAnnotation({ location: { lat: 1, lng: Number.NaN } })).toEqual(
      {},
    );
  });

  it("treats a malformed optionKinds JSON as absent on decode", () => {
    expect(
      decodeAnnotation({ scanOptionKinds: "not-json" }).scan,
    ).toBeUndefined();
  });

  it("round-trips onchain melt settlement facts", () => {
    const annotation: TransactionAnnotation = {
      onchainMelt: {
        outpoint: `${"ab".repeat(32)}:0`,
        outpointSource: "heuristic",
        feeIndex: 1,
        feeReserveSats: 2000,
        effectiveFeeSats: 1450,
        settledOffchain: true,
        address: "bc1qexampledestination",
        amountSats: 5000,
        accelerated: true,
      },
    };
    expect(decodeAnnotation(encodeAnnotation(annotation))).toEqual(annotation);
  });

  it("omits settledOffchain:false entirely (absence means unknown/on-chain)", () => {
    const record = encodeAnnotation({
      onchainMelt: { settledOffchain: false, outpoint: "deadbeef:0" },
    });
    expect(record.onchainSettledOffchain).toBeUndefined();
    expect(decodeAnnotation(record).onchainMelt).toEqual({
      outpoint: "deadbeef:0",
    });
  });

  it("treats an unknown outpointSource value as absent on decode", () => {
    const decoded = decodeAnnotation({
      onchainOutpoint: "deadbeef:1",
      onchainOutpointSource: "garbage",
    });
    expect(decoded.onchainMelt).toEqual({ outpoint: "deadbeef:1" });
  });

  it("keeps a partial onchainMelt (outpoint only) and drops non-finite fees", () => {
    const decoded = decodeAnnotation(
      encodeAnnotation({
        onchainMelt: { outpoint: "deadbeef:1", feeReserveSats: Number.NaN },
      }),
    );
    expect(decoded.onchainMelt).toEqual({ outpoint: "deadbeef:1" });
  });

  it("round-trips a payment-request linkage (payer and payee)", () => {
    const payer: TransactionAnnotation = {
      paymentRequest: {
        role: "payer",
        requestId: "sovabc123",
        transport: "nostr",
      },
    };
    expect(decodeAnnotation(encodeAnnotation(payer))).toEqual(payer);

    const payee: TransactionAnnotation = {
      paymentRequest: { role: "payee", transport: "inband" },
    };
    expect(decodeAnnotation(encodeAnnotation(payee))).toEqual(payee);
  });

  it("treats unknown payment-request role/transport values as absent on decode", () => {
    const decoded = decodeAnnotation({
      paymentRequestRole: "garbage",
      paymentRequestId: "sovabc123",
      paymentRequestTransport: "carrier-pigeon",
    });
    expect(decoded.paymentRequest).toEqual({ requestId: "sovabc123" });
  });

  it("produces no sub-objects for an empty record", () => {
    expect(decodeAnnotation({})).toEqual({});
  });
});

describe("annotationKey / candidateKeys", () => {
  const cases: Array<{
    name: string;
    entry: AnnotationEntryLike;
    key: string;
    candidates: string[];
  }> = [
    {
      name: "mint quote keys by quoteId",
      entry: { id: "m1", type: "mint", quoteId: "q1", operationId: "op1" },
      key: "quote:q1",
      candidates: ["quote:q1", "op:op1", "id:m1"],
    },
    {
      name: "melt quote keys by quoteId",
      entry: { id: "x1", type: "melt", quoteId: "q9" },
      key: "quote:q9",
      candidates: ["quote:q9", "id:x1"],
    },
    {
      name: "send keys by operationId",
      entry: { id: "s1", type: "send", operationId: "opS" },
      key: "op:opS",
      candidates: ["op:opS", "id:s1"],
    },
    {
      name: "in-flight receive strips the receive- prefix to the op key",
      entry: { id: "receive-R1", type: "receive", operationId: "R1" },
      key: "op:R1",
      candidates: ["op:R1", "id:receive-R1"],
    },
    {
      name: "in-flight receive without explicit operationId still strips prefix",
      entry: { id: "receive-R2", type: "receive" },
      key: "op:R2",
      candidates: ["op:R2", "id:receive-R2"],
    },
    {
      name: "falls back to id when no quote/op anchor exists",
      entry: { id: "plain", type: "receive" },
      key: "id:plain",
      candidates: ["id:plain"],
    },
    {
      name: "reads operationId from metadata",
      entry: { id: "z", type: "send", metadata: { operationId: "metaOp" } },
      key: "op:metaOp",
      candidates: ["op:metaOp", "id:z"],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(annotationKey(c.entry)).toBe(c.key);
      expect(candidateKeys(c.entry)).toEqual(c.candidates);
    });
  }

  it("an in-flight receive and its finalised row share one op key (the bridge)", () => {
    const inflight: AnnotationEntryLike = {
      id: "receive-OP",
      type: "receive",
      operationId: "OP",
    };
    const finalised: AnnotationEntryLike = {
      id: "real-id",
      type: "receive",
      operationId: "OP",
    };
    expect(annotationKey(inflight)).toBe(annotationKey(finalised));
    expect(candidateKeys(finalised)).toContain("op:OP");
  });

  it("keys the REAL coco-v2 receive shapes: in-flight receive-<opId> and finalised receive:<opId>", () => {
    // The live shapes: an in-flight synthetic entry `receive-<opId>` and the
    // coco operation-projected row `receive:<opId>` (colon), both carrying
    // `operationId`. Both must anchor on the same op key, and the finalised
    // row must also expose its own id key — the pair the raw→id bridge and
    // the list merge depend on.
    const opId = "1udIEOJSWCTuVPB083ecbA";
    const inflight: AnnotationEntryLike = {
      id: `receive-${opId}`,
      type: "receive",
      operationId: opId,
    };
    const finalised: AnnotationEntryLike = {
      id: `receive:${opId}`,
      type: "receive",
      operationId: opId,
    };
    expect(annotationKey(inflight)).toBe(`op:${opId}`);
    expect(annotationKey(finalised)).toBe(`op:${opId}`);
    expect(candidateKeys(finalised)).toEqual([
      `op:${opId}`,
      `id:receive:${opId}`,
    ]);
  });
});

describe("normaliseAnnotationRaw / rawAnnotationKey", () => {
  it("strips a leading scheme, trims, and lower-cases", () => {
    expect(normaliseAnnotationRaw("  Bitcoin:BC1XYZ ")).toBe("bc1xyz");
    expect(normaliseAnnotationRaw("lightning:LNBC1")).toBe("lnbc1");
  });

  it("hashes the normalised raw into a bounded key — a >1kB token must never become a persisted key", () => {
    const hugeToken = `cashu:${"cashuBo2F0".repeat(200)}`;
    const key = rawAnnotationKey(hugeToken);
    expect(key.startsWith("raw:")).toBe(true);
    expect(key.length).toBeLessThanOrEqual(256);
    // Deterministic across normalisation variants (scheme/case/whitespace)…
    expect(
      rawAnnotationKey(`  CASHU:${"cashuBo2F0".repeat(200).toUpperCase()} `),
    ).toBe(key);
    // …and distinct for distinct raw material.
    expect(rawAnnotationKey("cashu:other-token")).not.toBe(key);
  });
});

describe("mergeAnnotationsIntoEntry", () => {
  it("returns the same reference when the record is empty (stability)", () => {
    const entry = { id: "a", metadata: { foo: "bar" } };
    expect(mergeAnnotationsIntoEntry(entry, undefined)).toBe(entry);
    expect(mergeAnnotationsIntoEntry(entry, {})).toBe(entry);
  });

  it("adds annotation keys but lets coco metadata win on conflict", () => {
    const entry = {
      id: "a",
      metadata: { operationId: "coco", counterpartyPubkey: "cocoKey" },
    };
    const merged = mergeAnnotationsIntoEntry(entry, {
      counterpartyPubkey: "annKey",
      scanMethod: "qr",
    });
    expect(merged).not.toBe(entry);
    expect(merged.metadata).toEqual({
      operationId: "coco",
      counterpartyPubkey: "cocoKey",
      scanMethod: "qr",
    });
  });

  it("works when the entry has no metadata", () => {
    const merged = mergeAnnotationsIntoEntry(
      { id: "a" },
      { scanMethod: "nfc" },
    );
    expect(merged.metadata).toEqual({ scanMethod: "nfc" });
  });
});

describe("selectors over a merged entry", () => {
  it("reads counterparty, scan, swap, and p2pk", () => {
    const record = encodeAnnotation({
      counterparty: { pubkey: "pk", direction: "sender" },
      scan: { method: "paste" },
      swap: { groupId: "g", role: "melt" },
      lock: { type: "p2pk", direction: "outgoing" },
    });
    const entry = mergeAnnotationsIntoEntry({ id: "a" }, record);
    expect(getCounterparty(entry)).toEqual({
      pubkey: "pk",
      direction: "sender",
    });
    expect(getScanSource(entry)).toEqual({ method: "paste" });
    expect(getSwap(entry)).toEqual({ groupId: "g", role: "melt" });
    expect(isP2PKLocked(entry)).toBe(true);
  });

  it("reports not-locked for an un-annotated entry", () => {
    expect(isP2PKLocked({ id: "a", metadata: {} })).toBe(false);
  });

  it("falls back to proof secrets when there is no lock annotation", () => {
    const p2pkSecret = JSON.stringify(["P2PK", { data: "02abc" }]);
    const locked = { id: "s", token: { proofs: [{ secret: p2pkSecret }] } };
    const bearer = {
      id: "s2",
      token: { proofs: [{ secret: "plain-secret" }] },
    };
    expect(isP2PKLocked(locked)).toBe(true);
    expect(isP2PKLocked(bearer)).toBe(false);
  });

  it("reads legacy v3 token shape for the proof fallback", () => {
    const p2pkSecret = JSON.stringify(["P2PK", { data: "02abc" }]);
    const v3 = {
      id: "s3",
      token: { token: [{ proofs: [{ secret: p2pkSecret }] }] },
    };
    expect(isP2PKLocked(v3)).toBe(true);
  });
});

describe("in-memory annotation store", () => {
  it("field-merges patches and notifies subscribers", () => {
    const store = createInMemoryAnnotationStore();
    let notifications = 0;
    const unsub = store.subscribe(() => {
      notifications += 1;
    });

    store.set("op:1", { counterpartyPubkey: "pk" });
    store.set("op:1", { scanMethod: "qr" });
    expect(store.get("op:1")).toEqual({
      counterpartyPubkey: "pk",
      scanMethod: "qr",
    });
    expect(store.has("op:1")).toBe(true);
    expect(notifications).toBe(2);

    unsub();
    store.set("op:1", { scanMethod: "nfc" });
    expect(notifications).toBe(2);
  });

  it("ignores empty patches", () => {
    const store = createInMemoryAnnotationStore();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });
    store.set("op:1", {});
    expect(store.has("op:1")).toBe(false);
    expect(notifications).toBe(0);
  });

  it("mergeAnnotationRecords combines split-key annotations, canonical wins", () => {
    // distribution under quote:, location under id: — both belong to one entry.
    const store = createInMemoryAnnotationStore();
    store.set("quote:Q", { distributionSource: "copy", scanMethod: "qr" });
    store.set("id:E", { geoLat: "1", geoLng: "2", scanMethod: "nfc" });
    // candidateKeys order for a mint: [quote:Q, id:E] -> quote: wins on scanMethod.
    const merged = mergeAnnotationRecords(store.getMany(["quote:Q", "id:E"]));
    expect(merged).toEqual({
      distributionSource: "copy",
      scanMethod: "qr",
      geoLat: "1",
      geoLng: "2",
    });
  });

  it("getMany + firstAnnotationRecord resolves the first hit across candidate keys", () => {
    const store = createInMemoryAnnotationStore();
    store.set("op:OP", { scanMethod: "qr" });
    const entry: AnnotationEntryLike = {
      id: "real",
      type: "receive",
      operationId: "OP",
    };
    const record = firstAnnotationRecord(store.getMany(candidateKeys(entry)));
    expect(record).toEqual({ scanMethod: "qr" });
  });

  it("linkAnnotation pattern bridges a raw key to the final entry key", () => {
    // The write hook implements linkAnnotation as get(from) → set(to). Verify
    // that an entry resolves the scan written under its raw key once bridged.
    const store = createInMemoryAnnotationStore();
    const rawKey = rawAnnotationKey("cashu:TOKEN");
    store.set(
      rawKey,
      encodeAnnotation({ scan: { method: "qr", raw: "cashu:TOKEN" } }),
    );

    const entry: AnnotationEntryLike = {
      id: "r",
      type: "receive",
      operationId: "OP9",
    };
    const bridged = store.get(rawKey);
    if (bridged) store.set(annotationKey(entry), bridged);

    const record = firstAnnotationRecord(store.getMany(candidateKeys(entry)));
    expect(
      getScanSource(mergeAnnotationsIntoEntry({ id: "r" }, record)),
    ).toMatchObject({
      method: "qr",
    });
  });
});

describe("candidateKeys fields the annotation hook must key on", () => {
  // `useColadaTransactionAnnotation` used to memoise on a hand-picked
  // `[entry.id, entry.quoteId, entry.operationId]` behind an exhaustive-deps
  // suppression. These are the two inputs that list did NOT name, so an entry
  // that gained either one kept serving the annotation resolved before it.
  it("adds the quote key only once `type` says mint or melt", () => {
    const withoutType: AnnotationEntryLike = { id: "E", quoteId: "Q" };
    const asMint: AnnotationEntryLike = { id: "E", quoteId: "Q", type: "mint" };

    expect(candidateKeys(withoutType)).not.toContain("quote:Q");
    expect(candidateKeys(asMint)).toContain("quote:Q");
    expect(candidateKeys(withoutType)).not.toEqual(candidateKeys(asMint));
  });

  it("reads the operation id out of metadata when the column is empty", () => {
    const bare: AnnotationEntryLike = { id: "E" };
    const withMetaOp: AnnotationEntryLike = {
      id: "E",
      metadata: { operationId: "OP" },
    };

    expect(candidateKeys(bare)).not.toContain("op:OP");
    expect(candidateKeys(withMetaOp)).toContain("op:OP");
    expect(candidateKeys(bare)).not.toEqual(candidateKeys(withMetaOp));
  });
});

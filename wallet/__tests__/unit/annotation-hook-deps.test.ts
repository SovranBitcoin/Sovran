import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the read mechanism of `useColadaTransactionAnnotation`.
 *
 * The hook resolves a transaction's annotation across every key
 * `candidateKeys` would look up, and must re-read on every store write. Two
 * earlier shapes both went stale:
 *
 * - a memo on `[entry?.id, entry?.quoteId, entry?.operationId]` behind an
 *   exhaustive-deps suppression, narrower than what `candidateKeys` reads;
 * - a `version` counter bumped from a subscription and listed as a memo
 *   dependency the body never read, which the React Compiler (tracking only
 *   what the body reads) dropped — the payment-request P2PK and mint toggles
 *   wrote to the store and the screen kept the value resolved at mount.
 *
 * `wallet` has no React renderer in its test setup, so this asserts against
 * the source the way `app/__tests__/bitchatAndroidNativeSource.test.ts` does
 * for the Kotlin bridge. It is deliberately about the MECHANISM.
 */
const SOURCE = readFileSync(
  resolve(__dirname, "../../src/react/useColadaTransactionAnnotation.ts"),
  "utf8",
);

describe("useColadaTransactionAnnotation read mechanism", () => {
  it("reads through useSyncExternalStore, so every store emit re-runs the read", () => {
    expect(SOURCE).toContain(
      "useSyncExternalStore(subscribe, getSnapshot, getSnapshot)",
    );
    expect(SOURCE).toContain("store.subscribe(onStoreChange)");
  });

  it("carries no version counter that a memo could list without reading", () => {
    expect(SOURCE).not.toContain("setVersion");
    expect(SOURCE).not.toContain("useState(");
    expect(SOURCE).not.toContain("useEffect(");
  });

  it("closes over the whole entry rather than hand-picked fields", () => {
    const deps = /\}, \[([^\]]*)\]\);/.exec(SOURCE)?.[1];
    expect(deps).toBe("store, entry");
    for (const narrowed of [
      "entry?.id",
      "entry?.quoteId",
      "entry?.operationId",
    ]) {
      expect(SOURCE).not.toContain(narrowed);
    }
  });

  it("looks the record up from the entry's candidate keys", () => {
    expect(SOURCE).toContain("const keys = candidateKeys(entry);");
    expect(SOURCE).toContain("store.getMany(keys)");
  });

  it("keeps the snapshot referentially stable while the records are unchanged", () => {
    // Without this, useSyncExternalStore would see a new object per read and
    // re-render without end.
    expect(SOURCE).toContain("sameRecords(last.records, records)");
  });

  it("carries no react-hooks suppression, which would skip the compiler", () => {
    expect(SOURCE).not.toMatch(/eslint-disable[^\n]*react-hooks/);
  });
});

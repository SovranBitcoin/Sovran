import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the dependency list of `useColadaTransactionAnnotation`.
 *
 * The hook resolves a transaction's annotation across every key
 * `candidateKeys` would look up. It used to memoise on a hand-picked
 * `[entry?.id, entry?.quoteId, entry?.operationId]` behind an
 * exhaustive-deps suppression — narrower than what `candidateKeys` actually
 * reads (`type` and `metadata.operationId` as well), so an entry that gained
 * either one kept serving the annotation resolved before it. The suppression
 * also switched the React Compiler off for the whole hook.
 *
 * `wallet` has no React renderer in its test setup, so this asserts against
 * the source the way `app/__tests__/bitchatAndroidNativeSource.test.ts` does
 * for the Kotlin bridge. It is deliberately about the MECHANISM: narrowing the
 * list back, or re-adding the suppression, fails here.
 */
const SOURCE = readFileSync(
  resolve(__dirname, "../../src/react/useColadaTransactionAnnotation.ts"),
  "utf8",
);

const DEPS = /return useMemo\([\s\S]*?\}, \[([^\]]*)\]\);/.exec(SOURCE)?.[1];

describe("useColadaTransactionAnnotation dependencies", () => {
  it("keys on the derived cache key, not on hand-picked entry fields", () => {
    expect(DEPS).toBeDefined();
    expect(DEPS).toContain("cacheKey");
    for (const narrowed of [
      "entry?.id",
      "entry?.quoteId",
      "entry?.operationId",
    ]) {
      expect(DEPS).not.toContain(narrowed);
    }
  });

  it("derives that cache key from candidateKeys, so every keyed field counts", () => {
    expect(SOURCE).toContain(
      'const cacheKey = entry ? candidateKeys(entry).join(KEY_SEPARATOR) : "";',
    );
  });

  it("looks the record up from the entry rather than by splitting the key", () => {
    // Splitting the joined key back apart would fan an id that contained the
    // separator out into several keys, reading another transaction's
    // annotation. The cache key is only ever a cache key.
    expect(SOURCE).toContain("store.getMany(candidateKeys(entry))");
    expect(SOURCE).not.toContain("split(KEY_SEPARATOR)");
  });

  it("carries no react-hooks suppression, which would skip the compiler", () => {
    expect(SOURCE).not.toMatch(/eslint-disable[^\n]*react-hooks/);
  });
});

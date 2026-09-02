import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the mechanisms that make `wallet/src/react` compilable.
 *
 * Metro pins the `wallet*` specifiers to this package's TypeScript source, so
 * babel-preset-expo runs the React Compiler over these files in both the iOS
 * and the Android bundle. A bailout raises no error — the hook simply renders
 * unmemoized — and until `scripts/check-react-compiler.mjs` was widened to
 * sweep `wallet/src`, nothing reported one. The ratchet is the outer guard;
 * this file guards the specific shapes that fixed each bailout, so a plausible
 * "tidy-up" cannot quietly undo them.
 *
 * `wallet` has no React renderer in its test setup, so these assert against the
 * source the way `annotation-hook-deps.test.ts` already does.
 */
function read(relativePath: string): string {
  return readFileSync(resolve(__dirname, "../../src", relativePath), "utf8");
}

/**
 * Source with comments stripped. Every assertion below is about what the code
 * DOES, and these files explain the old shapes in prose — matching a comment
 * would make the guard pass or fail for the wrong reason.
 */
function code(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const REACT_FILES = [
  "react/ColadaProvider.tsx",
  "react/useColadaTransactions.ts",
  "react/usePaymentMachine.ts",
  "react/useScreenActions.ts",
];

describe("wallet/src/react compiler mechanisms", () => {
  it.each(REACT_FILES)(
    "%s carries no react-hooks suppression",
    (relativePath) => {
      // A single `eslint-disable` of a react-hooks rule anywhere in a file
      // makes the compiler skip every function in it. This package has no
      // ESLint config at all, so such a comment silences nothing and costs
      // the whole file its memoization.
      expect(read(relativePath)).not.toMatch(/eslint-disable[^\n]*react-hooks/);
    },
  );
});

describe("useColadaTransactions", () => {
  const SOURCE = code("react/useColadaTransactions.ts");

  it("returns hasMore from state, never read off a ref in render", () => {
    // `hasMore: hasMoreRef.current` was a ref read during render: nothing
    // re-rendered when the ref moved, so an infinite-scroll list could keep
    // requesting a page that no longer exists, or stop while pages remained.
    expect(SOURCE).toContain("const [hasMore, setHasMore] = useState(true);");
    expect(SOURCE).not.toContain("hasMore: hasMoreRef.current");
    // The ref survives only as the synchronous re-entry guard, and every
    // write goes through the mirror so the two cannot drift.
    expect(SOURCE).toContain("if (!hasMoreRef.current || fetchingRef.current)");
    expect(SOURCE).toMatch(
      /const applyHasMore = useCallback\(\(value: boolean\) => \{\s*hasMoreRef\.current = value;\s*setHasMore\(value\);/,
    );
    expect(SOURCE.match(/hasMoreRef\.current = /g)).toHaveLength(1);
  });

  it("publishes hasMore only from a run that is still the live one", () => {
    // As state it is no longer inert: a run this hook already cancelled (a
    // pageSize change, or the manager swapping) would publish its page length
    // as the live flag and either stop pagination early or keep asking past
    // the end. Every write sits inside the liveness guard.
    const lines = SOURCE.split("\n");
    const calls = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /^\s*applyHasMore\(/.test(line));
    expect(calls).toHaveLength(3);
    for (const { index } of calls) {
      expect(lines[index - 1]).toMatch(/if \(.*mountedRef\.current\) \{$/);
    }
  });

  it("keeps the list's reference when no annotation on screen changed", () => {
    // The annotation store notifies on every write, including one for a
    // transaction that is not on screen. Without the stabiliser each of those
    // hands every history consumer a brand-new array.
    expect(SOURCE).toContain(
      "const [annotateList] = useState(createAnnotatedListStabiliser);",
    );
    expect(SOURCE).toMatch(
      /if \(sameAnnotatedList\(previous, annotated\)\) return previous;/,
    );
    // The cache is a closure variable, not a ref: a ref read in render is what
    // the compiler refuses, and reverting to one would take the hook with it.
    expect(SOURCE).toContain("let previous: HistoryEntry[] = [];");
    expect(SOURCE).not.toContain("prevAnnotatedRef");
  });

  it("stabilises every list at the setter, not from a ref in render", () => {
    // Identity used to be re-derived in render from `prevMergedRef` /
    // `prevAnnotatedRef` snapshots. Those are gone; each producer now keeps
    // the previous array itself, which React also short-circuits.
    expect(SOURCE).not.toContain("prevMergedRef");
    for (const setter of [
      "setCocoHistory",
      "setReceiveEntries",
      "setPendingRequestEntries",
    ]) {
      const calls = SOURCE.match(new RegExp(`${setter}\\(`, "g")) ?? [];
      expect(calls.length).toBeGreaterThan(0);
      // Every call site is an updater form; none assigns a fresh array
      // straight in, which would hand consumers a new list for the same rows.
      expect(SOURCE).not.toMatch(
        new RegExp(`${setter}\\((?!\\(prev\\)|\\(prev:)`),
      );
    }
    expect(SOURCE).toMatch(
      /return sameTransactionList\(prev, next\) \? prev : next;/,
    );
  });

  it("holds the manager in a ref written after commit, not during render", () => {
    expect(SOURCE).toContain("const managerRef = useLatestRef(manager);");
    expect(SOURCE).not.toContain("managerRef.current = manager;");
  });

  it("uses no try/finally statement, which the compiler cannot lower", () => {
    // The three paginating callbacks kept their "always stop fetching"
    // guarantee by moving it onto `Promise.prototype.finally`.
    expect(SOURCE).not.toMatch(/\}\s*finally\s*\{/);
    expect(
      SOURCE.match(/await run\(\)\.finally\(\(\) => setFetching\(false\)\);/g),
    ).toHaveLength(3);
  });
});

describe("ColadaProvider flow bindings", () => {
  const SOURCE = code("react/ColadaProvider.tsx");

  it("owns the mutation instead of handing screens a writable ref", () => {
    // `ctx.walletContextRef.current = …` from `usePaymentFlowMachine` is a
    // write through a value reached from `useContext`, which the compiler
    // rejects outright. The provider exposes writers instead.
    expect(SOURCE).not.toMatch(/ctx\.\w+Ref\.current\s*=/);
    expect(SOURCE).toContain("ctx.bindings.setWalletContext(walletContext)");
    expect(SOURCE).toContain("ctx.bindings.setUnitOverride(unit)");
    expect(SOURCE).toContain("ctx.bindings.clearUnitOverride(unit)");
    expect(SOURCE).toContain("ctx.bindings.setOptionDismiss(onOptionDismiss)");
    expect(SOURCE).toContain(
      "ctx.bindings.clearOptionDismiss(onOptionDismiss)",
    );
  });

  it("keeps every release compare-and-clear", () => {
    // A binder unmounting must never wipe a newer screen's override — the
    // first-open-wrong-unit bug. Moving the assignments behind the writers
    // must not have dropped the guard.
    expect(SOURCE).toMatch(
      /clearUnitOverride: \(unit\) => \{\s*if \(unitRef\.current === unit\) unitRef\.current = undefined;/,
    );
    expect(SOURCE).toMatch(
      /clearOptionDismiss: \(onOptionDismiss\) => \{\s*if \(optionDismissRef\.current !== onOptionDismiss\) return false;/,
    );
  });

  it("builds the machine in a create-once initializer, not a render ref read", () => {
    // `machineRef.current!` in the context value was the ref read; the machine
    // is a plain value now, so nothing reaches for `.current` during render.
    expect(SOURCE).not.toContain("machineRef");
    expect(SOURCE).toContain("const [core] = useState(() => {");
    expect(SOURCE).toContain("machine,");
  });
});

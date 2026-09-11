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

// Transaction behavior is exercised through real hooks in the app renderer's
// walletReadModels.test.ts; source spelling cannot prove snapshot or paging safety.

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

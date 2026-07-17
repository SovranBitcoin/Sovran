import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Selector registry for the balance-split e2e scenario
// (mint.split.consolidate). Each testID pinned here is load-bearing for a
// scenario in e2e/scenarios/ — renaming one breaks a simulator run, not just
// a unit test.

const read = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

describe('mint distribution e2e selectors', () => {
  it('pins the per-mint toggle on the balance-split cards', () => {
    const source = read('features/mint/components/distribution/MintDistributionCards.tsx');
    // The switch is the only deterministic way to force one mint to 100%
    // (turning every other mint off); its aria-label depends on async mint
    // metadata, so the mintUrl-keyed testID is the e2e selector. Its AX value
    // ("1"/"0") is the waitable toggle signal — plain Text testIDs never reach
    // the iOS AX tree (proven by run 2026-07-15T10-22-59), so don't add ids to
    // the % / Off labels expecting to select on them.
    expect(source).toContain('testID={`mint-distribution-toggle:${mintUrl}`}');
  });

  it('pins the distribution screen footer and the split-evenly switch accessibility', () => {
    const source = read('features/mint/screens/MintDistributionScreen.tsx');
    expect(source).toContain("testID: 'mint-distribution-next'");
    // The switch is AX-invisible without a label on liquid-glass devices.
    expect(source).toContain('testID="mint-distribution-split-evenly"');
    expect(source).toContain('aria-label="Split evenly"');
  });

  it('pins the rebalance-plan buttons for every run state', () => {
    const source = read('features/mint/screens/MintRebalancePlanScreen.tsx');
    expect(source).toContain("testID: 'rebalance-start'");
    expect(source).toContain("testID: 'rebalance-cancel'");
    expect(source).toContain("testID: 'rebalance-done'");
    expect(source).toContain("testID: 'rebalance-retry-failed'");
    expect(source).toContain("testID: 'rebalance-stop'");
    // The empty/already-balanced plan renders a DIFFERENT id on purpose:
    // waiting on 'rebalance-done' must never match a plan that computed zero
    // transfer steps.
    expect(source).toContain("testID: 'rebalance-done-noop'");
    expect(source.match(/testID: 'rebalance-done'/g)).toHaveLength(1);
  });

  it('keeps the ButtonHandler testID passthrough the rebalance buttons rely on', () => {
    const source = read('shared/ui/composed/ButtonHandler.tsx');
    expect(source).toContain('testID?: string');
    expect(source).toContain('testID={button.testID}');
  });

  it('pins the swap-review navigation selectors (home row → detail → close)', () => {
    const flowHeader = read('config/flowLayoutOptions.tsx');
    // ScreenHeaderAction is AX-visible only WITH an accessibilityLabel — the
    // testID alone would leave the flow close/back button unselectable.
    expect(flowHeader).toContain(
      "testID={isFirstScreen ? 'flow-header-close' : 'flow-header-back'}"
    );
    expect(flowHeader).toContain("accessibilityLabel={isFirstScreen ? 'Close screen' : 'Go back'}");

    // The row id's suffix is the swap group id; e2e captures it with
    // idPrefix "swap-row-" and matches it against the detail's swap-id probe.
    expect(read('features/transactions/components/SwapTransactionRow.tsx')).toContain(
      'testID={`swap-row-${group.id}`}'
    );
    expect(read('features/transactions/components/detail/TransactionDetailShell.tsx')).toContain(
      'testID={testID}'
    );
    expect(read('features/transactions/screens/SwapTransactionScreen.tsx')).toContain(
      'testID={`swap-id-${group.id}`}'
    );
  });
});

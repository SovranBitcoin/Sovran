import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Selector registry for the npc lightning-address e2e scenarios
// (receive.npc.default-mint, receive.npc.change-mint). Each testID pinned
// here is load-bearing for a scenario in e2e/scenarios/ — renaming one
// breaks a simulator run, not just a unit test.

const read = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

describe('npc receive e2e selectors', () => {
  it('pins receive-npc-mint-row on the ReceiveScreen mint row', () => {
    const source = read('features/receive/screens/ReceiveScreen.tsx');
    expect(source).toContain('testID="receive-npc-mint-row"');
    // PressableFeedback rows without an accessibilityLabel are AX-invisible
    // on liquid-glass iOS — the label is load-bearing for the e2e selector.
    expect(source).toContain('accessibilityLabel="Change receive mint"');
  });

  it('forwards testID and accessibilityLabel through HistoryEntryRefresh', () => {
    const source = read('features/transactions/components/detail/HistoryEntryRefresh.tsx');
    expect(source).toContain('testID={testID}');
    expect(source).toContain('accessibilityLabel={accessibilityLabel}');
  });

  it('pins the lightning mode pills on the receive QR display', () => {
    const source = read('features/receive/screens/ReceiveScreen.tsx');
    expect(source).toContain("'receive-lightning-mode-address'");
    expect(source).toContain("'receive-lightning-mode-offer'");
  });

  it('mirrors toast evidence inside the sheet screens the scenarios wait on', () => {
    // iOS modal AX hides the root-layout E2EToastProbe behind flow sheets, so
    // any screen a scenario waits for e2e-toast-* / payment-status-* on must
    // mount its own probe (TransactionDetailShell precedent). Proven by
    // receive.npc.change-mint's second sim run: the "Receive mint updated"
    // toast rendered on video but never reached the AX tree.
    expect(read('features/receive/screens/ReceiveScreen.tsx')).toContain('<E2EToastProbe />');
    expect(read('features/send/screens/SendScreen.tsx')).toContain('<E2EToastProbe />');
  });

  it('derives payment-info-address-data from the address copy target', () => {
    // PaymentInfo renders testID={`payment-info-${kebabCase(copyTarget)}-data`};
    // the npc rail mounts it with copyTarget="address", which the scenarios
    // capture the full lightning address from (accessibilityLabel).
    expect(read('shared/blocks/PaymentInfo.tsx')).toContain(
      'testID={`payment-info-${kebabCase(copyTarget)}-data`}'
    );
    expect(read('features/receive/screens/ReceiveScreen.tsx')).toContain('copyTarget="address"');
  });
});

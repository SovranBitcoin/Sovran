/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { AmountSelectedMintProbe } from '@/features/send/components/AmountSelectedMintProbe';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: (props: Record<string, unknown>) => <view {...props} />,
}));

describe('AmountSelectedMintProbe', () => {
  it('exposes the preselected mint host without leaking the full URL', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AmountSelectedMintProbe mintUrl="https://mint.minibits.cash/Bitcoin?private=never-expose" />
      );
    });

    const probe = renderer!.root.findByProps({
      testID: 'amount-selected-mint:mint.minibits.cash',
    });
    expect(probe.props.accessibilityValue).toEqual({ text: 'mint.minibits.cash' });
    expect(JSON.stringify(probe.props)).not.toContain('Bitcoin');
    expect(JSON.stringify(probe.props)).not.toContain('never-expose');
  });

  it('is mounted on the amount flow screen when a mint is preselected', () => {
    // Source pin: the probe only proves preselection if the amount screen
    // actually renders it — e2e scenarios wait on amount-selected-mint:<host>.
    const { readFileSync } = jest.requireActual<typeof import('node:fs')>('node:fs');
    const { resolve } = jest.requireActual<typeof import('node:path')>('node:path');
    const source = readFileSync(
      resolve(__dirname, '..', 'features/send/screens/AmountFlowScreen.tsx'),
      'utf8'
    );
    expect(source).toContain('<AmountSelectedMintProbe mintUrl={mintUrl} />');
  });
});

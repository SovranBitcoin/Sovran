/**
 * @jest-environment node
 */

import TestRenderer, { act } from 'react-test-renderer';

import {
  MeltSelectedMintProbe,
  meltSelectedMintHost,
} from '@/features/send/components/MeltSelectedMintProbe';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: (props: Record<string, unknown>) => <view {...props} />,
}));

describe('MeltSelectedMintProbe', () => {
  it('binds a safe mint host to the current transaction id', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <MeltSelectedMintProbe
          mintUrl="https://mint.minibits.cash/Bitcoin?private=never-expose"
          transactionId="preview-2"
        />
      );
    });

    const probe = renderer!.root.find((node) => node.type === 'view');
    expect(probe.props.testID).toBe('melt-selected-mint:mint.minibits.cash:preview-2');
    expect(probe.props.accessibilityValue).toEqual({ text: 'mint.minibits.cash' });
    expect(JSON.stringify(probe.props)).not.toContain('Bitcoin');
    expect(JSON.stringify(probe.props)).not.toContain('never-expose');
  });

  it('fails closed to an unknown host for malformed input', () => {
    expect(meltSelectedMintHost('not a mint url with secret material')).toBe('unknown');
  });
});

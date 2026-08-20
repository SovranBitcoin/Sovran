/**
 * @jest-environment node
 */

import TestRenderer, { act } from 'react-test-renderer';

import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: (props: Record<string, unknown>) => <view {...props} />,
}));

describe('E2EAccessibilityProbe', () => {
  it('owns the proven inert AX envelope and exposes value text', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <E2EAccessibilityProbe
          testID="safe-probe"
          accessibilityLabel="Safe evidence"
          value="safe-value"
        />
      );
    });

    const probe = renderer!.root.find((node) => node.type === 'view');
    expect(probe.props).toMatchObject({
      accessible: true,
      accessibilityRole: 'text',
      accessibilityLabel: 'Safe evidence',
      accessibilityValue: { text: 'safe-value' },
      importantForAccessibility: 'yes',
      collapsable: false,
      pointerEvents: 'none',
      className: 'absolute left-0 top-0 h-px w-px',
    });
  });

  it('omits the AX value when Android carries evidence in the label', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <E2EAccessibilityProbe testID="android-probe" accessibilityLabel="encoded-value" />
      );
    });

    const probe = renderer!.root.find((node) => node.type === 'view');
    expect(probe.props.accessibilityValue).toBeUndefined();
  });
});

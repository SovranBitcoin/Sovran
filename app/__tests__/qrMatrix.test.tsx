/**
 * @jest-environment node
 *
 * The static QR: one butt-capped stroke path over a background square of the
 * requested size, and nothing at all for input that cannot be encoded.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { encodeQrPath } from '@/shared/lib/qrPlaceholderFrames';
import { QrMatrix } from '@/shared/ui/primitives/QrMatrix';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const host = (name: string) => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement(View, { testID: name, ...props }, children);
};

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: host('svg-root'),
  Path: host('svg-path'),
  Rect: host('svg-rect'),
}));

function render(value: string) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <QrMatrix value={value} size={120} color="black" backgroundColor="white" />
    );
  });
  return renderer;
}

const byTestId = (root: TestRenderer.ReactTestInstance, testID: string) =>
  root.findAll((node) => node.props.testID === testID && typeof node.type !== 'string');

describe('QrMatrix', () => {
  it('draws the encoded value on its background at the requested size', () => {
    const { root } = render('npub1example');
    const svg = byTestId(root, 'svg-root')[0]!;
    expect(svg.props).toMatchObject({ width: 120, height: 120, viewBox: '0 0 120 120' });
    expect(byTestId(root, 'svg-rect')[0]!.props).toMatchObject({
      width: 120,
      height: 120,
      fill: 'white',
    });
    const expected = encodeQrPath('npub1example', 120);
    expect(byTestId(root, 'svg-path')[0]!.props).toMatchObject({
      d: expected.d,
      stroke: 'black',
      strokeWidth: expected.cellSize,
      strokeLinecap: 'butt',
    });
  });

  it('renders nothing for input it cannot encode', () => {
    expect(render('').toJSON()).toBeNull();
  });
});

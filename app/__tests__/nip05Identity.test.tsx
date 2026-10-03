/** @jest-environment node */
import type { PropsWithChildren } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Nip05Identity, PaymentIdentity } from '@/shared/ui/composed/Nip05Identity';
import type { Nip05State } from '@/shared/hooks/useNip05Verification';
import { staticColor } from '@/shared/lib/themeEngine';

const mockVerification = jest.fn();
jest.mock('@/shared/hooks/useNip05Verification', () => ({
  useNip05Verification: (address: string, pubkey: string) => mockVerification(address, pubkey),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'mock-theme-color' }));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: (props: PropsWithChildren<Record<string, unknown>>) =>
    jest
      .requireActual<typeof import('react')>('react')
      .createElement('text', props, props.children),
}));
jest.mock('@/assets/icons', () => ({
  __esModule: true,
  default: (props: { name: string; color: string }) =>
    jest.requireActual<typeof import('react')>('react').createElement('icon', props),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: TestRenderer.ReactTestRenderer;
afterEach(() => {
  act(() => renderer?.unmount());
  jest.clearAllMocks();
});
const cases: [Nip05State, string, string][] = [
  [
    { status: 'verified', identifier: 'alice@example.com' },
    'Domain matches this key',
    staticColor['blue-300'],
  ],
  [
    { status: 'mismatch', identifier: 'alice@example.com' },
    'Does not match this key',
    staticColor['red-300'],
  ],
  [{ status: 'error', reason: 'network' }, 'Could not verify', staticColor['red-300']],
  [{ status: 'pending' }, 'Not verified', 'mock-theme-color'],
];
it.each(cases)(
  'renders the verification outcome %j without trusting a profile flag',
  (state, label, color) => {
    mockVerification.mockReturnValue({ state });
    act(() => {
      renderer = TestRenderer.create(
        <Nip05Identity address="alice@example.com" pubkey={'a'.repeat(64)} detail />
      );
    });
    expect(
      renderer.root.findAllByProps({ accessibilityLabel: `alice@example.com. ${label}` }).length
    ).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ color }).length).toBeGreaterThan(0);
    expect(mockVerification).toHaveBeenCalledWith('alice@example.com', 'a'.repeat(64));
  }
);
it('labels the public key correctly for both incoming and outgoing payments', () => {
  act(() => {
    renderer = TestRenderer.create(<PaymentIdentity pubkey={'a'.repeat(64)} />);
  });
  const labels = renderer.root
    .findAll((node) => typeof node.props.accessibilityLabel === 'string')
    .map((node) => node.props.accessibilityLabel);
  expect(labels.some((label: string) => label.startsWith('Public key npub1'))).toBe(true);
  expect(labels.some((label: string) => label.startsWith('Recipient'))).toBe(false);
});

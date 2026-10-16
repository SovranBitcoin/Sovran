/**
 * The nostrconnect:// deep-link target. The link embeds the pairing secret,
 * so the route is given a ticket and redeems it from memory; it must never
 * take the link from a route param.
 */

/* eslint-disable import/first */

const mockReplace = jest.fn();
const mockOpenPairingFromUri = jest.fn();
const mockPopup = jest.fn();
let mockParams: Record<string, string> | null = null;

jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { replace: (...args: unknown[]) => mockReplace(...args) },
}));
jest.mock('@/shared/lib/nav/useRouteParams', () => ({
  useRouteParams: (schema: {
    safeParse: (value: unknown) => { success: boolean; data?: unknown };
  }) => {
    const parsed = schema.safeParse(mockParams);
    return parsed.success ? parsed.data : null;
  },
}));
jest.mock('@/features/nostrSigner', () => ({
  openPairingFromUri: (...args: unknown[]) => mockOpenPairingFromUri(...args),
  PAIRING_ERROR_BUNKER: 'bunker',
  PAIRING_ERROR_INVALID_LINK: 'invalid',
  PAIRING_ERROR_TITLE: 'title',
}));
jest.mock('@/shared/lib/popup', () => ({ popup: (...args: unknown[]) => mockPopup(...args) }));
jest.mock('@/shared/lib/popup/E2EActionMenuProbe', () => ({ E2EActionMenuProbe: () => null }));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));

import { render } from '@testing-library/react-native';
import { ok } from 'neverthrow';

import SignerConnectRoute from '@/app/(signer-flow)/connect';
import { MAX_NOSTRCONNECT_URI_LENGTH } from '@/features/nostrSigner/lib/nip46Uri';
import { holdPairingUri } from '@/features/nostrSigner/lib/pendingPairingUri';

const URI = `nostrconnect://${'a1'.repeat(32)}?relay=wss%3A%2F%2Frelay.example.com&secret=fixture-secret`;

beforeEach(() => {
  jest.clearAllMocks();
  mockOpenPairingFromUri.mockReturnValue(ok(undefined));
});

it('opens pairing with the link held for its ticket', () => {
  mockParams = { ticket: holdPairingUri(URI) };
  render(<SignerConnectRoute />);

  expect(mockOpenPairingFromUri).toHaveBeenCalledWith(URI);
  expect(mockReplace).not.toHaveBeenCalled();
});

it('ignores a link passed as a route param', () => {
  mockParams = { uri: URI };
  render(<SignerConnectRoute />);

  expect(mockOpenPairingFromUri).not.toHaveBeenCalled();
});

it('opens a second link that arrives while the route is up', () => {
  mockParams = { ticket: holdPairingUri(URI) };
  const view = render(<SignerConnectRoute />);
  const second = `${URI}&name=Second`;
  mockParams = { ticket: holdPairingUri(second) };
  view.rerender(<SignerConnectRoute />);

  expect(mockOpenPairingFromUri).toHaveBeenLastCalledWith(second);
  expect(mockOpenPairingFromUri).toHaveBeenCalledTimes(2);
});

it('goes to the signer hub, quietly, when the ticket has nothing behind it', () => {
  const ticket = holdPairingUri(URI);
  mockParams = { ticket };
  render(<SignerConnectRoute />).unmount();
  jest.clearAllMocks();

  render(<SignerConnectRoute />);

  expect(mockOpenPairingFromUri).not.toHaveBeenCalled();
  expect(mockPopup).not.toHaveBeenCalled();
  expect(mockReplace).toHaveBeenCalledWith('/(signer-flow)');
});

it('refuses a link longer than the limit', () => {
  mockParams = { ticket: holdPairingUri(URI + 'x'.repeat(MAX_NOSTRCONNECT_URI_LENGTH)) };
  render(<SignerConnectRoute />);

  expect(mockOpenPairingFromUri).not.toHaveBeenCalled();
  expect(mockPopup).toHaveBeenCalledWith(
    expect.objectContaining({ text: 'invalid', type: 'error' })
  );
  expect(mockReplace).toHaveBeenCalledWith('/(signer-flow)');
});

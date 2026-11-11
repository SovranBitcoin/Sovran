/**
 * The White Noise setup card on Contacts: what it shows after "Set up" is
 * pressed. The real setup hook runs against a fake Marmot client given
 * through `WhitenoiseContext`, so the card reacts to an actual key-package
 * publish that succeeds or fails. The loading indicator is replaced by one
 * that records the phase it was asked to show.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { WhitenoiseContext } from '@/features/whitenoise/WhitenoiseContext';
import { relays } from '@/shared/ndk';
import { WhitenoiseSetupBanner } from '@/features/whitenoise/components/WhitenoiseSetupBanner';

const mockIndicatorPhases: string[] = [];
// eslint-disable-next-line no-restricted-syntax -- a parseable theme fixture, not a UI color
const mockColor = '#222222';

jest.mock('expo-router', () => ({ usePathname: () => '/contacts' }));
jest.mock('@/shared/hooks/useScreenInsets', () => ({ useScreenInsets: () => ({ bottom: 0 }) }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: ({ children }: { children: ReactNode }) => children },
  FadeIn: { duration: () => undefined },
  FadeOut: { duration: () => undefined },
}));
jest.mock('@/shared/blocks/status', () => ({
  LoadingIndicator: ({ phase }: { phase: string }) => {
    mockIndicatorPhases.push(phase);
    return null;
  },
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (selector: (s: { whitenoiseEnabled: boolean }) => unknown) =>
    selector({ whitenoiseEnabled: true }),
}));
jest.mock('@/shared/config/features', () => ({ hasFeature: () => true }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (keys: string | readonly string[]) =>
    typeof keys === 'string' ? mockColor : keys.map(() => mockColor),
}));
jest.mock('assets/icons', () => () => null);
jest.mock('@/shared/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { wnLog: log, log, storeLog: log, redactError: (e: unknown) => e };
});

function makeClient(create: () => Promise<unknown>) {
  let count = 0;
  return {
    keyPackages: {
      count: jest.fn(async () => count),
      create: jest.fn(async () => {
        await create();
        count += 1;
      }),
      on: jest.fn(),
      off: jest.fn(),
    },
  };
}

async function openWith(client: ReturnType<typeof makeClient>) {
  render(
    <WhitenoiseContext.Provider
      value={{
        client: client as never,
        inviteReader: null,
        relays,
        accountIndex: 0,
      }}>
      <WhitenoiseSetupBanner />
    </WhitenoiseContext.Provider>
  );
  await act(async () => undefined);
}

// Host nodes render as plain elements here, so read the text off the tree.
function shownText(): string {
  return JSON.stringify(screen.toJSON());
}

async function pressSetUp() {
  await act(async () => {
    fireEvent.press(screen.UNSAFE_getByProps({ testID: 'whitenoise-setup-banner' }));
  });
}

beforeEach(() => {
  mockIndicatorPhases.length = 0;
});

it('a failed setup shows its error, not the success check, and can be tried again', async () => {
  const client = makeClient(async () => {
    throw new Error('relay refused the key package');
  });
  await openWith(client);

  await pressSetUp();

  expect(mockIndicatorPhases).not.toContain('done');
  expect(shownText()).toContain('relay refused the key package');

  // The card stays, so the person can try again.
  client.keyPackages.create.mockImplementation(async () => undefined);
  mockIndicatorPhases.length = 0;
  await pressSetUp();
  expect(mockIndicatorPhases).toContain('done');
});

it('a setup whose key package was stored but not published still shows its error', async () => {
  // Marmot stores a new key package and announces it before publishing it, so
  // the local count can reach the target although the relays refused it.
  const client = makeClient(async () => undefined);
  let count = 1;
  client.keyPackages.count.mockImplementation(async () => count);
  client.keyPackages.create.mockImplementation(async () => {
    count += 1;
    for (const [event, listener] of client.keyPackages.on.mock.calls as [string, () => void][]) {
      if (event === 'keyPackageAdded') listener();
    }
    throw new Error('relay refused the key package');
  });
  await openWith(client);

  await pressSetUp();

  expect(mockIndicatorPhases).not.toContain('done');
  expect(shownText()).toContain('relay refused the key package');
});

it('a setup that publishes the key packages shows the success check', async () => {
  const client = makeClient(async () => undefined);
  await openWith(client);

  await pressSetUp();

  expect(client.keyPackages.create).toHaveBeenCalledTimes(2);
  // Each key package names the app's relays, the ones it is published to.
  expect(client.keyPackages.create).toHaveBeenCalledWith({ relays, isLastResort: true });
  expect(mockIndicatorPhases).toContain('done');
});

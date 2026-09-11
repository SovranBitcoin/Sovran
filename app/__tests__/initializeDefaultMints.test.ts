import { initializeDefaultMints } from '@/shared/lib/cashu/initializeDefaultMints';

const mockSelection: { selectedMint?: string } = {};
const mockSetSelectedMint = jest.fn((url: string) => {
  mockSelection.selectedMint = url;
});
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: { getState: () => ({ ...mockSelection, setSelectedMint: mockSetSelectedMint }) },
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  mintUrlLogFields: () => ({}),
}));

const MINIBITS = 'https://mint.minibits.cash/Bitcoin';
const EXPECTED_MINTS = [
  MINIBITS,
  'https://mint.macadamia.cash',
  'https://antifiat.cash',
  'https://mint.cubabitcoin.org',
];

function manager() {
  const trusted = new Set<string>();
  return {
    mint: {
      isTrustedMint: jest.fn(async (url: string) => trusted.has(url)),
      addMint: jest.fn(async (url: string, _options: { trusted: true }) => {
        trusted.add(url);
      }),
    },
  };
}

beforeEach(() => {
  mockSelection.selectedMint = undefined;
  mockSetSelectedMint.mockClear();
});

it('loads Numo’s four mints and selects Minibits on a fresh profile', async () => {
  const client = manager();
  await initializeDefaultMints(client, () => true);
  expect(client.mint.addMint.mock.calls).toEqual(
    EXPECTED_MINTS.map((url) => [url, { trusted: true }])
  );
  expect(mockSetSelectedMint).toHaveBeenCalledWith(MINIBITS);
});

it('preserves an existing selection, including a previously selected Sovran mint', async () => {
  mockSelection.selectedMint = 'https://mint.sovran.money';
  await initializeDefaultMints(manager(), () => true);
  expect(mockSetSelectedMint).not.toHaveBeenCalled();
  expect(mockSelection.selectedMint).toBe('https://mint.sovran.money');
});

it('continues after an unavailable mint and does not select an untrusted default', async () => {
  jest.useFakeTimers();
  try {
    const client = manager();
    const add = client.mint.addMint.getMockImplementation()!;
    client.mint.addMint.mockImplementation(async (url, options) => {
      if (url === MINIBITS) throw new Error('unavailable');
      return add(url, options);
    });
    const done = initializeDefaultMints(client, () => true);
    await jest.runAllTimersAsync();
    await done;
    expect(client.mint.addMint.mock.calls.map(([url]) => url)).toEqual([
      MINIBITS,
      ...EXPECTED_MINTS,
    ]);
    expect(mockSetSelectedMint).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

it('does not overwrite a user selection made during the final trust check', async () => {
  const client = manager();
  let checks = 0;
  client.mint.isTrustedMint.mockImplementation(async () => {
    if (++checks === 5) mockSelection.selectedMint = 'https://chosen.example';
    return true;
  });
  await initializeDefaultMints(client, () => true);
  expect(mockSetSelectedMint).not.toHaveBeenCalled();
  expect(mockSelection.selectedMint).toBe('https://chosen.example');
});

it('does not change selection after its profile becomes stale during the trust check', async () => {
  const client = manager();
  let live = true;
  let checks = 0;
  client.mint.isTrustedMint.mockImplementation(async () => {
    if (++checks === 5) live = false;
    return true;
  });
  await initializeDefaultMints(client, () => live);
  expect(mockSetSelectedMint).not.toHaveBeenCalled();
});

it('does no work for a stale manager', async () => {
  const client = manager();
  await initializeDefaultMints(client, () => false);
  expect(client.mint.isTrustedMint).not.toHaveBeenCalled();
  expect(client.mint.addMint).not.toHaveBeenCalled();
  expect(mockSetSelectedMint).not.toHaveBeenCalled();
});

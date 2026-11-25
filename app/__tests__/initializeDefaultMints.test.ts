import { initializeDefaultMints } from '@/shared/lib/cashu/initializeDefaultMints';
import { useDefaultMintSetupStore } from '@/shared/stores/runtime/defaultMintSetupStore';

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
  useDefaultMintSetupStore.setState({ settled: false });
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

it('continues after an unavailable mint and selects the first default that is trusted', async () => {
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
    // Minibits never became trusted, so it is never selected; the next
    // default that is trusted is, rather than leaving the wallet without one.
    expect(mockSetSelectedMint).toHaveBeenCalledTimes(1);
    expect(mockSetSelectedMint).toHaveBeenCalledWith(EXPECTED_MINTS[1]);
    expect(useDefaultMintSetupStore.getState().settled).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

it('does not overwrite a user selection made during the last trust check', async () => {
  const client = manager();
  let checks = 0;
  client.mint.isTrustedMint.mockImplementation(async () => {
    if (++checks === EXPECTED_MINTS.length) mockSelection.selectedMint = 'https://chosen.example';
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
    if (++checks === EXPECTED_MINTS.length) live = false;
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

it('settles and selects without asking the trust store again', async () => {
  // Every default is trusted already; any further lookup would never answer.
  const client = manager();
  let checks = 0;
  client.mint.isTrustedMint.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        if (++checks <= EXPECTED_MINTS.length) resolve(true);
      })
  );
  const finished = jest.fn();
  void initializeDefaultMints(client, () => true).then(finished);
  for (let i = 0; i < 50; i++) await Promise.resolve();
  expect(finished).toHaveBeenCalled();
  expect(useDefaultMintSetupStore.getState().settled).toBe(true);
  expect(mockSetSelectedMint).toHaveBeenCalledWith(MINIBITS);
  expect(client.mint.isTrustedMint).toHaveBeenCalledTimes(EXPECTED_MINTS.length);
});

it('settles without a selection when no default could be trusted', async () => {
  jest.useFakeTimers();
  try {
    const client = manager();
    client.mint.addMint.mockRejectedValue(new Error('unavailable'));
    const done = initializeDefaultMints(client, () => true);
    await jest.runAllTimersAsync();
    await done;
    expect(mockSetSelectedMint).not.toHaveBeenCalled();
    expect(useDefaultMintSetupStore.getState().settled).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

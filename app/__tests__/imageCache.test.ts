import { Image } from 'expo-image';

jest.mock('expo-image', () => ({ Image: { prefetch: jest.fn() } }));
jest.mock('@/shared/lib/logger', () => ({
  log: { debug: jest.fn(), warn: jest.fn() },
}));
let mockMorphDone = true;
jest.mock('@/shared/lib/qrButtonAnchor', () => ({
  getBootMorphCompleted: () => mockMorphDone,
  subscribeBootMorphCompleted: jest.fn(() => () => undefined),
}));
jest.mock('@/shared/lib/account/accountRegistry', () => ({ registerAccountScoped: jest.fn() }));

import { discardQueuedPrefetches, prefetchImage, prefetchImages } from '@/shared/lib/imageCache';

beforeEach(() => {
  jest.mocked(Image.prefetch).mockReset();
});

it('retries images whose native prefetch resolves false', async () => {
  jest.mocked(Image.prefetch).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await prefetchImage('https://images.example/retry.png');
  await prefetchImage('https://images.example/retry.png');
  expect(Image.prefetch).toHaveBeenCalledTimes(2);
});

it('bounds simultaneous native requests across independent prefetch batches', async () => {
  let active = 0;
  let peak = 0;
  const finish: (() => void)[] = [];
  jest.mocked(Image.prefetch).mockImplementation(() => {
    active += 1;
    peak = Math.max(peak, active);
    return new Promise<boolean>((resolve) =>
      finish.push(() => {
        active -= 1;
        resolve(true);
      })
    );
  });
  const first = prefetchImages(Array.from({ length: 8 }, (_, i) => `https://images.example/a${i}`));
  const second = prefetchImages(
    Array.from({ length: 8 }, (_, i) => `https://images.example/b${i}`)
  );
  for (let pass = 0; pass < 50; pass += 1) {
    await Promise.resolve();
    finish.splice(0).forEach((complete) => complete());
  }
  await Promise.all([first, second]);
  expect(Image.prefetch).toHaveBeenCalledTimes(16);
  expect(peak).toBeLessThanOrEqual(4);
});

it('waits for a shared in-flight prefetch rather than resolving the second caller early', async () => {
  let complete!: (succeeded: boolean) => void;
  jest.mocked(Image.prefetch).mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        complete = resolve;
      })
  );
  const first = prefetchImage('https://images.example/shared');
  let secondDone = false;
  const second = prefetchImage(' https://images.example/shared ').then(() => {
    secondDone = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(secondDone).toBe(false);
  expect(Image.prefetch).toHaveBeenCalledTimes(1);
  complete(true);
  await Promise.all([first, second]);
  expect(secondDone).toBe(true);
});

it('releases failed request slots and retries thrown errors without failing the batch', async () => {
  jest.mocked(Image.prefetch).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(true);
  await prefetchImages(['https://images.example/throws', 'https://images.example/success']);
  await prefetchImage('https://images.example/throws');
  expect(Image.prefetch).toHaveBeenCalledTimes(3);
});

it('rejects unsafe image schemes and deduplicates normalized batch URLs', async () => {
  jest.mocked(Image.prefetch).mockResolvedValue(true);
  await prefetchImages([
    'file:///private/image.png',
    'data:image/png,abc',
    null,
    ' https://images.example/safe ',
    'https://images.example/safe',
  ]);
  expect(Image.prefetch).toHaveBeenCalledTimes(1);
  expect(Image.prefetch).toHaveBeenCalledWith('https://images.example/safe', 'memory-disk');
});

describe('a queue that does not grow without limit', () => {
  let round = 0;
  /** Four prefetches that hold every slot until `finish` is called. */
  function holdEverySlot() {
    const finish: (() => void)[] = [];
    jest
      .mocked(Image.prefetch)
      .mockImplementation(
        () => new Promise<boolean>((resolve) => finish.push(() => resolve(true)))
      );
    // Addresses not used before: one already fetched would resolve without taking a slot.
    round += 1;
    const held = Array.from({ length: 4 }, (_, i) =>
      prefetchImage(`https://images.example/held-${round}-${i}`)
    );
    return { held, finishAll: () => finish.splice(0).forEach((complete) => complete()) };
  }
  const settle = async () => {
    for (let pass = 0; pass < 20; pass += 1) await Promise.resolve();
  };

  it('gives up the oldest waiting request once more than 64 are waiting', async () => {
    const { held, finishAll } = holdEverySlot();
    await settle();
    const queued = Array.from({ length: 74 }, (_, i) =>
      prefetchImage(`https://images.example/queued${i}`)
    );
    await settle();

    // The ten oldest have already been given up, without a request.
    await Promise.all(queued.slice(0, 10));
    expect(Image.prefetch).toHaveBeenCalledTimes(4);

    for (let pass = 0; pass < 40; pass += 1) {
      finishAll();
      await settle();
    }
    await Promise.all([...held, ...queued]);
    expect(Image.prefetch).toHaveBeenCalledTimes(4 + 64);
  });

  it('gives up everything still waiting when the account changes', async () => {
    const { held, finishAll } = holdEverySlot();
    await settle();
    const queued = Array.from({ length: 10 }, (_, i) =>
      prefetchImage(`https://images.example/other-account${i}`)
    );
    await settle();

    discardQueuedPrefetches();
    await Promise.all(queued);
    expect(Image.prefetch).toHaveBeenCalledTimes(4);

    finishAll();
    await Promise.all(held);
    // The slots are free again for the next account.
    jest.mocked(Image.prefetch).mockResolvedValue(true);
    await prefetchImage('https://images.example/next-account');
    expect(Image.prefetch).toHaveBeenCalledTimes(5);
  });
});

it('goes ahead after a wait when the boot animation never reports', async () => {
  jest.useFakeTimers();
  mockMorphDone = false;
  try {
    let gated!: typeof import('@/shared/lib/imageCache');
    jest.isolateModules(() => {
      gated = require('@/shared/lib/imageCache');
    });
    const { Image: IsolatedImage } = jest.requireMock<typeof import('expo-image')>('expo-image');
    jest.mocked(IsolatedImage.prefetch).mockResolvedValue(true);

    const request = gated.prefetchImage('https://images.example/behind-the-gate');
    await jest.advanceTimersByTimeAsync(7_999);
    expect(IsolatedImage.prefetch).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(2);
    await request;
    expect(IsolatedImage.prefetch).toHaveBeenCalledTimes(1);
  } finally {
    mockMorphDone = true;
    jest.useRealTimers();
  }
});

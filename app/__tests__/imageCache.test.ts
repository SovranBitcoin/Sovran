import { Image } from 'expo-image';

jest.mock('expo-image', () => ({ Image: { prefetch: jest.fn() } }));
jest.mock('@/shared/lib/logger', () => ({
  log: { debug: jest.fn(), warn: jest.fn() },
}));
jest.mock('@/shared/lib/qrButtonAnchor', () => ({
  getBootMorphCompleted: () => true,
  subscribeBootMorphCompleted: jest.fn(),
}));

import { prefetchImage, prefetchImages } from '@/shared/lib/imageCache';

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

/** @jest-environment node */
import * as FileSystem from 'expo-file-system/legacy';
import {
  cleanupOrphanedFiles,
  downloadWallpaper,
  getWallpaperUri,
} from '@/shared/lib/wallpaperStorage';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  DownloadResumable: jest.fn(),
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  createDownloadResumable: jest.fn(),
  deleteAsync: jest.fn(),
  moveAsync: jest.fn(),
  copyAsync: jest.fn(),
  readDirectoryAsync: jest.fn(),
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

let files: Map<string, number>;
let finish: (value: FileSystem.FileSystemDownloadResult) => void;
let reject: (error: Error) => void;
let destination: string;
let progress:
  FileSystem.FileSystemNetworkTaskProgressCallback<FileSystem.DownloadProgressData> | undefined;
let cancel: jest.Mock;
function respond(bytes: number, status = 200) {
  files.set(destination, bytes);
  finish({ status, uri: destination, headers: {}, mimeType: 'image/png' });
}
async function start(theme = 'fixture', onProgress?: (value: number) => void) {
  const promise = downloadWallpaper('https://example.com/wallpaper.png', theme, onProgress);
  // Attach a handler before advancing timers to avoid an unhandled rejection.
  const result = promise.then(
    (uri) => ({ uri }),
    (error: Error) => ({ error })
  );
  await Promise.resolve();
  await Promise.resolve();
  return { promise, result };
}

beforeEach(() => {
  jest.useFakeTimers();
  files = new Map();
  cancel = jest.fn().mockResolvedValue(undefined);
  jest.mocked(FileSystem.getInfoAsync).mockImplementation(async (uri) => {
    const size = files.get(uri);
    return size === undefined
      ? { exists: false, isDirectory: false, uri }
      : {
          exists: true,
          isDirectory: false,
          uri,
          size,
          modificationTime: 0,
        };
  });
  jest.mocked(FileSystem.makeDirectoryAsync).mockResolvedValue(undefined);
  jest.mocked(FileSystem.deleteAsync).mockImplementation(async (uri) => {
    files.delete(uri);
  });
  jest.mocked(FileSystem.moveAsync).mockImplementation(async ({ from, to }) => {
    if (!files.has(from)) throw new Error('source missing');
    files.set(to, files.get(from)!);
    files.delete(from);
  });
  jest.mocked(FileSystem.copyAsync).mockImplementation(async ({ from, to }) => {
    if (!files.has(from)) throw new Error('source missing');
    files.set(to, files.get(from)!);
  });
  jest
    .mocked(FileSystem.createDownloadResumable)
    .mockImplementation((_url, uri, _options, callback) => {
      destination = uri;
      progress = callback;
      const download = new Promise<FileSystem.FileSystemDownloadResult>(
        (resolve, rejectDownload) => {
          finish = resolve;
          reject = rejectDownload;
        }
      );
      const task = new FileSystem.DownloadResumable(_url, uri);
      task.downloadAsync = () => download;
      task.cancelAsync = cancel;
      return task;
    });
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

it('does not expose partial bytes at the canonical path; publishes only verified completion', async () => {
  const { promise } = await start();
  expect(destination).not.toBe(getWallpaperUri('fixture'));
  files.set(destination, 20);
  expect(files.has(getWallpaperUri('fixture'))).toBe(false);
  respond(4096);
  await expect(promise).resolves.toBe(getWallpaperUri('fixture'));
  expect(files.get(getWallpaperUri('fixture'))).toBe(4096);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it.each(['network', 'http', 'truncated'])(
  'preserves the prior wallpaper after %s failure',
  async (failure) => {
    const canonical = getWallpaperUri('fixture');
    files.set(canonical, 8192);
    const { promise } = await start();
    if (failure === 'network') reject(new Error('offline'));
    else respond(failure === 'truncated' ? 30 : 4096, failure === 'http' ? 503 : 200);
    await expect(promise).rejects.toThrow('Download failed');
    expect(files.get(canonical)).toBe(8192);
  }
);

it('times out, cancels, suppresses late progress, and isolates a retry from a late writer', async () => {
  const onProgress = jest.fn();
  const first = await start('fixture', onProgress);
  const oldPath = destination;
  const oldFinish = finish;
  const oldProgress = progress;
  const oldCancel = cancel;
  // Native cancellation is a request, not a completion barrier; even if it
  // never resolves, callers must receive their timeout and be able to retry.
  oldCancel.mockImplementation(() => new Promise(() => {}));
  await jest.advanceTimersByTimeAsync(60_000);
  await expect(first.promise).rejects.toThrow('timed out');
  expect(oldCancel).toHaveBeenCalledTimes(1);
  const second = await start();
  expect(destination).not.toBe(oldPath);
  respond(4096);
  await second.promise;
  oldProgress?.({ totalBytesWritten: 9000, totalBytesExpectedToWrite: 9000 });
  expect(onProgress).not.toHaveBeenCalled();
  files.set(oldPath, 9000);
  oldFinish({ status: 200, uri: oldPath, headers: {}, mimeType: 'image/png' });
  await Promise.resolve();
  await Promise.resolve();
  expect(files.get(getWallpaperUri('fixture'))).toBe(4096);
  expect(files.has(oldPath)).toBe(false);
});

it('restores the prior image if iOS promotion deletes the target then fails', async () => {
  const canonical = getWallpaperUri('fixture');
  files.set(canonical, 8192);
  jest.mocked(FileSystem.moveAsync).mockImplementationOnce(async ({ to }) => {
    files.delete(to);
    throw new Error('native move failed');
  });
  const { promise } = await start();
  respond(4096);
  await expect(promise).rejects.toThrow('native move failed');
  expect(files.get(canonical)).toBe(8192);
});

it('keeps a restoration backup if the native filesystem also rejects restoration', async () => {
  const canonical = getWallpaperUri('fixture');
  files.set(canonical, 8192);
  jest
    .mocked(FileSystem.moveAsync)
    .mockImplementationOnce(async ({ to }) => {
      files.delete(to);
      throw new Error('promotion failed');
    })
    .mockRejectedValueOnce(new Error('restoration failed'));
  const { promise } = await start();
  const staging = destination;
  respond(4096);
  await expect(promise).rejects.toThrow('restoration failed');
  expect(files.get(`${staging}.backup`)).toBe(8192);
  jest
    .mocked(FileSystem.readDirectoryAsync)
    .mockResolvedValue([`${staging.split('/').pop()}.backup`]);
  await cleanupOrphanedFiles(new Set());
  expect(files.get(`${staging}.backup`)).toBe(8192);
});

it('does not delete a live staging file during orphan cleanup', async () => {
  const { promise } = await start();
  files.set(destination, 10);
  jest.mocked(FileSystem.readDirectoryAsync).mockResolvedValue([destination.split('/').pop()!]);
  await cleanupOrphanedFiles(new Set());
  expect(files.get(destination)).toBe(10);
  respond(4096);
  await promise;
});

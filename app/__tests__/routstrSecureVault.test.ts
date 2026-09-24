const mockSecure = new Map<string, string>();
let mockWriteFailure = false;
let mockReadFailure = false;
jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  readSensitiveValue: jest.fn(async (key: string) => {
    if (mockReadFailure) throw new Error('locked');
    return mockSecure.get(key) ?? null;
  }),
  writeSensitiveValue: jest.fn(async (key: string, value: string) => {
    if (mockWriteFailure) throw new Error('full');
    mockSecure.set(key, value);
  }),
}));

import { createSecureVault } from '@/shared/lib/routstr/secureVault';

describe('Routstr secure recovery vault', () => {
  beforeEach(() => {
    mockSecure.clear();
    mockWriteFailure = false;
    mockReadFailure = false;
  });

  it('round trips large tokens without exceeding native item sizes', async () => {
    const vault = createSecureVault('a'.repeat(64), 'sdk');
    const token = 'cashuB' + 'x'.repeat(12_000);
    await vault.write(token);
    expect(await vault.read()).toBe(token);
    expect([...mockSecure.values()].every((value) => value.length <= 1500)).toBe(true);
  });

  it('retains the last committed value when a replacement fails', async () => {
    const vault = createSecureVault('b'.repeat(64), 'sdk');
    await vault.write('old recovery');
    mockWriteFailure = true;
    await expect(vault.write('new recovery')).rejects.toThrow();
    mockWriteFailure = false;
    expect(await vault.read()).toBe('old recovery');
  });

  it('never treats a failed read as an empty vault or overwrites it', async () => {
    const vault = createSecureVault('c'.repeat(64), 'sdk');
    await vault.write('keep');
    mockReadFailure = true;
    await expect(vault.read()).rejects.toThrow();
    await expect(vault.write('replacement')).rejects.toThrow();
    mockReadFailure = false;
    expect(await vault.read()).toBe('keep');
  });

  it('isolates owners and detects a missing committed chunk', async () => {
    const first = createSecureVault('d'.repeat(64), 'sdk');
    const second = createSecureVault('e'.repeat(64), 'sdk');
    await first.write('private');
    expect(await second.read()).toBeNull();
    const chunkKey = [...mockSecure.keys()].find((key) => key.endsWith('_0'));
    expect(chunkKey).toBeDefined();
    mockSecure.delete(chunkKey!);
    await expect(first.read()).rejects.toThrow();
  });
});

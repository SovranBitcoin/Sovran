import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it, vi } from 'vitest';
import { nip19 } from 'nostr-tools';

import {
  createP2PKImportPlugin,
  isCompressedP2PKPublicKey,
  parseP2PKSecretInput,
  rememberP2PKImportPublicKeys,
  resolvePrimaryReceiveP2PKPublicKey,
  resolveReceiveP2PKPublicKeys,
} from '../../src';

const SECRET = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const SECRET_TWO = Uint8Array.from({ length: 32 }, (_, i) => i + 33);
const PUBLIC_KEY = `02${'11'.repeat(32)}`;
const PUBLIC_KEY_TWO = `03${'22'.repeat(32)}`;

function createPluginContext(addKeyPair = vi.fn()) {
  const extensions: Record<string, unknown> = {};
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    addKeyPair,
    extensions,
    ctx: {
      services: {
        keyRingService: {
          addKeyPair,
        },
        logger,
      },
      registerExtension: vi.fn((key: string, api: unknown) => {
        extensions[key] = api;
      }),
    },
  };
}

function getP2PKExtension(extensions: Record<string, unknown>) {
  return extensions.p2pkImport as {
    getPublicKeys: () => string[];
    getPrimaryPublicKey: () => string | null;
  };
}

describe('parseP2PKSecretInput', () => {
  it('accepts a 32-byte hex private key', () => {
    const result = parseP2PKSecretInput(bytesToHex(SECRET));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.source).toBe('hex');
    expect(bytesToHex(result.secretKey)).toBe(bytesToHex(SECRET));
  });

  it('accepts an nsec private key', () => {
    const nsec = nip19.nsecEncode(SECRET);
    const result = parseP2PKSecretInput(nsec);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.source).toBe('nsec');
    expect(bytesToHex(result.secretKey)).toBe(bytesToHex(SECRET));
  });

  it('rejects invalid input without returning key material', () => {
    expect(parseP2PKSecretInput('')).toMatchObject({ success: false });
    expect(parseP2PKSecretInput('nsec1not-a-real-key')).toMatchObject({ success: false });
    expect(parseP2PKSecretInput('abc123')).toMatchObject({ success: false });
  });
});

describe('isCompressedP2PKPublicKey', () => {
  it('accepts compressed P2PK public keys and rejects other hex shapes', () => {
    expect(isCompressedP2PKPublicKey(PUBLIC_KEY)).toBe(true);
    expect(isCompressedP2PKPublicKey(`03${'22'.repeat(32)}`)).toBe(true);
    expect(isCompressedP2PKPublicKey(`${'22'.repeat(32)}`)).toBe(false);
    expect(isCompressedP2PKPublicKey(`04${'22'.repeat(32)}`)).toBe(false);
  });
});

describe('createP2PKImportPlugin', () => {
  it('registers an extension and no-ops when no shared key exists', async () => {
    const { addKeyPair, extensions, ctx } = createPluginContext();
    const plugin = createP2PKImportPlugin({ getSecretKeys: () => [] });

    await plugin.onInit?.(ctx as never);

    expect(addKeyPair).not.toHaveBeenCalled();
    expect(getP2PKExtension(extensions).getPrimaryPublicKey()).toBe(null);
    expect(getP2PKExtension(extensions).getPublicKeys()).toEqual([]);
  });

  it('imports the shared secret and exposes the public key', async () => {
    const addKeyPair = vi.fn(async (secretKey: Uint8Array) => ({
      publicKeyHex: PUBLIC_KEY,
      secretKey,
    }));
    const { extensions, ctx } = createPluginContext(addKeyPair);
    const plugin = createP2PKImportPlugin({ getSecretKeys: () => [SECRET] });

    await plugin.onInit?.(ctx as never);

    expect(addKeyPair).toHaveBeenCalledTimes(1);
    expect(addKeyPair).toHaveBeenCalledWith(SECRET);
    expect(getP2PKExtension(extensions).getPrimaryPublicKey()).toBe(PUBLIC_KEY);
    expect(getP2PKExtension(extensions).getPublicKeys()).toEqual([PUBLIC_KEY]);
  });

  it('imports a single declarative hex private key', async () => {
    const addKeyPair = vi.fn(async (secretKey: Uint8Array) => ({
      publicKeyHex: PUBLIC_KEY,
      secretKey,
    }));
    const { extensions, ctx } = createPluginContext(addKeyPair);
    const plugin = createP2PKImportPlugin({ secretKey: bytesToHex(SECRET) });

    await plugin.onInit?.(ctx as never);

    expect(addKeyPair).toHaveBeenCalledTimes(1);
    expect(bytesToHex(addKeyPair.mock.calls[0][0] as Uint8Array)).toBe(bytesToHex(SECRET));
    expect(getP2PKExtension(extensions).getPublicKeys()).toEqual([PUBLIC_KEY]);
  });

  it('imports multiple shared secrets and exposes all public keys in order', async () => {
    const addKeyPair = vi.fn(async (secretKey: Uint8Array) => ({
      publicKeyHex: bytesToHex(secretKey) === bytesToHex(SECRET) ? PUBLIC_KEY : PUBLIC_KEY_TWO,
      secretKey,
    }));
    const { extensions, ctx } = createPluginContext(addKeyPair);
    const plugin = createP2PKImportPlugin({
      secretKeys: [SECRET],
      getSecretKeys: () => [SECRET_TWO],
    });

    await plugin.onInit?.(ctx as never);

    expect(addKeyPair).toHaveBeenCalledTimes(2);
    expect(addKeyPair).toHaveBeenNthCalledWith(1, SECRET);
    expect(addKeyPair).toHaveBeenNthCalledWith(2, SECRET_TWO);
    expect(getP2PKExtension(extensions).getPrimaryPublicKey()).toBe(PUBLIC_KEY);
    expect(getP2PKExtension(extensions).getPublicKeys()).toEqual([PUBLIC_KEY, PUBLIC_KEY_TWO]);
  });

  it('imports multiple declarative nsec and hex private keys', async () => {
    const addKeyPair = vi.fn(async (secretKey: Uint8Array) => ({
      publicKeyHex: bytesToHex(secretKey) === bytesToHex(SECRET) ? PUBLIC_KEY : PUBLIC_KEY_TWO,
      secretKey,
    }));
    const { extensions, ctx } = createPluginContext(addKeyPair);
    const plugin = createP2PKImportPlugin({
      secretKeys: [nip19.nsecEncode(SECRET), bytesToHex(SECRET_TWO)],
    });

    await plugin.onInit?.(ctx as never);

    expect(addKeyPair).toHaveBeenCalledTimes(2);
    expect(getP2PKExtension(extensions).getPublicKeys()).toEqual([PUBLIC_KEY, PUBLIC_KEY_TWO]);
  });

  it('imports a dynamic current-user nsec from a single secret source', async () => {
    const addKeyPair = vi.fn(async (secretKey: Uint8Array) => ({
      publicKeyHex: PUBLIC_KEY,
      secretKey,
    }));
    const { extensions, ctx } = createPluginContext(addKeyPair);
    const plugin = createP2PKImportPlugin({
      getSecretKey: () => nip19.nsecEncode(SECRET),
    });

    await plugin.onInit?.(ctx as never);

    expect(addKeyPair).toHaveBeenCalledTimes(1);
    expect(getP2PKExtension(extensions).getPrimaryPublicKey()).toBe(PUBLIC_KEY);
  });

  it('exposes static public keys without importing secrets', async () => {
    const { addKeyPair, extensions, ctx } = createPluginContext();
    const plugin = createP2PKImportPlugin({ publicKeys: [PUBLIC_KEY, PUBLIC_KEY_TWO] });

    await plugin.onInit?.(ctx as never);

    expect(addKeyPair).not.toHaveBeenCalled();
    expect(getP2PKExtension(extensions).getPrimaryPublicKey()).toBe(PUBLIC_KEY);
    expect(getP2PKExtension(extensions).getPublicKeys()).toEqual([PUBLIC_KEY, PUBLIC_KEY_TWO]);
  });

  it('normalizes remembered public keys to lowercase and de-dupes by value', async () => {
    const { extensions, ctx } = createPluginContext();
    const plugin = createP2PKImportPlugin({ publicKeys: [PUBLIC_KEY.toUpperCase(), PUBLIC_KEY] });

    await plugin.onInit?.(ctx as never);

    expect(getP2PKExtension(extensions).getPublicKeys()).toEqual([PUBLIC_KEY]);
  });

  it('exposes a single static public key without importing secrets', async () => {
    const { addKeyPair, extensions, ctx } = createPluginContext();
    const plugin = createP2PKImportPlugin({ publicKey: PUBLIC_KEY });

    await plugin.onInit?.(ctx as never);

    expect(addKeyPair).not.toHaveBeenCalled();
    expect(getP2PKExtension(extensions).getPrimaryPublicKey()).toBe(PUBLIC_KEY);
  });

  it('exposes dynamic public keys without importing secrets', async () => {
    const { addKeyPair, extensions, ctx } = createPluginContext();
    const plugin = createP2PKImportPlugin({ getPublicKeys: () => [PUBLIC_KEY, PUBLIC_KEY_TWO] });

    await plugin.onInit?.(ctx as never);

    expect(addKeyPair).not.toHaveBeenCalled();
    expect(getP2PKExtension(extensions).getPrimaryPublicKey()).toBe(PUBLIC_KEY);
    expect(getP2PKExtension(extensions).getPublicKeys()).toEqual([PUBLIC_KEY, PUBLIC_KEY_TWO]);
  });

  it('ignores invalid configured public keys', async () => {
    const { addKeyPair, extensions, ctx } = createPluginContext();
    const plugin = createP2PKImportPlugin({ publicKeys: [`${'22'.repeat(32)}`] });

    await plugin.onInit?.(ctx as never);

    expect(addKeyPair).not.toHaveBeenCalled();
    expect(getP2PKExtension(extensions).getPrimaryPublicKey()).toBe(null);
    expect(getP2PKExtension(extensions).getPublicKeys()).toEqual([]);
  });

  it('ignores invalid public keys remembered by active app flows', async () => {
    const { extensions, ctx } = createPluginContext();
    const plugin = createP2PKImportPlugin({ getSecretKeys: () => [] });

    await plugin.onInit?.(ctx as never);
    rememberP2PKImportPublicKeys({ ext: extensions } as never, [`${'22'.repeat(32)}`, PUBLIC_KEY]);

    expect(getP2PKExtension(extensions).getPublicKeys()).toEqual([PUBLIC_KEY]);
  });

  it('does not import twice if init is called repeatedly after a key exists', async () => {
    const addKeyPair = vi.fn(async (secretKey: Uint8Array) => ({
      publicKeyHex: PUBLIC_KEY,
      secretKey,
    }));
    const { ctx } = createPluginContext(addKeyPair);
    const plugin = createP2PKImportPlugin({ getSecretKeys: () => [SECRET] });

    await plugin.onInit?.(ctx as never);
    await plugin.onInit?.(ctx as never);

    expect(addKeyPair).toHaveBeenCalledTimes(1);
  });

  it('can import on a later init if the secret source was initially empty', async () => {
    let secretKeys: Uint8Array[] = [];
    const addKeyPair = vi.fn(async (nextSecretKey: Uint8Array) => ({
      publicKeyHex: PUBLIC_KEY,
      secretKey: nextSecretKey,
    }));
    const { ctx } = createPluginContext(addKeyPair);
    const plugin = createP2PKImportPlugin({ getSecretKeys: () => secretKeys });

    await plugin.onInit?.(ctx as never);
    secretKeys = [SECRET];
    await plugin.onInit?.(ctx as never);

    expect(addKeyPair).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid shared secrets without importing key material', async () => {
    const addKeyPair = vi.fn();
    const { extensions, ctx } = createPluginContext(addKeyPair);
    const plugin = createP2PKImportPlugin({ getSecretKeys: () => [new Uint8Array(31)] });

    await plugin.onInit?.(ctx as never);

    expect(addKeyPair).not.toHaveBeenCalled();
    expect(getP2PKExtension(extensions).getPrimaryPublicKey()).toBe(null);
    expect(getP2PKExtension(extensions).getPublicKeys()).toEqual([]);
  });

  it('can remember public keys imported by an active app flow', async () => {
    const { extensions, ctx } = createPluginContext();
    const plugin = createP2PKImportPlugin({ getSecretKeys: () => [] });

    await plugin.onInit?.(ctx as never);
    rememberP2PKImportPublicKeys({ ext: extensions } as never, [PUBLIC_KEY, PUBLIC_KEY_TWO]);

    expect(getP2PKExtension(extensions).getPrimaryPublicKey()).toBe(PUBLIC_KEY);
    expect(getP2PKExtension(extensions).getPublicKeys()).toEqual([PUBLIC_KEY, PUBLIC_KEY_TWO]);
  });

  it('does not share remembered public keys across plugin instances', async () => {
    const first = createPluginContext();
    const firstPlugin = createP2PKImportPlugin({ getSecretKeys: () => [] });
    await firstPlugin.onInit?.(first.ctx as never);
    rememberP2PKImportPublicKeys({ ext: first.extensions } as never, [PUBLIC_KEY]);

    const second = createPluginContext();
    const secondPlugin = createP2PKImportPlugin({ getSecretKeys: () => [] });
    await secondPlugin.onInit?.(second.ctx as never);

    expect(getP2PKExtension(first.extensions).getPublicKeys()).toEqual([PUBLIC_KEY]);
    expect(getP2PKExtension(second.extensions).getPublicKeys()).toEqual([]);
  });
});

describe('resolveReceiveP2PKPublicKeys', () => {
  it('prefers the shared P2PK plugin keys over the latest keyring key', async () => {
    const getLatestKeyPair = vi.fn();

    const result = await resolveReceiveP2PKPublicKeys({
      ext: { p2pkImport: { getPublicKeys: () => [PUBLIC_KEY, PUBLIC_KEY_TWO] } },
      keyring: { getLatestKeyPair },
    } as never);

    expect(result).toEqual([PUBLIC_KEY, PUBLIC_KEY_TWO]);
    expect(getLatestKeyPair).not.toHaveBeenCalled();
  });

  it('falls back to the latest keyring key when no shared P2PK key is active', async () => {
    const latestPublicKey = `02${'22'.repeat(32)}`;
    const getLatestKeyPair = vi.fn(async () => ({ publicKeyHex: latestPublicKey }));

    const result = await resolveReceiveP2PKPublicKeys({
      ext: {},
      keyring: { getLatestKeyPair },
    } as never);

    expect(result).toEqual([latestPublicKey]);
  });

  it('can resolve the primary receive public key', async () => {
    const getLatestKeyPair = vi.fn();

    const result = await resolvePrimaryReceiveP2PKPublicKey({
      ext: { p2pkImport: { getPublicKeys: () => [PUBLIC_KEY, PUBLIC_KEY_TWO] } },
      keyring: { getLatestKeyPair },
    } as never);

    expect(result).toBe(PUBLIC_KEY);
    expect(getLatestKeyPair).not.toHaveBeenCalled();
  });
});

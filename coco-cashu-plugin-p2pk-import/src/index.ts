import type { Keypair, Manager, Plugin } from '@cashu/coco-core';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { nip19 } from 'nostr-tools';

export interface P2PKImportPluginApi {
  getPublicKeys(): string[];
  getPrimaryPublicKey(): string | null;
}

declare module '@cashu/coco-core' {
  interface PluginExtensions {
    p2pkImport: P2PKImportPluginApi;
  }
}

export type Awaitable<T> = T | Promise<T>;
export type P2PKSecretKeyInput = Uint8Array | string;

export interface CreateP2PKImportPluginConfig {
  /**
   * Optional 32-byte private key, nsec, or 64-character hex private key.
   * When provided, the plugin imports the keypair into Coco's keyring and
   * exposes the derived public key.
   */
  secretKey?: P2PKSecretKeyInput | null | undefined;
  /**
   * Optional 32-byte private keys, nsecs, or 64-character hex private keys.
   * Each valid value is imported into Coco's keyring.
   */
  secretKeys?: readonly P2PKSecretKeyInput[] | null | undefined;
  /**
   * Dynamic source for a single private key. Return null when no key is
   * currently configured.
   */
  getSecretKey?: () => Awaitable<P2PKSecretKeyInput | null | undefined>;
  /**
   * Dynamic source for multiple private keys. Return an empty array when no
   * keys are currently configured.
   */
  getSecretKeys?: () => Awaitable<readonly P2PKSecretKeyInput[] | null | undefined>;
  /**
   * Static compressed P2PK public key. This is public key material only.
   */
  publicKey?: string | null | undefined;
  /**
   * Static compressed P2PK public keys. This is public key material only.
   */
  publicKeys?: readonly string[] | null | undefined;
  /**
   * Dynamic compressed P2PK public key source.
   */
  getPublicKey?: () => Awaitable<string | null | undefined>;
  /**
   * Dynamic compressed P2PK public key source. Useful when an app wants to
   * advertise known keys without coupling this plugin to any storage layer.
   */
  getPublicKeys?: () => Awaitable<readonly string[] | null | undefined>;
}

export type P2PKSecretInputSource = 'hex' | 'nsec';

export type ParseP2PKSecretInputResult =
  | {
      success: true;
      source: P2PKSecretInputSource;
      secretKey: Uint8Array;
    }
  | {
      success: false;
      error: string;
    };

type P2PKImportManager = Pick<Manager, 'ext' | 'keyring'>;
type MutableP2PKImportPluginApi = P2PKImportPluginApi & {
  rememberPublicKeys(publicKeys: readonly string[]): void;
};

const HEX_32_BYTES_RE = /^[0-9a-f]{64}$/i;
const COMPRESSED_P2PK_PUBLIC_KEY_RE = /^(02|03)[0-9a-f]{64}$/i;

function isUint8Array(value: unknown): value is Uint8Array {
  return (
    value instanceof Uint8Array || Object.prototype.toString.call(value) === '[object Uint8Array]'
  );
}

function isSecretKeyBytes(value: unknown): value is Uint8Array {
  return isUint8Array(value) && value.length === 32;
}

export function isCompressedP2PKPublicKey(value: unknown): value is string {
  return typeof value === 'string' && COMPRESSED_P2PK_PUBLIC_KEY_RE.test(value);
}

function normalizeArray<T>(values: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(values) ? values : [];
}

function normalizeValue<T>(value: T | null | undefined): readonly T[] {
  return value == null ? [] : [value];
}

function resolveSecretKeyInput(input: P2PKSecretKeyInput): Uint8Array | null {
  if (isSecretKeyBytes(input)) {
    return new Uint8Array(input);
  }

  if (typeof input === 'string') {
    const parsed = parseP2PKSecretInput(input);
    return parsed.success ? parsed.secretKey : null;
  }

  return null;
}

export function parseP2PKSecretInput(input: string): ParseP2PKSecretInputResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { success: false, error: 'Enter nsec or 64-character hex key.' };
  }

  if (trimmed.startsWith('nsec1')) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'nsec' && isSecretKeyBytes(decoded.data)) {
        return {
          success: true,
          source: 'nsec',
          secretKey: decoded.data,
        };
      }
    } catch {
      return { success: false, error: 'Enter a valid nsec private key.' };
    }

    return { success: false, error: 'Enter a valid nsec private key.' };
  }

  if (!HEX_32_BYTES_RE.test(trimmed)) {
    return { success: false, error: 'Enter nsec or 64-character hex key.' };
  }

  try {
    const secretKey = hexToBytes(trimmed);
    if (!isSecretKeyBytes(secretKey)) {
      return { success: false, error: 'Enter a 32-byte private key.' };
    }
    return {
      success: true,
      source: 'hex',
      secretKey,
    };
  } catch {
    return { success: false, error: 'Enter nsec or 64-character hex key.' };
  }
}

export function createP2PKImportPlugin({
  secretKey: staticSecretKey,
  secretKeys: staticSecretKeys,
  getSecretKey,
  getSecretKeys,
  publicKey: staticPublicKey,
  publicKeys: staticPublicKeys,
  getPublicKey,
  getPublicKeys,
}: CreateP2PKImportPluginConfig): Plugin<['keyRingService', 'logger']> {
  const publicKeys: string[] = [];
  const importedSecretFingerprints = new Set<string>();
  let extensionRegistered = false;

  const rememberPublicKeys = (nextPublicKeys: readonly string[]) => {
    for (const nextPublicKey of nextPublicKeys) {
      const normalizedPublicKey = nextPublicKey.toLowerCase();
      if (isCompressedP2PKPublicKey(nextPublicKey) && !publicKeys.includes(normalizedPublicKey)) {
        publicKeys.push(normalizedPublicKey);
      }
    }
  };

  const api: MutableP2PKImportPluginApi = {
    getPublicKeys: () => [...publicKeys],
    getPrimaryPublicKey: () => publicKeys[0] ?? null,
    rememberPublicKeys,
  };

  return {
    name: 'p2pk-import',
    required: ['keyRingService', 'logger'],
    onInit: async (ctx) => {
      if (!extensionRegistered) {
        ctx.registerExtension('p2pkImport', api);
        extensionRegistered = true;
      }

      const dynamicPublicKey = await getPublicKey?.();
      const dynamicPublicKeys = await getPublicKeys?.();
      const configuredPublicKeys = [
        ...normalizeValue(staticPublicKey),
        ...normalizeArray(staticPublicKeys),
        ...normalizeValue(dynamicPublicKey),
        ...normalizeArray(dynamicPublicKeys),
      ];
      configuredPublicKeys.forEach((configuredPublicKey, index) => {
        if (isCompressedP2PKPublicKey(configuredPublicKey)) {
          rememberPublicKeys([configuredPublicKey]);
        } else {
          ctx.services.logger.warn('cashu.p2pk_import.invalid_public_key', { index });
        }
      });

      const dynamicSecretKey = await getSecretKey?.();
      const dynamicSecretKeys = await getSecretKeys?.();
      const secretInputs = [
        ...normalizeValue(staticSecretKey),
        ...normalizeArray(staticSecretKeys),
        ...normalizeValue(dynamicSecretKey),
        ...normalizeArray(dynamicSecretKeys),
      ];
      if (secretInputs.length === 0) return;

      const seenSecretFingerprints = new Set<string>();
      for (const [index, secretInput] of secretInputs.entries()) {
        const secretKey = resolveSecretKeyInput(secretInput);
        if (!secretKey) {
          ctx.services.logger.warn('cashu.p2pk_import.invalid_secret_key', { index });
          continue;
        }

        const fingerprint = bytesToHex(sha256(secretKey));
        if (seenSecretFingerprints.has(fingerprint)) continue;
        seenSecretFingerprints.add(fingerprint);
        if (importedSecretFingerprints.has(fingerprint)) continue;

        try {
          const keypair = (await ctx.services.keyRingService.addKeyPair(secretKey)) as Keypair;
          importedSecretFingerprints.add(fingerprint);
          rememberPublicKeys([keypair.publicKeyHex]);
          ctx.services.logger.info('cashu.p2pk_import.seeded', {
            publicKeyHex: keypair.publicKeyHex,
          });
        } catch (error) {
          ctx.services.logger.warn('cashu.p2pk_import.seed_failed', {
            index,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  };
}

export function getP2PKImportExtension(manager: Pick<Manager, 'ext'> | null | undefined) {
  return manager?.ext?.p2pkImport ?? null;
}

export function rememberP2PKImportPublicKeys(
  manager: Pick<Manager, 'ext'> | null | undefined,
  publicKeys: readonly string[]
): void {
  const extension = getP2PKImportExtension(manager) as Partial<MutableP2PKImportPluginApi> | null;
  extension?.rememberPublicKeys?.(publicKeys);
}

export async function resolveReceiveP2PKPublicKeys(
  manager: P2PKImportManager | null | undefined
): Promise<string[]> {
  if (!manager) return [];

  const pluginPublicKeys = getP2PKImportExtension(manager)?.getPublicKeys() ?? [];
  if (pluginPublicKeys.length > 0) return pluginPublicKeys;

  const keypair = await manager.keyring.getLatestKeyPair();
  return keypair?.publicKeyHex ? [keypair.publicKeyHex] : [];
}

export async function resolvePrimaryReceiveP2PKPublicKey(
  manager: P2PKImportManager | null | undefined
): Promise<string | undefined> {
  return (await resolveReceiveP2PKPublicKeys(manager))[0];
}

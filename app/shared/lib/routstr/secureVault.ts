import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { readSensitiveValue, writeSensitiveValue } from '@/shared/lib/nostr/secureStorage';
import { isNostrPubkeyHex } from '@/shared/lib/protocolIds';
import { SecureVaultManifest as Manifest, secureVaultChunkKey } from './secureVaultManifest';

const CHUNK_CHARACTERS = 512;
const queues = new Map<string, Promise<void>>();
const digest = (value: string) => bytesToHex(sha256(utf8ToBytes(value)));

/** Two slots keep the old generation readable until the new manifest is verified. */
export function createSecureVault(ownerPubkey: string, name: string) {
  if (!isNostrPubkeyHex(ownerPubkey)) throw new Error('A profile is required for payment storage');
  const prefix = `routstr_v1_${ownerPubkey}_${digest(name)}`;
  const manifestKey = `${prefix}_manifest`;
  const chunkKey = (generation: number, index: number) =>
    secureVaultChunkKey(manifestKey, generation % 2, index);

  async function readRecord() {
    const raw = await readSensitiveValue(manifestKey);
    if (raw === null) return null;
    const manifest = Manifest.parse(JSON.parse(raw));
    if (manifest.generation === null) return { manifest, value: null };
    let value = '';
    for (let index = 0; index < manifest.slots[manifest.generation % 2]; index++) {
      const chunk = await readSensitiveValue(chunkKey(manifest.generation, index));
      if (chunk === null) throw new Error('Payment recovery storage is incomplete');
      value += chunk;
    }
    if (digest(value) !== manifest.digest) throw new Error('Payment recovery storage is corrupt');
    return { manifest, value };
  }

  return {
    async read(): Promise<string | null> {
      await queues.get(prefix);
      return (await readRecord())?.value ?? null;
    },
    write(value: string): Promise<void> {
      const write = async () => {
        const previous = await readRecord();
        const generation = (previous?.manifest.generation ?? -1) + 1;
        const characters = Array.from(value);
        const chunks = Math.ceil(characters.length / CHUNK_CHARACTERS);
        const slots: [number, number] = previous?.manifest.slots ?? [0, 0];
        slots[generation % 2] = Math.max(slots[generation % 2], chunks);
        // Record the pending slot before writing any unindexed chunk so
        // Delete All can enumerate even an interrupted first write.
        await writeSensitiveValue(
          manifestKey,
          JSON.stringify(
            Manifest.parse({
              version: 1,
              generation: previous?.manifest.generation ?? null,
              slots,
              digest: previous?.manifest.digest ?? digest(''),
            })
          )
        );
        for (let index = 0; index < chunks; index++) {
          await writeSensitiveValue(
            chunkKey(generation, index),
            characters.slice(index * CHUNK_CHARACTERS, (index + 1) * CHUNK_CHARACTERS).join(''),
            manifestKey
          );
        }
        // Empty trailing chunks preserve the recorded cleanup range when a
        // smaller value reuses a slot that previously held a larger value.
        for (let index = chunks; index < slots[generation % 2]; index++) {
          await writeSensitiveValue(chunkKey(generation, index), '', manifestKey);
        }
        const manifest = Manifest.parse({ version: 1, generation, slots, digest: digest(value) });
        // Each chunk was read back by writeSensitiveValue. Commit only once
        // every chunk is durable; a crash before this retains the old slot.
        await writeSensitiveValue(manifestKey, JSON.stringify(manifest));
      };
      const pending = (queues.get(prefix) ?? Promise.resolve()).then(write);
      queues.set(
        prefix,
        pending.catch(() => {})
      );
      return pending;
    },
  };
}

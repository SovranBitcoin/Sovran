import { z } from 'zod';

const ChunkCount = z.number().int().nonnegative().max(100_000);
export const SecureVaultManifest = z.object({
  version: z.literal(1),
  generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  slots: z.tuple([ChunkCount, ChunkCount]),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});

export function secureVaultChunkKey(manifestKey: string, slot: number, index: number): string {
  return `${manifestKey.slice(0, -'_manifest'.length)}_${slot}_${index}`;
}

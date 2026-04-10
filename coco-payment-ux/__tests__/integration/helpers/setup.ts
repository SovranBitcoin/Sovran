import { initializeCoco, MemoryRepositories } from '@cashu/coco-core';
import type { Manager } from '@cashu/coco-core';

export const TEST_MINT = process.env.TEST_MINT_URL || 'https://mint.minibits.cash/Bitcoin';

const TEST_SEED = new Uint8Array(64).fill(1);

export async function createTestManager(): Promise<Manager> {
  const repos = new MemoryRepositories();
  await repos.init();

  return initializeCoco({
    repo: repos,
    seedGetter: async () => TEST_SEED,
    watchers: {
      mintOperationWatcher: { disabled: true },
      proofStateWatcher: { disabled: true },
    },
    processors: {
      mintOperationProcessor: { disabled: true },
    },
  });
}

export async function addTrustedMint(manager: Manager, mintUrl: string) {
  const isTrusted = await manager.mint.isTrustedMint(mintUrl);
  if (!isTrusted) {
    await manager.mint.addMint(mintUrl, { trusted: true });
  }
}

export async function fundWallet(
  manager: Manager,
  mintUrl: string,
  amount: number
): Promise<boolean> {
  try {
    await addTrustedMint(manager, mintUrl);
    const mintOp = await manager.ops.mint.prepare({ mintUrl, amount, method: 'bolt11' });
    await manager.ops.mint.execute(mintOp.id);
    return true;
  } catch {
    return false;
  }
}

export function canFund(): boolean {
  return !!process.env.TEST_MINT_URL;
}

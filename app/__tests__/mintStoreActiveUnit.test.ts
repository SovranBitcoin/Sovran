/**
 * @jest-environment node
 *
 * Persisted-schema invariant regression for the additive `activeUnit` field:
 * the persist merge drops a WHOLE blob it can't parse, so an old blob (no
 * activeUnit) and a corrupt value must both rehydrate — never wipe the store.
 */

import { persistRegistry } from '@/shared/lib/persist/persistConfig';
// Importing the store registers its schema in the persistRegistry.
import '@/shared/stores/profile/mintStore';

function mintStoreSchema() {
  const entry = persistRegistry.find((e) => e.name === 'mint-store');
  if (!entry) throw new Error('mint-store missing from persistRegistry');
  return entry.schema;
}

describe('mintStore activeUnit persistence', () => {
  it('rehydrates a pre-activeUnit blob with the sat default', () => {
    const parsed = mintStoreSchema().parse({ selectedMint: 'https://mint.example' }) as {
      selectedMint?: string;
      activeUnit?: string;
    };
    expect(parsed.activeUnit).toBe('sat');
    expect(parsed.selectedMint).toBe('https://mint.example');
  });

  it('degrades an unknown persisted unit to sat instead of failing the parse', () => {
    const parsed = mintStoreSchema().parse({
      selectedMint: 'https://mint.example',
      activeUnit: 'chf',
    }) as { selectedMint?: string; activeUnit?: string };
    expect(parsed.activeUnit).toBe('sat');
    expect(parsed.selectedMint).toBe('https://mint.example');
  });

  it('keeps a valid persisted unit', () => {
    const parsed = mintStoreSchema().parse({ activeUnit: 'usd' }) as { activeUnit?: string };
    expect(parsed.activeUnit).toBe('usd');
  });
});

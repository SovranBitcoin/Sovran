/**
 * The encrypted selection is a promise, and the candidate chain is where it
 * used to be broken.
 *
 * `@routstr/sdk` seals a request body on `modelId.startsWith('tinfoil-')` and
 * on nothing else, so the model id is the encryption switch. The chain that
 * decides which id goes out used to fall over from the user's chosen vendor to
 * the generic four at the same tier — on a refusal, or merely because the
 * sealed pick cost more than the wallet held. A prompt the user chose to
 * encrypt was then answered in the clear by OpenAI, with no signal at all.
 *
 * These cases pin the repair at its source: the chain constructor. A sealed
 * selection produces a chain that contains only sealed models or no models,
 * an unencrypted selection keeps the wide fallback it always had, and the
 * grouping alone is never trusted over the id.
 */
import {
  E2EE_PROVIDER_ID,
  emptyLineup,
  isE2eeModelId,
  type AiLineup,
  type LineupEntry,
  type LineupPricing,
} from '@/shared/lib/routstr/lineup';
import {
  canAffordPricing,
  getProviderById,
  resolveCandidateEntries,
  resolveSelectedEntry,
  selectFromChain,
} from '@/features/ai/lib/format';

/** `max_cost` alone makes the admission reserve exactly `sats`, which keeps
 *  each case's affordability arithmetic readable at the call site. */
const pricing = (sats: number): LineupPricing => ({
  prompt: null,
  completion: null,
  request: null,
  image: null,
  max_cost: sats,
});

const entry = (modelId: string, reserveSats: number): LineupEntry => ({
  modelId,
  displayName: modelId,
  contextLength: 128_000,
  created: 1,
  visionInput: true,
  satsPricing: pricing(reserveSats),
});

/**
 * A node that serves both: an encrypted ladder priced like the enclave models
 * it fronts, and a cheap plaintext ladder beside it. This is the shape that
 * produced the defect — the plaintext twin is always the affordable one.
 */
function mixedLineup(): AiLineup {
  const lineup = emptyLineup();
  lineup[E2EE_PROVIDER_ID] = {
    auto: entry('tinfoil-glm-5-3', 3_000),
    pro: entry('tinfoil-qwen3-coder', 4_000),
    max: entry('tinfoil-deepseek-r1', 5_000),
  };
  lineup.openai = {
    auto: entry('gpt-5.4-nano', 20),
    pro: entry('gpt-5.4-mini', 60),
    max: entry('gpt-5.4', 100),
  };
  lineup.claude = {
    auto: entry('claude-haiku-4.5', 30),
    pro: entry('claude-sonnet-4.5', 80),
    max: entry('claude-opus-4.5', 200),
  };
  return lineup;
}

describe('sealed candidate chain', () => {
  it('never leaves the encrypted vendor, at any tier', () => {
    const lineup = mixedLineup();
    const chain = resolveCandidateEntries(E2EE_PROVIDER_ID, 'max', lineup);
    expect(chain.sealed).toBe(true);
    expect(chain.entries.length).toBe(3);
    for (const candidate of chain.entries) {
      expect(isE2eeModelId(candidate.modelId)).toBe(true);
    }
    // The failover the defect used: same tier, other vendors. It must not be
    // reachable from a sealed selection at all.
    const ids = chain.entries.map((e) => e.modelId);
    expect(ids).not.toContain('gpt-5.4');
    expect(ids).not.toContain('claude-opus-4.5');
    // The user's own tier still leads; the rest of the encrypted ladder is
    // the only fallback there is.
    expect(ids[0]).toBe('tinfoil-deepseek-r1');
  });

  it('keeps an unaffordable sealed pick rather than dropping to an affordable plaintext one', () => {
    const lineup = mixedLineup();
    // Covers every plaintext cell and no sealed one. This is the balance that
    // used to answer a sealed prompt on GPT.
    const balanceSats = 1_000;
    const sealedMax = lineup[E2EE_PROVIDER_ID].max!;
    expect(canAffordPricing(sealedMax.satsPricing, balanceSats)).toBe(false);
    expect(canAffordPricing(lineup.openai.max!.satsPricing, balanceSats)).toBe(true);

    const selected = resolveSelectedEntry(E2EE_PROVIDER_ID, 'max', balanceSats, lineup);
    expect(selected).not.toBeNull();
    // Unaffordable and encrypted beats affordable and readable. The send gate
    // turns this into "top up", which is a choice the user gets to make.
    expect(isE2eeModelId(selected!.modelId)).toBe(true);
    expect(selected!.modelId).toBe('tinfoil-deepseek-r1');
  });

  it('prefers an affordable sealed model over a dearer sealed one, inside the boundary', () => {
    const lineup = mixedLineup();
    // Clears the encrypted Auto rung (3,000 × 1.1) and nothing above it.
    const selected = resolveSelectedEntry(E2EE_PROVIDER_ID, 'max', 3_400, lineup);
    expect(selected?.modelId).toBe('tinfoil-glm-5-3');
  });

  it('is empty — not plaintext — when the node serves no encrypted model', () => {
    const lineup = emptyLineup();
    lineup.openai.max = entry('gpt-5.4', 100);
    const chain = resolveCandidateEntries(E2EE_PROVIDER_ID, 'max', lineup);
    expect(chain.sealed).toBe(true);
    expect(chain.entries).toEqual([]);
    // `null` is what makes the send fail with a reason instead of succeeding
    // against someone else's model.
    expect(selectFromChain(chain, 1_000_000)).toBeNull();
    expect(resolveSelectedEntry(E2EE_PROVIDER_ID, 'max', 1_000_000, lineup)).toBeNull();
  });

  it('trusts the model id over the grouping when the two disagree', () => {
    // A catalogue rename, or a lineup snapshot persisted before the encrypted
    // vendor existed, can file a plaintext id under the encrypted vendor. The
    // id is the switch the SDK reads, so the id is what decides.
    const lineup = emptyLineup();
    lineup[E2EE_PROVIDER_ID] = {
      auto: entry('glm-5-3', 3_000), // the plaintext twin, same display name
      pro: null,
      max: entry('tinfoil-deepseek-r1', 5_000),
    };
    const chain = resolveCandidateEntries(E2EE_PROVIDER_ID, 'auto', lineup);
    expect(chain.entries.map((e) => e.modelId)).toEqual(['tinfoil-deepseek-r1']);
  });

  it('leaves the failover of an unencrypted selection exactly as it was', () => {
    const lineup = mixedLineup();
    const chain = resolveCandidateEntries('openai', 'max', lineup);
    expect(chain.sealed).toBe(false);
    const ids = chain.entries.map((e) => e.modelId);
    // Chosen cell first, then the same tier across the other known vendors,
    // then the other tiers — the behaviour the user without an encryption
    // promise still wants.
    expect(ids[0]).toBe('gpt-5.4');
    expect(ids[1]).toBe('claude-opus-4.5');
    expect(ids).toContain('gpt-5.4-nano');
    // And it never wanders INTO the encrypted vendor either: an unsealed
    // selection picking up a sealed model would be harmless for privacy but
    // would quietly spend enclave prices.
    expect(ids.every((id) => !isE2eeModelId(id))).toBe(true);
    // Affordability still walks the whole chain for an ordinary vendor: no
    // Max cell is funded at 50 sats, so the walk drops to the Auto row.
    expect(resolveSelectedEntry('openai', 'max', 50, lineup)?.modelId).toBe('gpt-5.4-nano');
  });

  it('names the encrypted vendor by what it does, not by who runs it', () => {
    const provider = getProviderById(E2EE_PROVIDER_ID);
    expect(provider.label).toBe('Private (E2EE)');
    expect(provider.icon).toBe('mdi:lock-outline');
    // The generic glyph is the fallback for a vendor we ship no logo for, and
    // this one is no longer that.
    expect(provider.icon).not.toBe(getProviderById('some-unknown-vendor').icon);
  });
});

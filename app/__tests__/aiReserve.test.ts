/**
 * The reservation mirror, pinned against a real device.
 *
 * `features/ai/lib/reserve.ts` re-implements `@routstr/sdk`'s
 * `getRequiredSatsForModel` so the spend sheet can quote the figure BEFORE the
 * SDK mints it. A mirror is only worth having while it matches, so the three
 * cases below are not invented: they are three sends from `app/log.txt`, with
 * the catalogue pricing exactly as `ai.send.affordability_check` recorded it
 * and the expectation exactly as `routstr.sdk.sent` reported the minted
 * amount. If the SDK's arithmetic moves, these fail instead of the sheet
 * quietly going back to lying.
 */
import {
  isSealedModelId,
  reservePricingFromEntry,
  reservedSatsShown,
  type ReservePricing,
} from '@/features/ai/lib/reserve';
import type { RoutstrChatMessage } from '@/shared/lib/routstr/api';
import type { LineupEntry } from '@/shared/lib/routstr/lineup';

const user = (text: string): RoutstrChatMessage => ({ role: 'user', content: text });

/** `tinfoil-gemma4-31b` as `ai.send.affordability_check` logged it at
 *  10:12:09. Note `max_completion_cost === max_cost`: true of every sealed
 *  row, and the reason the cap always wins for them. */
const GEMMA: ReservePricing = {
  prompt: 0.0004783842264879333,
  completion: 0.001195960566219833,
  request: 0.001,
  max_cost: 306.16590495227723,
  max_completion_cost: 306.16590495227723,
};

/** `tinfoil-deepseek-v4-flash`, 10:11:48. */
const DEEPSEEK_FLASH: ReservePricing = {
  prompt: 0.0003659815094060505,
  completion: 0.0008539568552807846,
  request: 0.001,
  max_cost: 895.438663482904,
  max_completion_cost: 895.438663482904,
};

/** `gpt-oss-20b`, 10:10:22 — plaintext, and the one case where the completion
 *  discount actually applies. */
const GPT_OSS: ReservePricing = {
  prompt: 0.0000234552413579874,
  completion: 0.000117276206789937,
  request: 0.001,
  max_cost: 6.148650790548249,
  max_completion_cost: 3.8429067440926556,
};

describe('reservedSatsShown — reproduces what the SDK actually minted', () => {
  it('quotes 307 sats for the tinfoil-gemma4-31b send that minted 307', () => {
    // `routstr.sdk.sent { amount: 307 }`, settled at `costSats: 1`.
    expect(
      reservedSatsShown({
        modelId: 'tinfoil-gemma4-31b',
        pricing: GEMMA,
        contextLength: 256_000,
        maxCompletionTokens: 256_000,
        messages: [user('hi'), user('hi')],
        maxTokens: 4096,
      })
    ).toBe(307);
  });

  it('quotes 896 sats for the tinfoil-deepseek-v4-flash send that minted 896', () => {
    expect(
      reservedSatsShown({
        modelId: 'tinfoil-deepseek-v4-flash',
        pricing: DEEPSEEK_FLASH,
        contextLength: 1_048_576,
        maxCompletionTokens: 1_048_576,
        messages: [user('hi')],
        maxTokens: 4096,
      })
    ).toBe(896);
  });

  it('quotes 1 sat for the gpt-oss-20b send that minted 1', () => {
    expect(
      reservedSatsShown({
        modelId: 'gpt-oss-20b',
        pricing: GPT_OSS,
        contextLength: 131_072,
        maxCompletionTokens: 32_768,
        messages: [user('hi')],
        maxTokens: 4096,
      })
    ).toBe(1);
  });
});

describe('what max_tokens can and cannot buy back', () => {
  const sealedAt = (maxTokens: number) =>
    reservedSatsShown({
      modelId: 'tinfoil-gemma4-31b',
      pricing: GEMMA,
      contextLength: 256_000,
      maxCompletionTokens: 256_000,
      messages: [user('hi')],
      maxTokens,
    });

  it('changes nothing on a sealed model, at any budget', () => {
    // The node cannot read a sealed body, so it will not credit a bound it
    // cannot check. An encrypted turn costs the model's whole ceiling up
    // front — this is the 307/1 case, and no max_tokens fixes it.
    expect(sealedAt(4096)).toBe(307);
    expect(sealedAt(2000)).toBe(307);
    expect(sealedAt(256)).toBe(307);
  });

  it('scales the reservation on a plaintext model', () => {
    const plaintext: ReservePricing = {
      prompt: 0.0006515344821663166,
      completion: 0.0032576724108315832,
      request: 0.001,
      max_cost: 297.0997238678404,
      max_completion_cost: 208.49103429322133,
    };
    const at = (maxTokens: number) =>
      reservedSatsShown({
        modelId: 'claude-haiku-4.5:batch',
        pricing: plaintext,
        contextLength: 200_000,
        maxCompletionTokens: 64_000,
        messages: [user('hi')],
        maxTokens,
      });
    // The lever, measured: the old blanket 4096 against the 2000 we now send
    // against a quarter of it. Roughly linear, because the completion side is
    // almost the whole reservation on a short prompt.
    expect(at(4096)).toBe(15);
    expect(at(2000)).toBe(7);
    expect(at(1024)).toBe(4);
  });

  it('never quotes below one sat, because a zero token buys nothing', () => {
    const free: ReservePricing = {
      prompt: 0,
      completion: 0,
      request: 0,
      max_cost: 0,
      max_completion_cost: 1,
    };
    expect(
      reservedSatsShown({
        modelId: 'free',
        pricing: free,
        contextLength: 1000,
        maxCompletionTokens: 100,
        messages: [user('hi')],
        maxTokens: 2000,
      })
    ).toBe(1);
  });
});

describe('sources of truth', () => {
  it('says nothing rather than something false when pricing is unknown', () => {
    expect(
      reservedSatsShown({
        modelId: 'mystery',
        pricing: null,
        contextLength: null,
        maxCompletionTokens: null,
        messages: [user('hi')],
        maxTokens: 2000,
      })
    ).toBeNull();
  });

  it('reconstructs a lineup entry max_completion_cost as completion × ceiling', () => {
    // The identity the node itself uses: gemma4-31b's 306.1659 is exactly
    // 0.00119596 × 256000, its own completion ceiling.
    const entry: LineupEntry = {
      modelId: 'tinfoil-gemma4-31b',
      displayName: 'Gemma',
      contextLength: 256_000,
      created: 1,
      visionInput: false,
      maxCompletionTokens: 256_000,
      satsPricing: {
        prompt: GEMMA.prompt,
        completion: GEMMA.completion,
        request: GEMMA.request,
        image: 0,
        max_cost: GEMMA.max_cost,
      },
    };
    expect(reservePricingFromEntry(entry)?.max_completion_cost).toBeCloseTo(
      GEMMA.max_completion_cost as number,
      6
    );
  });

  it('degrades an entry with no completion ceiling to the whole worst case', () => {
    // Over-stating is survivable; under-stating is the bug being fixed.
    const entry: LineupEntry = {
      modelId: 'legacy',
      displayName: 'Legacy',
      contextLength: 8000,
      created: 1,
      visionInput: false,
      satsPricing: { prompt: 0.001, completion: 0.01, request: 0, image: 0, max_cost: 120 },
    };
    const pricing = reservePricingFromEntry(entry);
    expect(pricing?.max_completion_cost).toBeNull();
    expect(
      reservedSatsShown({
        modelId: 'legacy',
        pricing,
        contextLength: 8000,
        maxCompletionTokens: null,
        messages: [user('hi')],
        maxTokens: 2000,
      })
    ).toBe(120);
  });

  it('knows which model ids the node cannot discount', () => {
    expect(isSealedModelId('tinfoil-gemma4-31b')).toBe(true);
    expect(isSealedModelId('gpt-oss-20b')).toBe(false);
  });
});

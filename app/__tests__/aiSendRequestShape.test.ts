/**
 * What one AI request actually puts on the wire, and whether the number the
 * user was shown is the number the node will charge.
 *
 * Two defects met here.
 *
 * 1. We sent parameters the reference clients do not. `routstr-chat`'s
 *    `useChatActions` and `@routstr/sdk`'s `fetchAIResponse` both build
 *    `{model, messages, stream}` and add a sampling parameter only when a
 *    caller supplies one; this app added a blanket `temperature: 0.7` to every
 *    chat turn. `RoutstrModel` carries no field saying which models accept
 *    one — reasoning models reject a non-default temperature outright — so it
 *    is a guess that can only lose. `max_tokens` is the opposite case: the
 *    catalogue states each model's ceiling in
 *    `top_provider.max_completion_tokens`, and routstr-core's
 *    `calculate_discounted_max_cost` discounts the upfront reservation by
 *    exactly the `max_tokens` a request carries. So one goes and one stays,
 *    and the one that stays is clamped from catalogue data.
 *
 * 2. The gate has to price the SAME `max_tokens`. It used to charge a flat
 *    `ROUTSTR_MAX_COMPLETION_TOKENS` while the request sent the clamped
 *    figure, so on a model whose ceiling is under 4096 the app demanded funds
 *    for a completion budget the request never asked for.
 *
 * The vendor-fallback case at the bottom is the other half of the same send:
 * a lineup full of vendors outside the four the app ships a logo for used to
 * produce a candidate chain of zero and a refusal to send.
 */
import { act, renderHook } from '@testing-library/react-native';
import { useAiSend } from '@/features/ai/hooks/useAiSend';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { emptyLineup, type AiLineup, type LineupEntry } from '@/shared/lib/routstr/lineup';
import { sendMessage, checkBalance, ROUTSTR_MAX_COMPLETION_TOKENS } from '@/shared/lib/routstr/api';
import {
  AFFORD_BUFFER,
  maxSpendSats,
  requiredReserveSatsFromPricing,
  resolveCandidateEntries,
  selectFromChain,
  sendMaxTokens,
} from '@/features/ai/lib/format';

jest.mock('@/features/ai/lib/spendConfirm', () => ({ confirmSpend: jest.fn() }));
jest.mock('@/shared/lib/routstr/api', () => ({
  ...jest.requireActual('@/shared/lib/routstr/api'),
  sendMessage: jest.fn(),
  checkBalance: jest.fn(),
}));
jest.mock('@/shared/lib/routstr/refreshLineup', () => ({ refreshRoutstrLineup: jest.fn() }));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: { getState: () => ({ activeAccountIndex: 0 }) },
}));
jest.mock('@/shared/lib/routstr/securePersistence', () => ({
  createRoutstrPersistence: () =>
    jest.requireMock('@/shared/lib/cashu/profileScopedStorage').createProfileScopedStorage(),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/stores/runtime/routstrTopUpStore', () => ({
  useRoutstrTopUpStore: { getState: jest.fn() },
}));
jest.mock('@/shared/stores/profile/mintStore', () => {
  const useMintStore = Object.assign(
    (selector: (s: { selectedMint: string }) => unknown) =>
      selector({ selectedMint: 'https://mint.example' }),
    { getState: () => ({ selectedMint: 'https://mint.example' }) }
  );
  return { useMintStore };
});
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: null }),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { navigate: jest.fn() } }));
jest.mock('@/shared/lib/popup', () => ({
  actionMenuPopup: jest.fn(),
  staticPopup: jest.fn(),
  paramPopup: jest.fn(),
}));
jest.mock('@/shared/ui/primitives/Haptics', () => ({
  EnhancedHaptics: { navigateHaptic: jest.fn() },
}));
jest.mock('@/features/ai/lib/attachments', () => ({ encodeChatImage: jest.fn() }));
jest.mock('@/shared/lib/logger', () => {
  const log = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    startSpan: () => ({ end: jest.fn() }),
  };
  return { apiLog: log, aiLog: log, storeLog: log, log, applyFileLogging: jest.fn() };
});
jest.mock('@cashu/coco-react', () => ({
  useBalanceContext: () => ({
    balances: {
      byMint: { 'https://mint.example': { total: 100_000, spendable: 100_000, unit: 'sat' } },
    },
  }),
}));

/** Per-token pricing, so the reserve is the discounted admission figure the
 *  node computes rather than the `max_cost` fallback. */
const entry = (modelId: string, maxCompletionTokens: number | null): LineupEntry => ({
  modelId,
  displayName: modelId,
  contextLength: 128_000,
  created: 1,
  visionInput: true,
  satsPricing: { prompt: 0.0001, completion: 0.002, request: 0, image: 0, max_cost: 900 },
  ...(maxCompletionTokens != null ? { maxCompletionTokens } : {}),
});

const success = () => ({
  cost: Promise.resolve(1),
  stream: (async function* () {
    yield { choices: [{ delta: { content: 'reply' } }] };
  })(),
});

const sendMock = jest.mocked(sendMessage);

/** Boot the store onto `lineup` with `provider` selected, then send once. */
async function sendWith(
  lineup: AiLineup,
  provider = 'openai',
  extra: Partial<Parameters<typeof useRoutstrStore.setState>[0]> = {}
) {
  useRoutstrStore.setState({
    apiKey: 'cashuA-key',
    authMode: 'bearer',
    confirmSpend: false,
    balance: 100_000,
    lineup,
    lastKnownLineup: null,
    nodeBaseUrl: 'https://node.example',
    userNodeBaseUrl: 'https://node.example',
    selectedProvider: provider,
    selectedTier: 'auto',
    conversationHistory: [],
    sessions: [],
    currentSessionId: null,
    isAnonymousMode: true,
    ...extra,
  });
  const hook = renderHook(useAiSend);
  await act(async () => {
    await hook.result.current.send('hello');
  });
  hook.unmount();
}

beforeEach(async () => {
  jest.clearAllMocks();
  await useRoutstrStore.persist.rehydrate();
  jest.mocked(checkBalance).mockResolvedValue({ balance: 99_000 });
  sendMock.mockResolvedValue(success());
});

describe('what a chat request carries', () => {
  it('sends no temperature — the catalogue cannot say which models accept one', async () => {
    const lineup = emptyLineup();
    lineup.openai.auto = entry('gpt-oss-20b', null);
    await sendWith(lineup);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const options = sendMock.mock.calls[0][1];
    // Not `undefined` — absent. `sendMessage` reads this with a destructuring
    // default, so an explicit `undefined` would be indistinguishable from
    // passing 0.7 by hand.
    expect(Object.prototype.hasOwnProperty.call(options, 'temperature')).toBe(false);
    // The rest of the request is unchanged: still the verbatim catalogue id.
    expect(options.model).toBe('gpt-oss-20b');
  });

  it('bounds max_tokens by the catalogue ceiling, not by a blanket constant', async () => {
    const lineup = emptyLineup();
    lineup.openai.auto = entry('short-ceiling', 1024);
    await sendWith(lineup);
    expect(sendMock.mock.calls[0][1].max_tokens).toBe(1024);
  });

  it('keeps the default when the model claims a ceiling above it', async () => {
    const lineup = emptyLineup();
    lineup.openai.auto = entry('long-ceiling', 128_000);
    await sendWith(lineup);
    expect(sendMock.mock.calls[0][1].max_tokens).toBe(ROUTSTR_MAX_COMPLETION_TOKENS);
  });

  it('keeps sending max_tokens when the catalogue states no ceiling', async () => {
    // Omitting it is not an option: routstr-core only discounts the completion
    // side of its reservation for a request that bounds it, so a bare request
    // is charged the model's whole `max_completion_cost`.
    const lineup = emptyLineup();
    lineup.openai.auto = entry('unknown-ceiling', null);
    await sendWith(lineup);
    expect(sendMock.mock.calls[0][1].max_tokens).toBe(ROUTSTR_MAX_COMPLETION_TOKENS);
  });
});

describe('the reservation the user is shown is the one the request buys', () => {
  const pricing = entry('x', null).satsPricing;

  it('prices exactly the max_tokens the send will carry', () => {
    for (const ceiling of [null, 512, 1024, 4096, 128_000]) {
      const sent = sendMaxTokens(ceiling);
      const reserve = requiredReserveSatsFromPricing(pricing, 0, ceiling)!;
      // request + 8000 × prompt + max_tokens × completion — the server's
      // `calculate_discounted_max_cost`, recomputed from the same figure.
      expect(reserve).toBeCloseTo(0 + 8000 * 0.0001 + sent * 0.002, 6);
    }
  });

  it('charges a short-ceiling model less up front than the blanket default did', () => {
    const short = entry('short-ceiling', 1024);
    const flat = Math.max(
      1,
      Math.ceil(requiredReserveSatsFromPricing(pricing, 0, null)! * AFFORD_BUFFER)
    );
    const clamped = maxSpendSats(short);
    expect(sendMaxTokens(short.maxCompletionTokens)).toBe(1024);
    expect(clamped).toBeLessThan(flat);
  });

  it('no longer refuses a balance the node would have admitted', () => {
    // A wallet holding enough for the clamped reservation and not for the flat
    // one. The old gate said "top up" and the node would have taken the
    // request; now the two agree.
    const short = entry('short-ceiling', 1024);
    const balanceSats = maxSpendSats(short);
    const flatReserve = requiredReserveSatsFromPricing(pricing, 0, null)!;
    expect(balanceSats).toBeLessThan(flatReserve * AFFORD_BUFFER);

    const lineup = emptyLineup();
    lineup.openai.auto = short;
    const chain = resolveCandidateEntries('openai', 'auto', lineup);
    expect(selectFromChain(chain, balanceSats)?.modelId).toBe('short-ceiling');
  });
});

describe('a send against a lineup of vendors the app ships no logo for', () => {
  /** What a node serving only `qwen` and `deepseek` derives to. Both are
   *  ordinary plaintext vendors; neither is in `AI_PROVIDER_IDS`. */
  function unnamedVendorLineup(): AiLineup {
    const lineup = emptyLineup();
    lineup.qwen = { auto: entry('qwen3-next-80b', 2048), pro: null, max: null };
    lineup.deepseek = { auto: entry('deepseek-v4', null), pro: null, max: null };
    return lineup;
  }

  it('builds a candidate chain instead of refusing to send', async () => {
    // `selectedProvider` is still `openai` — the vendor the boot default names
    // and this node does not serve. Before the fix the chain walked only the
    // four named vendors, came back empty, and the send logged
    // `ai.send.no_lineup` with `hasCatalog: true` over a lineup it was holding.
    const chain = resolveCandidateEntries('openai', 'auto', unnamedVendorLineup());
    expect(chain.sealed).toBe(false);
    expect(chain.entries.map((e) => e.modelId)).toEqual(['qwen3-next-80b', 'deepseek-v4']);

    await sendWith(unnamedVendorLineup());
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][1].model).toBe('qwen3-next-80b');
    // This entry's catalogue ceiling is 2048, above the budget we ask for, so
    // the budget wins — the clamp only ever bites downwards.
    expect(sendMock.mock.calls[0][1].max_tokens).toBe(ROUTSTR_MAX_COMPLETION_TOKENS);
  });

  it('still leads with the named vendors when the node serves them', () => {
    const lineup = unnamedVendorLineup();
    lineup.openai.auto = entry('gpt-oss-20b', null);
    lineup.claude.auto = entry('claude-haiku-4.5', null);
    const ids = resolveCandidateEntries('openai', 'auto', lineup).entries.map((e) => e.modelId);
    // Unchanged ordering for an ordinary catalogue: the pick, then the named
    // four in their own order, and only then the rest of the lineup.
    expect(ids.slice(0, 2)).toEqual(['gpt-oss-20b', 'claude-haiku-4.5']);
    expect(ids).toContain('qwen3-next-80b');
  });
});

/**
 * The sheet said "up to 10 sats" and 307 left the wallet.
 *
 * `maxSpendSats` priced a hypothetical average turn — 8000 prompt tokens, the
 * blanket completion budget, a flat 10% buffer — and the node priced the
 * request. Two calculations, no reason for them to agree, and on a sealed
 * model they disagreed by a factor of thirty. Both figures below come from one
 * send in `app/log.txt`: `ai.send.gate` showing the estimate, `routstr.sdk.sent
 * { amount: 307 }` a few seconds later.
 */
describe('what the spend sheet is told', () => {
  /** `tinfoil-gemma4-31b` as the node published it at 10:12:09. */
  const GEMMA_PRICING = {
    prompt: 0.0004783842264879333,
    completion: 0.001195960566219833,
    request: 0.001,
    image: 0,
    max_cost: 306.16590495227723,
    max_prompt_cost: 122.46636198091092,
    max_completion_cost: 306.16590495227723,
  };

  const gemmaCatalogRow = {
    id: 'tinfoil-gemma4-31b',
    name: 'Gemma 4 31B',
    context_length: 256_000,
    sats_pricing: GEMMA_PRICING,
    top_provider: { context_length: 256_000, max_completion_tokens: 256_000 },
  };

  /** `sendWith`'s store overrides for this case. The catalogue row is a
   *  partial `RoutstrModel` — the pricing path reads five fields off it and
   *  tolerates the rest being absent, which is what the live spine does too. */
  const withCatalog = {
    confirmSpend: true,
    modelsCache: { data: [gemmaCatalogRow], timestamp: 1 },
  } as unknown as Partial<Parameters<typeof useRoutstrStore.setState>[0]>;

  const gemmaEntry: LineupEntry = {
    modelId: 'tinfoil-gemma4-31b',
    displayName: 'Gemma 4 31B',
    contextLength: 256_000,
    created: 1,
    visionInput: false,
    maxCompletionTokens: 256_000,
    satsPricing: {
      prompt: GEMMA_PRICING.prompt,
      completion: GEMMA_PRICING.completion,
      request: GEMMA_PRICING.request,
      image: 0,
      max_cost: GEMMA_PRICING.max_cost,
    },
  };

  it('quotes the 307 sats the node actually took, not the 10 the estimate guessed', async () => {
    const { confirmSpend } = jest.requireMock('@/features/ai/lib/spendConfirm') as {
      confirmSpend: jest.Mock;
    };
    confirmSpend.mockResolvedValue(true);

    const lineup = emptyLineup();
    lineup.openai.auto = gemmaEntry;
    await sendWith(lineup, 'openai', withCatalog);

    // What the old sheet would have said, still computed the old way.
    expect(maxSpendSats(gemmaEntry)).toBeLessThan(20);
    // What it says now.
    expect(confirmSpend).toHaveBeenCalledWith(
      expect.objectContaining({ reserveSats: 307, reserveKnown: true })
    );
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('declining the real figure sends nothing', async () => {
    const { confirmSpend } = jest.requireMock('@/features/ai/lib/spendConfirm') as {
      confirmSpend: jest.Mock;
    };
    confirmSpend.mockResolvedValue(false);

    const lineup = emptyLineup();
    lineup.openai.auto = gemmaEntry;
    await sendWith(lineup, 'openai', withCatalog);

    expect(confirmSpend).toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    // And the transcript is untouched — a declined send leaves no orphan
    // question with no answer under it.
    expect(useRoutstrStore.getState().conversationHistory).toHaveLength(0);
  });
});

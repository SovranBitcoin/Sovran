/**
 * Stand-in for `@routstr/sdk/browser` under Jest.
 *
 * The real package reaches `applesauce-relay`, which is ESM-only and pulls
 * `node:crypto` through a chain Jest's CJS runtime cannot transform. Rather
 * than widen `transformIgnorePatterns` down a dependency tree the app never
 * executes in a test, `moduleNameMapper` points the SDK here.
 *
 * What this proves and what it does not: the seams Sovran owns — the wallet
 * adapter, the payment annotation, the cost arithmetic and this app's error
 * classification — run against a `routeRequest` that behaves the way the real
 * one does (spend, send, bank the change from `X-Cashu`, report spent minus
 * returned). It proves nothing about the SDK's own transport, failover or
 * Tinfoil sealing; the Metro bundle build and a funded device run are what
 * cover those.
 */

interface WalletAdapter {
  getBalances(): Promise<Record<string, number>>;
  getMintUnits(): Record<string, 'sat' | 'msat'>;
  getActiveMintUrl(): string | null;
  sendToken(mintUrl: string, amount: number): Promise<string>;
  receiveToken(
    token: string
  ): Promise<{ success: boolean; amount: number; unit: 'sat' | 'msat'; message?: string }>;
}

export interface Model {
  id: string;
  sats_pricing?: { max_cost?: number } | null;
}

export class ProviderError extends Error {
  constructor(
    public baseUrl: string,
    public statusCode: number,
    message: string,
    public requestId?: string
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class MintError extends Error {
  statusCode: number;
  mintUrl?: string;
  code?: string;
  constructor(opts: { baseUrl: string; statusCode?: number; mintUrl?: string; code?: string }) {
    super(`Mint error from ${opts.mintUrl ?? opts.baseUrl}`);
    this.name = 'MintError';
    this.statusCode = opts.statusCode ?? 422;
    this.mintUrl = opts.mintUrl;
    this.code = opts.code;
  }
}

export class MintUnreachableError extends Error {
  constructor(public mintUrl: string) {
    super(`Mint ${mintUrl} is unreachable`);
    this.name = 'MintUnreachableError';
  }
}

export class NoProvidersAvailableError extends Error {
  constructor() {
    super('No providers available');
    this.name = 'NoProvidersAvailableError';
  }
}

export class FailoverError extends Error {
  constructor(
    public originalProvider: string,
    public failedProviders: string[],
    message = 'All providers failed'
  ) {
    super(message);
    this.name = 'FailoverError';
  }
}

export class InsufficientBalanceError extends Error {
  constructor(
    public required: number,
    public available: number,
    public maxMintBalance = 0,
    public maxMintUrl = ''
  ) {
    super(`Insufficient balance: need ${required} sats, have ${available} sats available.`);
    this.name = 'InsufficientBalanceError';
  }
}

/** The SDK's typed redemption failures — the node's own `type`/`code` for a
 *  token it could not use, as `core/errors.ts` classes them. */
class CoreRedemptionError extends Error {
  constructor(
    message: string,
    public recoveryAttempted = false,
    public recoverySucceeded = false
  ) {
    super(message);
  }
}

export class InvalidTokenError extends CoreRedemptionError {
  constructor(message = 'Invalid Cashu token') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

export class CashuRedemptionError extends CoreRedemptionError {
  constructor(message = 'Failed to redeem Cashu token') {
    super(message);
    this.name = 'CashuRedemptionError';
  }
}

export class TokenConsumedError extends CoreRedemptionError {
  constructor(message = 'Token was consumed but not credited') {
    super(message);
    this.name = 'TokenConsumedError';
  }
}

export class CoreInternalError extends CoreRedemptionError {
  constructor(message = 'Internal error during token redemption') {
    super(message);
    this.name = 'CoreInternalError';
  }
}

export class TokenAlreadySpentError extends Error {
  constructor(message = 'Token already spent') {
    super(message);
    this.name = 'TokenAlreadySpentError';
  }
}

/** The gate amount the stub funds when the seeded catalog does not price the
 *  model. Tests that assert on the minted amount set the catalog instead. */
const DEFAULT_REQUIRED_SATS = 10;

interface StubStore {
  tokens: Record<string, { token: string; baseUrl: string }[]>;
  driver: {
    getItem<T>(key: string, fallback: T): Promise<T>;
    setItem<T>(key: string, value: T): Promise<void>;
  };
}
export const createSdkStore = ({ driver }: Pick<StubStore, 'driver'>) => {
  const store: StubStore = { tokens: {}, driver };
  const hydrate = driver.getItem<StubStore['tokens']>('xcashu_tokens', {}).then((tokens) => {
    store.tokens = tokens;
  });
  return { store, hydrate };
};

export const createStorageAdapterFromStore = (store: StubStore) => ({
  getXcashuTokens: () => store.tokens,
  getXcashuTokensForBaseUrl: (baseUrl: string) => store.tokens[baseUrl] ?? [],
  removeXcashuToken: (baseUrl: string, token: string) => {
    store.tokens = {
      ...store.tokens,
      [baseUrl]: (store.tokens[baseUrl] ?? []).filter((entry) => entry.token !== token),
    };
    void store.driver.setItem('xcashu_tokens', store.tokens);
  },
  addXcashuToken: (baseUrl: string, token: string) => {
    store.tokens = {
      ...store.tokens,
      [baseUrl]: [...(store.tokens[baseUrl] ?? []), { baseUrl, token }],
    };
    void store.driver.setItem('xcashu_tokens', store.tokens);
  },
});

export type DiscoveryAdapter = ReturnType<typeof createDiscoveryAdapterFromStore>;

export const createDiscoveryAdapterFromStore = () => {
  let models: Record<string, Model[]> = {};
  let mints: Record<string, string[]> = {};
  const updates: Record<string, number> = {};
  return {
    getCachedModels: () => models,
    setCachedModels: (next: Record<string, Model[]>) => {
      models = next;
    },
    getCachedMints: () => mints,
    setCachedMints: (next: Record<string, string[]>) => {
      mints = next;
    },
    getProviderLastUpdate: (baseUrl: string) => updates[baseUrl] ?? null,
    setProviderLastUpdate: (baseUrl: string, at: number) => {
      updates[baseUrl] = at;
    },
  };
};

interface RoutedResponse extends Response {
  satsSpent?: number;
  finalize?: () => Promise<number>;
}

function sdkFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Raw fetch stands in for the SDK transport, including streaming responses.
  // eslint-disable-next-line no-restricted-globals -- tests stub this SDK transport seam
  return fetch(input, init);
}

export class RoutstrClient {
  constructor(
    private wallet: WalletAdapter,
    private storage: ReturnType<typeof createStorageAdapterFromStore>,
    private discovery: ReturnType<typeof createDiscoveryAdapterFromStore>,
    _alertLevel: 'max' | 'min',
    _mode?: 'xcashu' | 'apikeys'
  ) {}

  getCashuSpender() {
    return { refundXcashuTokens: async () => [] };
  }

  getBalanceManager() {
    return {
      fetchRefundToken: async (baseUrl: string, token: string, _xcashu: boolean) => {
        const response = await sdkFetch(`${baseUrl.replace(/\/$/, '')}/v1/wallet/refund`, {
          method: 'POST',
          headers: { 'X-Cashu': token },
        });
        if (!response.ok) {
          // Mirrors the real `BalanceManager.fetchRefundToken`: the refusal
          // text is the only thing that tells a pending refund apart from a
          // dead one, and the recovery sweep logs it.
          const raw = await response.text().catch(() => '');
          let detail: string | undefined;
          try {
            const parsed: unknown = JSON.parse(raw);
            const record = (parsed ?? {}) as { detail?: unknown; error?: { message?: unknown } };
            if (typeof record.detail === 'string') detail = record.detail;
            else if (typeof record.error?.message === 'string') detail = record.error.message;
          } catch {
            detail = undefined;
          }
          return {
            success: false,
            status: response.status,
            token: undefined,
            error: `API key refund failed: ${detail ?? `${response.status} ${response.statusText}`}`,
          };
        }
        const body: { token?: string } = await response.json();
        return { success: true, token: body.token, status: response.status };
      },
    };
  }

  private requiredSats(baseUrl: string, modelId?: string): number {
    const key = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const priced = this.discovery.getCachedModels()[key]?.find((m) => m.id === modelId);
    return Math.ceil(priced?.sats_pricing?.max_cost ?? DEFAULT_REQUIRED_SATS);
  }

  async routeRequest(params: {
    path: string;
    method: string;
    baseUrl: string;
    mintUrl: string;
    modelId?: string;
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<Response> {
    const balances = await this.wallet.getBalances();
    const total = Object.values(balances).reduce((sum, v) => sum + v, 0);
    const required = this.requiredSats(params.baseUrl, params.modelId);
    if (total <= 0) throw new InsufficientBalanceError(required, total);

    const token = await this.wallet.sendToken(params.mintUrl, required);
    const response = (await sdkFetch(`${params.baseUrl.replace(/\/$/, '')}${params.path}`, {
      method: params.method,
      headers: { 'X-Cashu': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(params.body),
      signal: params.signal,
    })) as RoutedResponse;

    const bank = async () => {
      const change = response.headers.get('x-cashu');
      if (!change) return required;
      // CashuSpender converts adapter rejections into failed receipts.
      const received = await this.wallet
        .receiveToken(change)
        .catch(() => ({ success: false, amount: 0 }));
      // Exercise the adapter against an SDK removal even when receipt failed.
      this.storage.removeXcashuToken(params.baseUrl, token);
      return Math.max(0, required - (received.success ? received.amount : 0));
    };

    if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
      // The real client starts this eagerly, so the change comes home whether
      // or not the caller ever consumes the stream.
      const pending = bank();
      response.finalize = () => pending;
      return response;
    }
    response.satsSpent = await bank();
    return response;
  }
}

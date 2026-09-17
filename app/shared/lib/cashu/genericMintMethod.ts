/**
 * @fileoverview Generic NUT-04 mint handler — receiving over a payment method
 * that has no NUT of its own.
 *
 * ## Why this exists
 *
 * NUT-04 deliberately leaves `method` open: it is any `[a-z0-9_-]+` string
 * carried on `POST /v1/mint/quote/{method}`, and a mint publishes the ones it
 * serves in its NUT-06 info. Three methods have a dedicated spec — NUT-23
 * `bolt11`, NUT-25 `bolt12`, NUT-30 `onchain` — and coco ships a handler for
 * exactly those three. Everything else is unreachable: coco's
 * `MintHandlerProvider` throws `No mint handler registered for method …`.
 *
 * Mints do use the freedom. `mint.sortug.com` advertises `venmo` (usd) and
 * `paypal` (sat) in NUT-04 and issues real quotes for both:
 *
 *   POST /v1/mint/quote/venmo {"unit":"usd","amount":100,"pubkey":"03…"}
 *   → {"quote":"01a0…","request":"venmo:84be897a-…","amount":100,
 *      "amount_paid":0,"amount_issued":0,"unit":"usd","expiry":1789659112,
 *      "pubkey":"03…"}
 *
 * coco's own plan to support this — PRD cashubtc/coco#232 "Generic Payment
 * Methods", with #234/#235/#237/#238 — was closed NOT_PLANNED on 2026-07-02,
 * so it is not coming upstream. cashu-ts, however, is already generic
 * (`createMintQuote(method, …)`, `checkMintQuote(method, …)`,
 * `mintProofs(method, …)` — its docs cite `'bacs'`/`'swift'` as examples), so
 * the only missing piece is a coco handler. That is this file.
 *
 * ## What it does NOT do
 *
 * Receive only. There is no generic melt: coco's melt saga is quote-backed
 * with method-specific fee-reserve and change semantics that an unspecified
 * method describes nowhere, and the one mint observed advertising custom melt
 * rejects those melt quotes outright (`/v1/melt/quote/venmo` →
 * `50000 Invalid payment method`). colada reports custom melt unavailable via
 * `isMethodImplemented`, so no send flow can reach here.
 *
 * ## Shape
 *
 * Modelled on coco's `MintBolt12Handler` because a generic quote has the same
 * shape as a BOLT12 one: reusable, NUT-20 lockable, with an optional amount
 * and NUT-04 `amount_paid`/`amount_issued` accounting. The differences are
 * that the method string is injected rather than hardcoded, and that the
 * NUT-20 lock is treated as optional — see `execute`.
 *
 * Registered against the patched coco `Manager.mintHandlerProvider`
 * (`app/patches/@cashu+coco-core+2.0.0.patch`), which also re-exports the
 * internals used below.
 */

import {
  Amount,
  assessMintQuoteClaimability,
  deserializeOutputData,
  getReusableMintQuoteValidationError,
  mapProofToCoreProof,
  mintQuoteObservationFromBolt12Response,
  MintOperationError,
  MintQuoteKeyError,
  MintQuoteValidationError,
  serializeOutputData,
  type Manager,
} from '@cashu/coco-core';
import { bytesToHex } from '@noble/curves/utils.js';
import type { Proof, Wallet } from '@cashu/cashu-ts';

import { cashuLog, mintUrlLogFields } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Typed seam over coco internals
// ---------------------------------------------------------------------------
//
// coco's published `.d.ts` types every mint-handler shape against
// `MintMethod = 'bolt11' | 'bolt12' | 'onchain'`, so an arbitrary method
// string cannot be expressed in its generics at all. Rather than patch the
// 149 KB bundled declaration chunk (which would have to be re-diffed on every
// coco release), the structural contracts this handler actually depends on are
// restated here and the cast is confined to `registerGenericMintMethods`.
// Same rule as `managerInternals.ts`: one place to break when coco moves.

/** The mint's own quote response, as cashu-ts normalizes it. */
interface GenericQuoteResponse {
  quote: string;
  request: string;
  unit: string;
  expiry?: number | null;
  pubkey?: string;
  amount?: unknown;
  amount_paid?: unknown;
  amount_issued?: unknown;
  updated_at?: number | null;
}

interface CocoKeyPair {
  publicKeyHex: string;
  secretKey: Uint8Array;
}

interface KeyRingServiceLike {
  generateMintQuoteKeyPair(): Promise<CocoKeyPair>;
  getMintQuoteKeyPair(pubkey: string): Promise<CocoKeyPair | null>;
}

interface MintAdapterLike {
  checkMintQuote(mintUrl: string, method: string, quoteId: string): Promise<GenericQuoteResponse>;
}

interface ProofServiceLike {
  createOutputsAndIncrementCounters(
    mintUrl: string,
    split: {
      keep: { amount: Amount; unit: string };
      send: { amount: Amount; unit: string };
    },
    options: Record<string, never>
  ): Promise<{ keep: unknown[]; send: unknown[] }>;
  saveProofs(mintUrl: string, proofs: unknown[]): Promise<void>;
  recoverProofsFromOutputData(
    mintUrl: string,
    outputData: unknown,
    options: { unit: string; createdByOperationId: string }
  ): Promise<unknown[]>;
}

interface HandlerDeps {
  proofService: ProofServiceLike;
  mintAdapter: MintAdapterLike;
  logger?: { warn(message: string, meta?: unknown): void };
}

interface GenericMintOperation {
  id: string;
  mintUrl: string;
  unit: string;
  amount: Amount;
  quoteId: string;
  request: string;
  expiry?: number | null;
  pubkey?: string;
  outputData: unknown;
  method: string;
  state: string;
}

interface CreateQuoteCtx extends HandlerDeps {
  mintUrl: string;
  wallet: Wallet;
  createQuoteData: { unit: string; amount?: { amount: Amount; unit: string } | Amount };
}

interface FetchRemoteCtx extends HandlerDeps {
  quote: {
    mintUrl: string;
    quoteId: string;
    unit: string;
    method: string;
    quoteData: { pubkey?: string };
  };
}

interface PrepareCtx extends HandlerDeps {
  operation: GenericMintOperation;
  importedQuote?: GenericQuoteResponse;
}

interface ExecuteCtx extends HandlerDeps {
  operation: GenericMintOperation;
  wallet: Wallet;
}

interface RecoverCtx extends ExecuteCtx {
  localClaimabilityFacts: { finalizedAmount: Amount; reservedAmount: Amount };
}

interface PendingCtx {
  operation: GenericMintOperation;
  mintAdapter: MintAdapterLike;
  logger?: { warn(message: string, meta?: unknown): void };
}

/** coco's patched `Manager` surface: the runtime mint-handler registry. */
interface PatchedManager {
  mintHandlerProvider?: {
    getAll(): Record<string, unknown>;
    register(method: string, handler: unknown): void;
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Coco error codes that mean "these outputs were already signed", i.e. the
 * mint has issued and a retry must recover rather than re-mint. Same set the
 * built-in handlers use.
 */
function isAlreadyIssuedError(error: unknown): boolean {
  if (error instanceof MintOperationError && (error.code === 20002 || error.code === 11003)) {
    return true;
  }
  return /already (issued|signed)|outputs? already/i.test(errorMessage(error));
}

function toAmountValue(
  value: { amount: Amount; unit: string } | Amount | undefined
): Amount | undefined {
  if (value == null) return undefined;
  return value instanceof Amount ? value : value.amount;
}

/**
 * A NUT-04 mint handler for one mint-advertised payment method.
 *
 * One instance per method string, so `operation.method` and the endpoint the
 * request lands on can never drift apart.
 */
class GenericMintHandler {
  constructor(
    private readonly method: string,
    private readonly keyRingService: KeyRingServiceLike
  ) {}

  private label(quoteId: string): string {
    return `${this.method} mint quote ${quoteId}`;
  }

  /**
   * Maps a raw quote response into coco's canonical quote record.
   *
   * `mintQuoteObservationFromBolt12Response` is coco's own reusable-quote
   * mapper (amount / amount_paid / amount_issued / pubkey / expiry) and is
   * method-agnostic apart from stamping `method: 'bolt12'` — so the method is
   * overwritten with the real one. Persisting the mint-advertised string
   * verbatim is what keeps the quote traceable to the endpoint that issued it.
   */
  private toCanonicalQuote(mintUrl: string, quote: GenericQuoteResponse) {
    const canonical = mintQuoteObservationFromBolt12Response(
      mintUrl,
      quote as never
    ) as unknown as Record<string, unknown>;
    return { ...canonical, method: this.method };
  }

  /**
   * NUT-20 is optional and a mint that does not implement it simply omits
   * `pubkey` from the response. Requiring the echo would lock out every
   * such mint, and coco's own BOLT11 quotes are unlocked by default, so an
   * omitted pubkey is accepted and the quote is minted unlocked. What is NOT
   * accepted is a DIFFERENT pubkey: that would bind the quote to key material
   * the wallet does not hold, which is a funds-loss shape rather than a
   * compatibility one.
   */
  private assertQuoteMatchesRequest(
    quote: GenericQuoteResponse,
    expectedPubkey: string | undefined,
    expectedUnit: string
  ): void {
    if (
      expectedPubkey !== undefined &&
      quote.pubkey !== undefined &&
      quote.pubkey !== expectedPubkey
    ) {
      throw new MintQuoteValidationError(
        `${this.label(quote.quote)} returned pubkey ${quote.pubkey} instead of requested pubkey ${expectedPubkey}`
      );
    }
    if (quote.unit?.toLowerCase() !== expectedUnit.toLowerCase()) {
      throw new MintQuoteValidationError(
        `${this.label(quote.quote)} returned unit ${quote.unit} instead of requested unit ${expectedUnit}`
      );
    }
  }

  async createQuote(ctx: CreateQuoteCtx) {
    const quoteKey = await this.keyRingService.generateMintQuoteKeyPair();
    const unit = ctx.createQuoteData.unit;
    const amount = toAmountValue(ctx.createQuoteData.amount);

    // The amount is sent when the caller has one. NUT-04 marks it optional at
    // the base-request level and lets each method decide; in practice a custom
    // method usually needs it (sortug's venmo/paypal reject an amountless
    // quote with a misleading `50000 Invalid payment method`), while a
    // reusable one may not. Forwarding whatever the caller supplied keeps this
    // handler out of that judgement.
    const payload: Record<string, unknown> = {
      unit,
      pubkey: quoteKey.publicKeyHex,
      ...(amount !== undefined ? { amount } : {}),
    };

    cashuLog.info('cashu.generic_mint.quote.create', {
      ...mintUrlLogFields(ctx.mintUrl),
      method: this.method,
      unit,
      hasAmount: amount !== undefined,
    });

    const remoteQuote = (await ctx.wallet.createMintQuote(
      this.method,
      payload
    )) as unknown as GenericQuoteResponse;

    this.assertQuoteMatchesRequest(remoteQuote, quoteKey.publicKeyHex, unit);
    cashuLog.info('cashu.generic_mint.quote.created', {
      ...mintUrlLogFields(ctx.mintUrl),
      method: this.method,
      quoteId: remoteQuote.quote,
      locked: remoteQuote.pubkey !== undefined,
      requestLength: remoteQuote.request?.length ?? 0,
    });
    return this.toCanonicalQuote(ctx.mintUrl, remoteQuote);
  }

  async fetchRemoteQuote(ctx: FetchRemoteCtx) {
    const remoteQuote = await ctx.mintAdapter.checkMintQuote(
      ctx.quote.mintUrl,
      this.method,
      ctx.quote.quoteId
    );
    this.assertQuoteMatchesRequest(remoteQuote, ctx.quote.quoteData.pubkey, ctx.quote.unit);
    return this.toCanonicalQuote(ctx.quote.mintUrl, remoteQuote);
  }

  async validateQuoteForPrepare(quote: { quoteData: { pubkey?: string } }): Promise<void> {
    // Only a LOCKED quote needs its key present; an unlocked one has none.
    if (quote.quoteData.pubkey) await this.requireQuoteKey(quote.quoteData.pubkey);
  }

  async prepare(ctx: PrepareCtx) {
    const quote = ctx.importedQuote;
    if (!quote) {
      throw new Error(`Mint quote ${ctx.operation.quoteId ?? '(missing)'} was not provided`);
    }
    if (ctx.operation.quoteId !== quote.quote) {
      throw new MintQuoteValidationError(
        `Mint quote ${quote.quote} does not match operation quote ${ctx.operation.quoteId}`
      );
    }
    this.assertQuoteMatchesRequest(quote, quote.pubkey, ctx.operation.unit);
    if (quote.pubkey) await this.requireQuoteKey(quote.pubkey);

    const outputData = await ctx.proofService.createOutputsAndIncrementCounters(
      ctx.operation.mintUrl,
      {
        keep: { amount: ctx.operation.amount, unit: ctx.operation.unit },
        send: { amount: Amount.zero(), unit: ctx.operation.unit },
      },
      {}
    );
    if (outputData.keep.length === 0) {
      throw new Error(`Failed to create deterministic outputs for ${this.method} mint operation`);
    }

    return {
      ...ctx.operation,
      quoteId: quote.quote,
      request: quote.request,
      expiry: quote.expiry,
      pubkey: quote.pubkey,
      outputData: serializeOutputData({ keep: outputData.keep as never, send: [] }),
      state: 'pending',
    };
  }

  async execute(ctx: ExecuteCtx) {
    const { operation } = ctx;
    const privkey = await this.resolvePrivkey(operation.pubkey);
    const outputData = deserializeOutputData(operation.outputData as never);
    const remoteQuote = await ctx.mintAdapter.checkMintQuote(
      operation.mintUrl,
      this.method,
      operation.quoteId
    );
    this.assertQuoteMatchesRequest(remoteQuote, operation.pubkey, operation.unit);

    const assessment = assessMintQuoteClaimability(
      this.toCanonicalQuote(operation.mintUrl, remoteQuote) as never,
      { requestedAmount: operation.amount }
    );
    if (assessment.status === 'invalid') {
      throw new MintQuoteValidationError(
        `${this.label(operation.quoteId)} is not claimable: ${assessment.status}`
      );
    }

    try {
      const proofs = await this.mintProofs(ctx.wallet, operation, remoteQuote, privkey, outputData);
      cashuLog.info('cashu.generic_mint.execute.issued', {
        ...mintUrlLogFields(operation.mintUrl),
        method: this.method,
        quoteId: operation.quoteId,
        proofs: proofs.length,
      });
      return { status: 'ISSUED' as const, proofs };
    } catch (error) {
      if (isAlreadyIssuedError(error)) return { status: 'ALREADY_ISSUED' as const };
      throw error;
    }
  }

  async recoverExecuting(ctx: RecoverCtx) {
    const { operation } = ctx;
    const restored = await this.recoverSignedOutputs(ctx);
    if (restored) return restored;

    let remoteQuote: GenericQuoteResponse;
    try {
      remoteQuote = await ctx.mintAdapter.checkMintQuote(
        operation.mintUrl,
        this.method,
        operation.quoteId
      );
    } catch (error) {
      ctx.logger?.warn(`Failed to check ${this.method} mint quote during recovery`, {
        mintUrl: operation.mintUrl,
        quoteId: operation.quoteId,
        operationId: operation.id,
        error: errorMessage(error),
      });
      return { status: 'PENDING' as const, error: errorMessage(error) };
    }

    try {
      this.assertQuoteMatchesRequest(remoteQuote, operation.pubkey, operation.unit);
    } catch (error) {
      return { status: 'TERMINAL' as const, error: errorMessage(error) };
    }

    let privkey: string | undefined;
    try {
      privkey = await this.resolvePrivkey(operation.pubkey);
    } catch (error) {
      return { status: 'TERMINAL' as const, error: errorMessage(error) };
    }

    const assessment = assessMintQuoteClaimability(
      this.toCanonicalQuote(operation.mintUrl, remoteQuote) as never,
      { ...ctx.localClaimabilityFacts, requestedAmount: operation.amount }
    );
    if (assessment.status === 'invalid') {
      return {
        status: 'TERMINAL' as const,
        error: `Recovered: ${this.label(operation.quoteId)} has invalid claimability accounting`,
      };
    }
    if (assessment.status !== 'claimable') {
      return {
        status: 'PENDING' as const,
        error: `Recovered: ${this.label(operation.quoteId)} has ${assessment.remoteAvailable} remotely available, requested ${operation.amount}`,
      };
    }

    const outputData = deserializeOutputData(operation.outputData as never);
    try {
      const proofs = await this.mintProofs(ctx.wallet, operation, remoteQuote, privkey, outputData);
      await ctx.proofService.saveProofs(
        operation.mintUrl,
        mapProofToCoreProof(operation.mintUrl, 'ready', proofs, {
          unit: operation.unit,
          createdByOperationId: operation.id,
        }) as never
      );
      return { status: 'FINALIZED' as const };
    } catch (error) {
      if (isAlreadyIssuedError(error)) {
        return (
          (await this.recoverSignedOutputs(ctx)) ?? {
            status: 'PENDING' as const,
            error: `Recovered: ${this.label(operation.quoteId)} was already issued but proofs were not recoverable`,
          }
        );
      }
      // 20007 = quote expired. Terminal: the window to claim has closed.
      if (error instanceof MintOperationError && error.code === 20007) {
        return {
          status: 'TERMINAL' as const,
          error: `Recovered: ${this.label(operation.quoteId)} expired while executing mint`,
        };
      }
      return { status: 'PENDING' as const, error: errorMessage(error) };
    }
  }

  async checkPending(ctx: PendingCtx) {
    const { operation } = ctx;
    const observedAt = Date.now();
    const remoteQuote = await ctx.mintAdapter.checkMintQuote(
      operation.mintUrl,
      this.method,
      operation.quoteId
    );

    // Reuses coco's own attributability check (quote id, request, unit and
    // pubkey must still match the pending operation). Its message wording is
    // written for the built-in reusable methods; the check itself is generic.
    const validationError = getReusableMintQuoteValidationError(
      remoteQuote as never,
      operation as never
    );
    if (validationError) {
      return {
        observedAt,
        validationFailure: {
          reason: validationError.message,
          code: 'invalid_quote' as const,
          retryable: false,
          observedAt,
        },
      };
    }
    return { observedAt, quoteSnapshot: remoteQuote };
  }

  // ── internals ────────────────────────────────────────────────────

  /**
   * Mints through cashu-ts's method-generic entry point, passing the NUT-20
   * key only when the quote is locked.
   */
  private async mintProofs(
    wallet: Wallet,
    operation: GenericMintOperation,
    remoteQuote: GenericQuoteResponse,
    privkey: string | undefined,
    outputData: { keep: unknown[] }
  ): Promise<Proof[]> {
    return wallet.mintProofs(
      this.method,
      operation.amount,
      remoteQuote as never,
      privkey ? { privkey } : undefined,
      { type: 'custom', data: outputData.keep as never }
    );
  }

  /** Hex NUT-20 secret for a locked quote; `undefined` for an unlocked one. */
  private async resolvePrivkey(pubkey: string | undefined): Promise<string | undefined> {
    if (!pubkey) return undefined;
    const quoteKey = await this.keyRingService.getMintQuoteKeyPair(pubkey);
    if (!quoteKey) {
      throw new MintQuoteKeyError(`Missing NUT-20 mint quote key for pubkey ${pubkey}`);
    }
    return bytesToHex(quoteKey.secretKey);
  }

  private async requireQuoteKey(pubkey: string): Promise<void> {
    if (!(await this.keyRingService.getMintQuoteKeyPair(pubkey))) {
      throw new MintQuoteKeyError(`Missing NUT-20 mint quote key for pubkey ${pubkey}`);
    }
  }

  private async recoverSignedOutputs(ctx: RecoverCtx) {
    try {
      const recovered = await ctx.proofService.recoverProofsFromOutputData(
        ctx.operation.mintUrl,
        ctx.operation.outputData,
        { unit: ctx.operation.unit, createdByOperationId: ctx.operation.id }
      );
      return recovered.length > 0 ? { status: 'FINALIZED' as const } : null;
    } catch (error) {
      ctx.logger?.warn(`Failed to recover ${this.method} mint outputs from output data`, {
        mintUrl: ctx.operation.mintUrl,
        quoteId: ctx.operation.quoteId,
        operationId: ctx.operation.id,
        error: errorMessage(error),
      });
      return { status: 'PENDING' as const, error: errorMessage(error) };
    }
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * coco builds its handlers inside `Manager.buildCoreServices` and keeps the
 * `KeyRingService` private, so a handler added afterwards has to borrow the
 * same instance the built-ins use — otherwise its NUT-20 quote keys would land
 * in a different keyring and every locked quote would fail to claim.
 * `MintBolt12Handler` is guaranteed to be registered, and every built-in
 * handler stores the service on the same field.
 */
function borrowKeyRingService(provider: {
  getAll(): Record<string, unknown>;
}): KeyRingServiceLike | null {
  const bolt12 = provider.getAll().bolt12 as { keyRingService?: unknown } | undefined;
  const service = bolt12?.keyRingService as KeyRingServiceLike | undefined;
  return service && typeof service.generateMintQuoteKeyPair === 'function' ? service : null;
}

/**
 * Registers a generic handler for every method the wallet has discovered and
 * coco does not already serve.
 *
 * Idempotent and additive: a method that already has a handler (built-in or
 * previously registered) is left alone, so this is safe to call again whenever
 * the set of trusted mints changes. Returns the methods newly registered.
 */
export function registerGenericMintMethods(manager: Manager, methods: string[]): string[] {
  const provider = (manager as unknown as PatchedManager).mintHandlerProvider;
  if (!provider) {
    // The patch is registered in root `package.json` `patchedDependencies`, so
    // this only happens on an unpatched install (a fresh `node_modules` where
    // the patch failed to apply). Loud, because the symptom downstream is an
    // opaque "No mint handler registered" at quote creation.
    cashuLog.error('cashu.generic_mint.register.unpatched_coco', {
      methodCount: methods.length,
    });
    return [];
  }

  const keyRingService = borrowKeyRingService(provider);
  if (!keyRingService) {
    cashuLog.error('cashu.generic_mint.register.no_keyring', {
      methodCount: methods.length,
    });
    return [];
  }

  const registered: string[] = [];
  const existing = provider.getAll();
  for (const method of methods) {
    if (existing[method] !== undefined) continue;
    provider.register(method, new GenericMintHandler(method, keyRingService));
    registered.push(method);
  }
  if (registered.length > 0) {
    cashuLog.info('cashu.generic_mint.register.done', {
      methods: registered.join(','),
    });
  }
  return registered;
}

/** Methods coco or this module can currently mint with. Test/diagnostic read. */
export function getRegisteredMintMethods(manager: Manager): string[] {
  const provider = (manager as unknown as PatchedManager).mintHandlerProvider;
  return provider ? Object.keys(provider.getAll()) : [];
}

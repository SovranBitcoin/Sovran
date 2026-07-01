import type {
  AnnotatedOption,
  MintCandidate,
  MintListItem,
  ParsedPaymentInput,
  PaymentOption,
  ResolvedIntent,
  WalletContext,
  AmountEntryConstraints,
  Detectors,
  MintMethodRequirement,
} from '../types';
// ---------------------------------------------------------------------------
// Flow Steps — every state the machine can be in
// ---------------------------------------------------------------------------

export type FlowStep =
  | 'idle'
  | 'selectDestination'
  | 'chooseOption'
  | 'chooseFallbackOption'
  | 'enterAmount'
  | 'selectMint'
  | 'chooseProofs'
  | 'enterSendMemo'
  | 'receiveToken'
  | 'confirmSend'
  | 'sendComplete'
  | 'navigateToMeltPreview'
  | 'navigateToPaymentRequest'
  | 'createMintQuote'
  | 'mintQuoteCreated'
  | 'openMint'
  | 'openProfile'
  | 'navigateToReceive'
  | 'reviewMint'
  | 'dismiss'
  | 'error';

export type Destination = AmountEntryConstraints['destination'];
export type PaymentQuoteMethod = 'bolt11' | 'onchain';
export type MintQuoteMethod = PaymentQuoteMethod;
export type MeltQuoteMethod = PaymentQuoteMethod;

export type ReceiveExecutePendingReason = 'network';

export type ReceiveExecuteFinalizedResult = {
  status?: 'finalized';
  historyEntry: string;
  hadP2PKProofs?: boolean;
};

export type ReceiveExecutePendingResult = {
  status: 'pending';
  operationId: string;
  historyEntry: string;
  pendingReason: ReceiveExecutePendingReason;
  message?: string;
  hadP2PKProofs?: boolean;
};

export type ReceiveExecuteResult = ReceiveExecuteFinalizedResult | ReceiveExecutePendingResult;

// ---------------------------------------------------------------------------
// Recipient identity — populated by `operations.resolveRecipientPubkey`
// (Lightning Address → Nostr hex pubkey via NIP-05) and
// `operations.resolveRecipientProfile` (pubkey → Nostr kind-0 metadata).
// Both run as fire-and-forget side effects from `send()` so they never
// block the flow; consumer UIs read whichever fields have landed.
// ---------------------------------------------------------------------------

export interface RecipientProfile {
  displayName: string;
  avatarUrl: string | null;
  nip05: string | null;
}

export interface AmountEntryDisplayMetadata {
  inputMode: 'sat' | 'fiat';
  rawInput: string;
  fiatCurrency: string | null;
  fiatSymbol: string | null;
  btcPrice: number;
  displayFiat: number | null;
  displaySats: number;
  autoOptimized: boolean;
}

// ---------------------------------------------------------------------------
// Step Data — typed payload delivered to each handler
// ---------------------------------------------------------------------------

export interface StepDataMap {
  idle: Record<string, never>;
  /**
   * Destination-first send entry. The wallet renders the method chooser
   * (QR / Create Ecash / NFC / Nut Drop) plus a destination input + contact
   * search; the chosen method drives the rest of the flow.
   */
  selectDestination: { unit: string };
  chooseOption: {
    parsed: ParsedPaymentInput;
    options: AnnotatedOption[];
    unit: string;
  };
  chooseFallbackOption: {
    parsed: ParsedPaymentInput;
    options: AnnotatedOption[];
    unit: string;
    failedOptionValues: string[];
    lastFailedMessage?: string;
  };
  enterAmount: {
    unit: string;
    preselectedMintUrl?: string;
    constraints: {
      destination: Destination;
      supportedMintUrls?: string[];
      paymentRequest?: string;
      meltTarget?: string;
      recipientPubkey?: string;
      recipientProfile?: RecipientProfile;
      methodContext?: AmountEntryConstraints['methodContext'];
    };
  };
  selectMint: {
    candidates: MintCandidate[];
    supportedMintUrls?: string[];
    amount?: number;
    unit: string;
    paymentRequest?: string;
    meltTarget?: string;
    recipientPubkey?: string;
    recipientProfile?: RecipientProfile;
    destination?: Destination;
    mintListItemsStatus?: 'loading' | 'ready' | 'failed';
    /** Pre-computed mint list items (populated when machine operations are provided). */
    mintListItems?: MintListItem[];
    /** When 'npc', selection updates NPC mint only (not selectedMint). */
    scope?: 'npc' | 'selected';
    mintQuoteMethod?: MintQuoteMethod;
    meltQuoteMethod?: MeltQuoteMethod;
    methodRequirement?: MintMethodRequirement;
  };
  chooseProofs: {
    mintUrl: string;
    amount: number;
    paymentRequest?: string;
    meltTarget?: string;
    recipientPubkey?: string;
    recipientProfile?: RecipientProfile;
    unit: string;
    proofAmounts: number[];
    displayMetadata?: AmountEntryDisplayMetadata;
    suggestions?: {
      roundDown: { amount: number } | null;
      roundUp: { amount: number } | null;
    };
  };
  enterSendMemo: {
    mintUrl: string;
    amount: number;
    unit: string;
    memo?: string;
  };
  receiveToken: { token: string };
  confirmSend: { mintUrl: string; amount: number; memo?: string };
  sendComplete: {
    historyEntry: string;
    /** True when the token was created from local proofs without contacting the mint first. */
    createdOffline?: boolean;
    mintWasOffline?: boolean;
    recipientPubkey?: string;
    recipientProfile?: RecipientProfile;
    /** See `FlowContext.p2pkLockPubkey` — present when the sent token is P2PK-locked. */
    p2pkLockPubkey?: string;
  };
  navigateToMeltPreview: {
    mintUrl: string;
    meltTarget: string;
    unit: string;
    amount: number;
    recipientPubkey?: string;
    recipientProfile?: RecipientProfile;
    /** Populated after a successful melt so the screen can link to the new transaction. */
    historyEntry?: string;
  };
  navigateToPaymentRequest: {
    mintUrl: string;
    paymentRequest: string;
    amount: number;
    unit: string;
    recipientPubkey?: string;
    recipientProfile?: RecipientProfile;
    /** Populated after a successful payment request send. */
    historyEntry?: string;
  };
  createMintQuote: { mintUrl: string; amount: number; unit: string; method?: MintQuoteMethod };
  mintQuoteCreated: { historyEntry: string; unit: string };
  openMint: {
    url: string;
    /** Pre-loaded mint info (populated when `operations.buildMintReviewInfo` is provided). */
    mintInfo?: import('../types').MintReviewInfo;
  };
  openProfile: { npub: string };
  navigateToReceive: { unit: string; methodContext?: AmountEntryConstraints['methodContext'] };
  reviewMint: {
    mintUrl: string;
    token: string;
    /** Pre-loaded mint info (populated when `operations.buildMintReviewInfo` is provided). */
    mintInfo?: import('../types').MintReviewInfo;
  };
  dismiss: Record<string, never>;
  error: { code: ErrorCode; message: string; data?: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'NO_AMOUNT'
  | 'NO_VALID_MINT'
  | 'INSUFFICIENT_BALANCE'
  | 'NO_BALANCE'
  | 'UNSUPPORTED_INPUT'
  | 'UNSUPPORTED_PAYMENT_METHOD'
  | 'ALL_OPTIONS_DISABLED'
  | 'MISSING_MELT_TARGET'
  | 'INVALID_P2PK_LOCK'
  | 'SEND_FAILED'
  | 'MINT_QUOTE_FAILED'
  | 'MELT_FAILED'
  | 'PAYMENT_REQUEST_FAILED'
  | 'NFC_WRITE_FAILED'
  | 'NFC_SESSION_LOST'
  | 'NFC_READ_FAILED';

// ---------------------------------------------------------------------------
// Flow Context — accumulated data through the flow
// ---------------------------------------------------------------------------

export interface FlowContext {
  parsed?: ParsedPaymentInput;
  intent?: ResolvedIntent;
  amount?: number;
  mintUrl?: string;
  destination?: Destination;
  mintQuoteMethod?: MintQuoteMethod;
  meltQuoteMethod?: MeltQuoteMethod;
  unit: string;
  paymentRequest?: string;
  meltTarget?: string;
  /**
   * Nostr pubkey (hex) of the recipient when this flow was launched from a
   * chat surface. Set on AMOUNT_ENTERED (or on the initial `enterAmount`
   * constraints) and propagated to terminal navigation step data so consumer
   * UIs can render recipient identity on payment-confirmation screens.
   *
   * Also populated automatically from `ctx.meltTarget` via
   * `operations.resolveRecipientPubkey` (NIP-05) when present.
   */
  recipientPubkey?: string;
  /**
   * Nostr kind-0 profile metadata for `recipientPubkey`. Populated by
   * `operations.resolveRecipientProfile` once a pubkey is known. Used by
   * consumer UIs to render "Pay <name>" + avatar on the amount-entry and
   * melt-preview headers without each screen re-running the fetch.
   */
  recipientProfile?: RecipientProfile;
  /**
   * Cashu P2PK lock target (33-byte compressed secp256k1 hex, `02`-prefixed)
   * for ecash sends. When set, the send MUST produce P2PK-locked outputs:
   * local-first and offline token creation are disabled because locking
   * requires a mint swap — a locked send must never silently degrade to a
   * bearer token.
   */
  p2pkLockPubkey?: string;
  amountEntryDisplay?: AmountEntryDisplayMetadata;
  /**
   * True after the user accepts a locally composable proof suggestion. The
   * selected amount is already exact locally, so confirmSend should not retry
   * an online send before creating the offline token.
   */
  localProofSend?: boolean;
  /**
   * Optional Cashu token memo. The cashu-ts Token type names this field
   * `memo`; it is encoded into the token metadata when present.
   */
  memo?: string;
  /**
   * True once the optional send memo prompt has been answered or skipped.
   * Needed because a skipped memo leaves `memo` undefined but must not prompt
   * again before token creation.
   */
  sendMemoHandled?: boolean;
  /**
   * True when an online app path reached the mint and got a mint-unreachable
   * failure. This is distinct from the whole wallet being offline.
   */
  mintUnreachableConfirmed?: boolean;
  supportedMintUrls?: string[];
  /**
   * When true, use local proof routing for ecash sends instead of relying on
   * an online swap. Exact local composition can still go straight to token
   * creation; non-exact composition asks the user to choose a nearby amount.
   *
   * Only affects `sendEcash` — melt (lightning) and payment request flows always
   * attempt the operation regardless of offline status because the mint handles
   * the swap server-side.
   */
  offline?: boolean;
  /** Token held during mint trust review. Set on REVIEW_MINT, consumed on MINT_TRUSTED. */
  reviewToken?: string;
  /** Original raw input string from scan/execute. Available after EXECUTE. */
  rawInput?: string;
  /** Scan source hint. Persisted for the flow's lifetime (cleared on RESET). */
  source?: string;
  /** Original annotated options from BIP321 multi-option flow. Captured on first OPTION_CHOSEN. */
  originalOptions?: AnnotatedOption[];
  /** Option values that have been tried and failed. */
  failedOptionValues?: string[];
}

// ---------------------------------------------------------------------------
// Machine Snapshot — full state at a point in time
// ---------------------------------------------------------------------------

export interface MachineSnapshot<S extends FlowStep = FlowStep> {
  step: S;
  context: FlowContext;
  data: S extends keyof StepDataMap ? StepDataMap[S] : never;
}

// ---------------------------------------------------------------------------
// Execution State — derived from snapshot for UI consumption
// ---------------------------------------------------------------------------

export type ExecutionState =
  | {
      status: 'ready';
      code: 'READY';
      message: null;
      isExecutable: true;
      isExecuting: boolean;
      step: FlowStep;
      details?: Record<string, unknown>;
    }
  | {
      status: 'needsInput';
      code:
        | 'NO_AMOUNT'
        | 'MINT_SELECTION_REQUIRED'
        | 'OPTION_SELECTION_REQUIRED'
        | 'FALLBACK_OPTION_REQUIRED'
        | 'PROOF_SELECTION_REQUIRED'
        | 'SEND_MEMO_REQUIRED';
      message: string;
      isExecutable: false;
      isExecuting: boolean;
      step: FlowStep;
      details?: Record<string, unknown>;
    }
  | {
      status: 'blocked';
      code:
        | 'UNSUPPORTED_INPUT'
        | 'NO_VALID_MINT'
        | 'INSUFFICIENT_BALANCE'
        | 'NO_BALANCE'
        | 'ALL_OPTIONS_DISABLED'
        | 'UNSUPPORTED_PAYMENT_METHOD'
        | 'SEND_FAILED'
        | 'MINT_QUOTE_FAILED'
        | 'MELT_FAILED'
        | 'PAYMENT_REQUEST_FAILED'
        | 'NFC_WRITE_FAILED'
        | 'NFC_SESSION_LOST'
        | 'NFC_READ_FAILED';
      message: string;
      isExecutable: false;
      isExecuting: boolean;
      step: FlowStep;
      details?: Record<string, unknown>;
    };

// ---------------------------------------------------------------------------
// Flow Events — user actions that drive the machine
// ---------------------------------------------------------------------------

export type FlowEvent =
  | {
      type: 'EXECUTE';
      input: string;
    }
  | { type: 'OPTION_CHOSEN'; option: PaymentOption }
  | {
      type: 'AMOUNT_ENTERED';
      amount: number;
      mintUrl: string;
      destination?: Destination;
      mintQuoteMethod?: MintQuoteMethod;
      meltQuoteMethod?: MeltQuoteMethod;
      offline?: boolean;
      /**
       * Lightning target (lud16 / bolt11 / LNURL-pay) to seed `ctx.meltTarget`
       * when the amount entry step is switching into a melt flow. Used by the
       * Next variants menu: the ecash entry entry carries meltTarget alongside,
       * and picking "as Lightning" fires AMOUNT_ENTERED with destination=meltQuote
       * + meltTarget so the machine can route to navigateToMeltPreview.
       */
      meltTarget?: string;
      /** See `FlowContext.recipientPubkey` — chat-launched flows seed this. */
      recipientPubkey?: string;
      /** See `FlowContext.recipientProfile` — chat-launched flows can seed this. */
      recipientProfile?: RecipientProfile;
      amountEntryDisplay?: AmountEntryDisplayMetadata;
    }
  | {
      type: 'MINT_SELECTED';
      mintUrl: string;
      amount?: number;
      destination?: Destination;
      /** When true, the wallet should persist this mint as the user's preferred mint. */
      persist?: boolean;
      /** When 'npc', update NPC mint only (not selectedMint). */
      scope?: 'npc' | 'selected';
    }
  | { type: 'PROOFS_CHOSEN'; amount: number }
  | { type: 'SEND_MEMO_SUBMITTED'; memo?: string }
  | { type: 'REQUEST_MINT_SELECTOR'; scope?: 'npc' | 'selected' }
  | {
      type: 'START_SEND_ECASH';
      /**
       * Optional Lightning target to carry into amount entry. Chat surfaces
       * can start with the same ecash-send mint guard while still enabling
       * the Lightning variant from the amount screen.
       */
      meltTarget?: string;
      /** See `FlowContext.recipientPubkey` — chat-launched flows seed this. */
      recipientPubkey?: string;
      /** See `FlowContext.recipientProfile` — chat-launched flows can seed this. */
      recipientProfile?: RecipientProfile;
      /** See `FlowContext.p2pkLockPubkey` — nearby-pay flows seed this. */
      p2pkLockPubkey?: string;
      /** Constrain the source mint to a set the recipient accepts (NUT-18 creq). */
      allowedMints?: string[];
    }
  | {
      /**
       * Open the destination-first Send method chooser (`selectDestination`
       * step). No amount/mint is chosen yet — the method the user picks drives
       * the rest of the flow via the existing entries.
       */
      type: 'START_SEND';
    }
  | { type: 'START_RECEIVE_LIGHTNING' }
  | { type: 'START_RECEIVE' }
  | { type: 'REVIEW_MINT'; mintUrl: string; token: string }
  | { type: 'MINT_TRUSTED' }
  | { type: 'CONFIRM_MELT' }
  | { type: 'CONFIRM_PAYMENT_REQUEST' }
  | { type: 'RESET' };

// ---------------------------------------------------------------------------
// Step Handler Map — wallet provides one handler per step
// ---------------------------------------------------------------------------

type MaybeAsync = void | Promise<void>;

export type StepHandlerMap = {
  [K in FlowStep as K extends 'idle' ? never : K]?: (data: StepDataMap[K]) => MaybeAsync;
};

// ---------------------------------------------------------------------------
// Notification Handler Map — wallet provides handlers for informational popups
// ---------------------------------------------------------------------------

/**
 * Notification handlers for informational UI feedback (errors, warnings,
 * success messages). Unlike step handlers which drive navigation/flow,
 * notifications are fire-and-forget — the machine dispatches them but
 * does not wait for or depend on the result.
 *
 * The wallet decides how to present each notification (native alert,
 * custom toast, etc.). If no handler is registered for a key, the
 * notification is silently ignored.
 */
export type NotificationHandlerMap = {
  [K in ErrorCode]?: (data: StepDataMap['error']) => MaybeAsync;
} & {
  /** Called when a scan source returns empty (clipboard empty, no QR in image). */
  onScanEmpty?: (source: string) => MaybeAsync;
  /** Called when a scan source throws or returns { error }. */
  onScanError?: (source: string, err: Error) => MaybeAsync;
  /**
   * Called when AMOUNT_ENTERED fires with a positive amount but no mint URL.
   * Wallet should prompt to select a mint; machine stays on enterAmount.
   */
  onMissingMintForAmount?: () => MaybeAsync;
  /**
   * Called when a built-in copy action succeeds. The wallet decides how to
   * present the feedback (toast, haptic, etc.).
   *
   * `target` identifies what was copied: `'token'`, `'paymentRequest'`,
   * `'lightningInvoice'`, `'address'`, `'p2pk'`, `'mintUrl'`.
   */
  onCopied?: (target: string, text: string) => MaybeAsync;
  /**
   * Called when a built-in share action completes. The wallet decides how
   * to present feedback (toast, haptic, etc.).
   *
   * `target` identifies what was shared: `'token'`, `'paymentRequest'`,
   * `'lightningInvoice'`, `'address'`, `'p2pk'`, `'mintUrl'`.
   */
  onShared?: (target: string, text: string) => MaybeAsync;
  /**
   * Called after a scan/execute input is parsed and an intent is resolved.
   * Fires once per EXECUTE event — the wallet uses this to record scan
   * provenance in its history store.
   *
   * `rawInput` is the full original string the machine received.
   * `parsedType` is the structural type detected by the parser (e.g.
   * `'bip321'`, `'payment'`, `'mintUrl'`).
   * `intentType` is the resolved action (e.g. `'receiveToken'`,
   * `'meltLightningInvoice'`).
   * `source` is the scan source hint (e.g. `'qr'`, `'clipboard'`,
   * `'deeplink'`) when available.
   */
  onScanResolved?: (data: {
    rawInput: string;
    parsedType: string;
    intentType: string;
    source?: string;
    /** Container format — `'bip321'` when the input was a bitcoin: URI. */
    container?: string;
    /** Payment option kinds available in the input (e.g. `['lightningInvoice', 'paymentRequest']`). */
    optionKinds?: string[];
  }) => MaybeAsync;
  /**
   * Called when a multi-step operation starts (melt, payment request).
   * The wallet shows a processing indicator (toast/sheet).
   */
  onPaymentProcessing?: (data: {
    variant: 'melt' | 'paymentRequest' | 'send';
    mintUrl: string;
    amount: number;
    unit: string;
  }) => MaybeAsync;
  /**
   * Called when a multi-step operation completes successfully.
   * The wallet updates the processing indicator to show success.
   */
  onPaymentConfirmed?: (data: {
    variant: 'melt' | 'paymentRequest' | 'send';
    mintUrl: string;
    amount: number;
    unit: string;
    historyEntry: string;
  }) => MaybeAsync;
  /**
   * Called when a multi-step operation fails and no fallback options exist.
   * When BIP321 fallback IS available, the machine transitions to
   * `chooseFallbackOption` instead of firing this notification.
   */
  onPaymentFailed?: (data: {
    variant: 'melt' | 'paymentRequest' | 'send';
    mintUrl: string;
    amount: number;
    unit: string;
    message: string;
    rolledBack?: boolean;
  }) => MaybeAsync;
  /**
   * Called during NFC POS payment to report progress phases.
   * The wallet shows a "hold device steady" overlay with phase updates.
   */
  onNfcPaymentProgress?: (data: {
    phase: 'reading' | 'selecting' | 'creating' | 'writing';
  }) => MaybeAsync;
  /**
   * Called when NFC write-back fails after token creation.
   * The wallet shows an error popup. If `rolledBack` is true, proofs
   * were successfully reclaimed.
   */
  onNfcWriteFailed?: (data: { message: string; rolledBack: boolean }) => MaybeAsync;

  // ── Screen action notifications ─────────────────────────────────────
  // Fired by the built-in default screen action handlers. The wallet
  // maps these to its own popup/toast/status-indicator system.

  /**
   * Called after checking a pending send token's status.
   * `redeemed` is true when the recipient has claimed the token.
   */
  onSendStatusChecked?: (data: {
    operationId: string;
    state: string;
    redeemed: boolean;
  }) => MaybeAsync;

  /** Called when a send token cancellation (rollback) succeeds. */
  onSendCancelled?: (data: { operationId: string }) => MaybeAsync;

  /** Called when a send token cancellation fails. */
  onSendCancelFailed?: (data: {
    operationId: string;
    message: string;
    mintUnreachable?: boolean;
    offline?: boolean;
  }) => MaybeAsync;

  /**
   * Called when an ecash receive starts processing.
   * The wallet shows a processing indicator.
   */
  onReceiveProcessing?: (data: {
    id: string;
    mintUrl: string;
    amount: number;
    unit: string;
  }) => MaybeAsync;

  /**
   * Called when an ecash receive was accepted locally but is waiting for
   * recoverable mint/network completion. The wallet keeps the receive UI in a
   * pending state and lets wallet-core recovery finalize it later.
   */
  onReceivePending?: (data: {
    id: string;
    mintUrl: string;
    amount: number;
    unit: string;
    operationId: string;
    pendingReason: ReceiveExecutePendingReason;
    historyEntry: string;
    message?: string;
  }) => MaybeAsync;

  /**
   * Called when an ecash receive completes successfully.
   * The wallet updates the processing indicator and may capture metadata
   * (location, scan history linking, etc.).
   */
  onReceiveConfirmed?: (data: {
    id: string;
    mintUrl: string;
    amount: number;
    unit: string;
    historyEntry: string;
  }) => MaybeAsync;

  /**
   * Called when an ecash receive fails.
   * The wallet shows an error indicator or popup.
   */
  onReceiveFailed?: (data: {
    id: string;
    mintUrl: string;
    amount: number;
    unit: string;
    message: string;
  }) => MaybeAsync;

  /** Called when a melt operation is cancelled (rolled back) successfully. */
  onMeltCancelled?: (data: { operationId: string }) => MaybeAsync;

  /** Called when a melt cancellation fails. */
  onMeltCancelFailed?: (data: {
    operationId: string;
    message: string;
    mintUnreachable?: boolean;
  }) => MaybeAsync;

  /** Called when a received token has an unsupported unit (not 'sat'). */
  onUnsupportedTokenUnit?: (data: { unit: string }) => MaybeAsync;

  /**
   * Called when a mint is trusted from the mintInfo screen action.
   * The wallet navigates back (or dismisses the modal).
   * `fromAccepter` is true when the trust was triggered from the
   * accept-mint modal rather than the info screen.
   */
  onMintTrustedFromScreen?: (data: { mintUrl: string; fromAccepter: boolean }) => MaybeAsync;

  // ── State change notifications ────────────────────────────────────
  // Broader lifecycle notifications for state updates (zustand stores,
  // analytics, location capture, etc.) — not just UI feedback.

  /**
   * Called when the user's preferred mint changes. Replaces the
   * `savePreferredMint` callback prop — wallets persist via this
   * notification instead.
   */
  onPreferredMintChanged?: (data: { mintUrl: string }) => MaybeAsync;

  /**
   * Called when the NPC (Nostr Private Custody) mint changes. Replaces
   * the `saveNpcMint` callback prop.
   */
  onNpcMintChanged?: (data: { mintUrl: string }) => MaybeAsync;

  /**
   * Called after any transaction is created (send, receive, melt,
   * mint-quote). Wallets use this for scan history linking, location
   * capture, analytics, etc.
   */
  onTransactionCreated?: (data: {
    transactionId: string;
    type: 'send' | 'receive' | 'melt' | 'mint';
    mintUrl: string;
    amount: number;
    unit: string;
    rawInput?: string;
    source?: string;
  }) => MaybeAsync;

  /**
   * Called after a P2PK-locked ecash receive completes. Wallets use
   * this to decide whether to regenerate the P2PK key pair.
   */
  onP2PKReceiveCompleted?: (data: {
    transactionId: string;
    mintUrl: string;
    hadP2PKProofs: boolean;
  }) => MaybeAsync;

  /**
   * Called when a melt operation creates a quote and begins execution.
   * Wallets use this for lifecycle tracking.
   */
  onMeltQuoteCreated?: (data: {
    mintUrl: string;
    operationId: string;
    amount: number;
    unit: string;
    meltTarget: string;
  }) => MaybeAsync;
};

// ---------------------------------------------------------------------------
// Machine operations — async side effects the machine runs internally
// ---------------------------------------------------------------------------

/**
 * Async callbacks the machine executes for action steps (confirmSend,
 * createMintQuote, selectMint). When provided, the machine handles
 * success/failure routing and only dispatches external handlers for the
 * resulting navigation/UI step.
 */
export interface MachineOperations {
  executeSend: (
    mintUrl: string,
    amount: number,
    memo?: string,
    options?: {
      /** See `FlowContext.p2pkLockPubkey` — lock outputs to this pubkey via a mint swap. */
      p2pkLockPubkey?: string;
    }
  ) => Promise<{ historyEntry: string }>;
  /**
   * Execute a send using only local proofs (no mint contact).
   * Used as an automatic fallback when the mint is offline but exact-match
   * proofs exist. Returns the same shape as executeSend.
   */
  executeOfflineSend?: (
    mintUrl: string,
    amount: number,
    memo?: string
  ) => Promise<{ historyEntry: string }>;
  executeMintQuote: (
    mintUrl: string,
    amount: number,
    unit: string,
    method?: MintQuoteMethod
  ) => Promise<{ historyEntry: string }>;
  buildMintListItems: (data: StepDataMap['selectMint']) => Promise<MintListItem[]>;
  /**
   * Trust a mint. Called internally by `mintTrusted()` when the machine is
   * in the `reviewMint` step. The machine transitions to `receiveToken`
   * on success or `error` on failure.
   */
  trustMint?: (mintUrl: string) => Promise<void>;
  /**
   * Load detailed mint info for the trust review screen.
   * Called when the machine enters the `reviewMint` step.
   * The result is attached to `stepData.mintInfo` before the handler fires.
   *
   * `item` is the Select Mint row when this navigation came from the mint
   * selector. Catalog fields on the row (auditScore, kymScore, etc.) take
   * precedence over the local-cache `enrichMintReviewInfo` lookup so audit
   * data shipped with the row survives the trip to the info screen.
   */
  buildMintReviewInfo?: (
    mintUrl: string,
    item?: MintListItem
  ) => Promise<import('../types').MintReviewInfo>;
  /**
   * Execute a lightning melt. Called when the user confirms a melt from the
   * preview screen via `confirmMelt()`. The machine routes to the result
   * handler on success or BIP321 fallback / error on failure.
   */
  executeMelt?: (
    mintUrl: string,
    meltTarget: string,
    amount: number,
    unit: string
  ) => Promise<{ historyEntry: string }>;
  /**
   * Execute a payment request send. Called when the user confirms from the
   * payment request screen via `confirmPaymentRequest()`. The machine routes
   * to the result handler on success or BIP321 fallback / error on failure.
   */
  executePaymentRequest?: (
    mintUrl: string,
    paymentRequest: string,
    amount: number,
    unit: string
  ) => Promise<{ historyEntry: string; rolledBack?: boolean; errorMessage?: string }>;
  /**
   * Link a scanned input string to a transaction ID for history provenance.
   * Fire-and-forget — called after successful melt/payment-request operations.
   */
  linkTransaction?: (scannedInput: string, transactionId: string) => void;
  /**
   * Execute a send for NFC POS payment. Unlike `executeSend`, returns the
   * encoded V4 token (for NFC write-back) and the operationId (for rollback).
   */
  executeNfcSend?: (
    mintUrl: string,
    amount: number
  ) => Promise<{ token: string; historyEntry: string; operationId: string }>;
  /**
   * Roll back a pending send operation. Called when NFC write-back fails
   * after token creation to reclaim the ecash proofs.
   */
  rollbackSend?: (operationId: string) => Promise<void>;

  // ── Screen action operations ────────────────────────────────────────
  // These are used by the built-in default screen action handlers.
  // When provided, screen actions work out of the box without wallet
  // implementations. When omitted, the wallet must provide handlers.

  /**
   * Check the status of a pending send operation. Returns the current
   * state after polling the mint. Used by the sendToken.checkStatus
   * screen action.
   */
  checkSendStatus?: (operationId: string) => Promise<{ state: string }>;

  /**
   * Receive an ecash token. Calls wallet.receive(), finds the resulting
   * history entry, and returns it. Used by the receiveToken.redeem
   * screen action.
   */
  executeReceive?: (
    tokenString: string,
    mintUrl: string,
    amount: number
  ) => Promise<ReceiveExecuteResult>;

  /**
   * Background mesh auto-redeem: receive a token and resolve the REAL
   * persisted receive-history id (set-difference polling over history —
   * coco's flush races the receive). Returns null ids when the linkage
   * couldn't be resolved in time; the receive itself still succeeded.
   * Wire this into `createMeshRedeemOrchestrator`.
   */
  executeAutoRedeem?: (
    tokenString: string,
    mintUrl: string
  ) => Promise<{ historyEntryId: string | null; historyEntry: string | null }>;

  /**
   * Roll back a melt operation. Called when the user cancels from the
   * melt quote screen. Used by the meltQuote.cancel screen action.
   */
  rollbackMelt?: (operationId: string) => Promise<void>;

  /**
   * Check if a mint URL is in the trusted list. Used by the
   * receiveToken.redeem screen action to decide whether to route
   * through the trust review flow.
   */
  isMintTrusted?: (mintUrl: string) => Promise<boolean>;

  // ── Nostr ─────────────────────────────────────────────────────────────

  /**
   * Send a NIP-17 gift-wrapped direct message to an nprofile.
   * Used internally by `executePaymentRequest` for Nostr transport.
   * The wallet supplies its own publisher (decode nprofile, build kind-1059
   * gift wrap, publish) — the package no longer ships its own to keep
   * NIP-17 / NIP-44 implementation a consumer concern.
   */
  sendNostrDM?: (nprofile: string, message: string) => Promise<void>;

  /**
   * Resolve a melt target (Lightning Address / lud16) to a Nostr hex pubkey
   * via NIP-05. Best-effort: returns `null` on any failure. Fired
   * automatically as a side effect when `ctx.meltTarget` is set and
   * `ctx.recipientPubkey` is still empty. The default implementation is
   * shipped by this package (`recipient.ts`); wallets only need to override
   * to swap in a custom fetch (e.g. Tor routing).
   */
  resolveRecipientPubkey?: (
    meltTarget: string,
    signal?: AbortSignal
  ) => Promise<string | null>;

  /**
   * Resolve a Nostr hex pubkey to a profile (kind-0 metadata). Best-effort:
   * returns `null` on any failure. Fired automatically as a side effect
   * when `ctx.recipientPubkey` is set and `ctx.recipientProfile` is still
   * empty. No default — wallets supply their own NDK / cache integration
   * (long-running Nostr subscriptions / cache writes don't belong in this
   * package).
   */
  resolveRecipientProfile?: (
    pubkey: string,
    signal?: AbortSignal
  ) => Promise<RecipientProfile | null>;
}

// ---------------------------------------------------------------------------
// Scan types (UR assembly + execute)
// ---------------------------------------------------------------------------

export interface URDecoderLike {
  receivePart(part: string): void;
  getProgress(): number;
  isComplete(): boolean;
  isSuccess(): boolean;
  resultUR(): { decodeCBOR(): Uint8Array };
}

export interface ScanOptions {
  /** Source hint when data is provided. When no data, selects which source to fetch from. */
  source?: 'clipboard' | 'gallery' | string;
  /** When true, resets all flow state before processing the scan input. */
  reset?: boolean;
}

export interface ProcessResult {
  urInProgress: boolean;
  progress?: number;
  lockedPending?: boolean;
}

// ---------------------------------------------------------------------------
// Scan sources — platform-injected modules for clipboard/gallery
// ---------------------------------------------------------------------------

export type ScanSourceResult =
  | { data: string }
  | { canceled: true }
  | { empty: true }
  | { error: Error };

export interface ScanSources {
  clipboard?: () => Promise<ScanSourceResult>;
  gallery?: () => Promise<ScanSourceResult>;
  nfc?: () => Promise<ScanSourceResult>;
}

// ---------------------------------------------------------------------------
// NFC I/O Adapter — platform-injected NFC transport
// ---------------------------------------------------------------------------

export interface NfcIOAdapter {
  /** Start IsoDep session and read the NDEF text payload from the tag. */
  readPaymentRequest: () => Promise<string>;
  /** Write encoded token back to the tag via NDEF (session must still be active). */
  writeToken: (token: string) => Promise<void>;
  /** Release the IsoDep session. Idempotent. */
  releaseSession: () => Promise<void>;
  /** Whether NFC hardware is available and enabled. */
  isAvailable: () => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Machine configuration
// ---------------------------------------------------------------------------

export interface CreateMachineConfig {
  handlers: StepHandlerMap;
  detectors?: Detectors;
  getContext: () => WalletContext;
  getUnit?: () => string;
  unit?: string;
  /**
   * Async operations the machine executes for action steps.
   * When provided, confirmSend/createMintQuote/selectMint are handled
   * internally and external handlers only receive result steps.
   */
  operations?: MachineOperations;
  /**
   * Notification handlers for informational UI feedback.
   * The machine dispatches notifications for error steps (and future
   * warning/success events). The wallet decides how to present them.
   * When omitted or when no handler matches, notifications are no-ops.
   */
  notifications?: NotificationHandlerMap;
  /**
   * Factory that creates a URDecoder for animated QR assembly.
   * When provided, the machine exposes scan() for camera/paste input.
   */
  createURDecoder?: () => URDecoderLike;
  /**
   * Platform-injected sources for scan() when no data is passed.
   * clipboard: reads from system clipboard. gallery: picks image and scans QR.
   */
  scanSources?: ScanSources;
  /**
   * Current device offline / mock-offline flag. Used when AMOUNT_ENTERED omits `offline`.
   */
  getOffline?: () => boolean;
  /**
   * When true, ecash sends pause after amount/mint selection and ask the
   * consumer UI for an optional Cashu token memo before token creation.
   * Defaults to false for backwards compatibility.
   */
  enableEcashSendMemo?: boolean;
  /**
   * Returns the current locale for localized reason messages.
   * Defaults to 'en'.
   */
  getLocale?: () => string;
  /**
   * NFC I/O adapter for POS payment flows. When provided, `scan(undefined, { source: 'nfc' })`
   * reads from the adapter and the machine auto-resolves interactive steps (mint selection,
   * option choice) without user prompts, then writes the token back to the tag.
   */
  nfcAdapter?: NfcIOAdapter;
}

// ---------------------------------------------------------------------------
// Machine interface
// ---------------------------------------------------------------------------

export interface PaymentMachine {
  /** Send any event to advance the machine. */
  send: (event: FlowEvent) => Promise<void>;
  /** Process scan/paste/lightning input. Parses and routes to the appropriate flow. */
  execute: (input: string, opts?: { reset?: boolean }) => Promise<void>;
  /** Submit amount and mint for the current flow. Pass `offline: true` for local proof routing. */
  enterAmount: (
    amount: number,
    mintUrl: string,
    opts?: {
      destination?: Destination;
      mintQuoteMethod?: MintQuoteMethod;
      meltQuoteMethod?: MeltQuoteMethod;
      offline?: boolean;
      meltTarget?: string;
      recipientPubkey?: string;
      recipientProfile?: RecipientProfile;
      amountEntryDisplay?: AmountEntryDisplayMetadata;
    }
  ) => Promise<void>;
  /** User selected one of multiple payment options (e.g. from chooseOption step). */
  chooseOption: (option: PaymentOption) => Promise<void>;
  /** User selected round-down or round-up amount from offline proof suggestions. */
  chooseProofs: (amount: number) => Promise<void>;
  /** Submit or skip the optional ecash token memo prompt. */
  submitSendMemo: (memo?: string) => Promise<void>;
  /** Select a mint. Without `destination`, continues the current flow with the new mint. */
  changeMint: (
    mintUrl: string,
    opts?: { persist?: boolean; scope?: 'npc' | 'selected' }
  ) => Promise<void>;
  /**
   * Open mint selector for current flow.
   * Pass `{ reset: true }` to clear stale flow context first (e.g. from home screen).
   * Pass `{ scope: 'npc' }` to update NPC mint only (not selectedMint).
   */
  requestMintSelector: (opts?: { reset?: boolean; scope?: 'npc' | 'selected' }) => Promise<void>;
  /**
   * Open the destination-first Send method chooser. Lands on the
   * `selectDestination` step (no amount/mint chosen yet) so the wallet can
   * present the send methods + destination input + contact search. Pass
   * `{ reset: true }` to clear stale flow context first (e.g. from the wallet
   * Send button).
   */
  startSend: (opts?: { reset?: boolean }) => Promise<void>;
  /** Start a send ecash flow. Auto-selects mint, opens amount screen. */
  startSendEcash: (opts?: {
    reset?: boolean;
    meltTarget?: string;
    recipientPubkey?: string;
    recipientProfile?: RecipientProfile;
    /** See `FlowContext.p2pkLockPubkey` — P2PK-lock the sent token to this key. */
    p2pkLockPubkey?: string;
  }) => Promise<void>;
  /** Start a receive lightning flow. Opens amount screen for mint quote. */
  startReceiveLightning: (opts?: { reset?: boolean }) => Promise<void>;
  /** Open the receive hub screen (Lightning address, P2PK). */
  startReceive: (opts?: { reset?: boolean }) => Promise<void>;
  /**
   * Navigate to a mint info screen for trust review.
   * Used when a received token comes from an untrusted mint.
   * The `reviewMint` handler is dispatched so the wallet controls the navigation.
   */
  reviewMint: (mintUrl: string, token: string) => Promise<void>;
  /**
   * Trust the mint currently being reviewed.
   * Calls `operations.trustMint(mintUrl)` internally, then transitions
   * from `reviewMint` back to `receiveToken` so the user can retry the
   * redeem. On failure, transitions to `error`.
   */
  mintTrusted: () => Promise<void>;
  /**
   * Confirm and execute a melt from the preview screen.
   * Requires `operations.executeMelt` to be provided. On success, dispatches
   * the result handler. On failure in a BIP321 multi-option flow, transitions
   * to `chooseFallbackOption` with the failed option disabled.
   */
  confirmMelt: () => Promise<void>;
  /**
   * Confirm and execute a payment request from the preview screen.
   * Requires `operations.executePaymentRequest` to be provided. On success,
   * dispatches the result handler. On failure in a BIP321 multi-option flow,
   * transitions to `chooseFallbackOption` with the failed option disabled.
   */
  confirmPaymentRequest: () => Promise<{ rolledBack: boolean }>;
  /** Clear all flow state. */
  reset: () => void;
  /**
   * Process scan/paste input with optional UR assembly.
   * Present when createURDecoder or scanSources is provided.
   * - scan(data, options): process string directly.
   * - scan() / scan({ source: 'clipboard' }): use clipboard source.
   * - scan({ source: 'gallery' }): use gallery source.
   */
  scan?: (data?: string, options?: ScanOptions) => Promise<ProcessResult>;
  /** Current execution state (stable reference between notifications). */
  inspect: () => ExecutionState;
  /** Current flow context (for mint availability, flow mint, etc.). */
  getContext: () => FlowContext;
  /** Current step. */
  getStep: () => FlowStep;
  /** Subscribe to state changes. Returns unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
}

/** Curated UI copy only. Never interpolate an upstream message into this catalog. */
export const ERROR_COPY = {
  'app.unknown': 'Something went wrong. If this continues, contact support.',
  'routstr.unknown': 'The AI request failed. Try again later. If this continues, contact support.',
  'routstr.not_found': 'The AI provider is unreachable right now. Try again in a minute.',
  'routstr.model_unavailable': 'This AI model is unavailable. Choose another model and try again.',
  'routstr.auth': 'The AI service did not accept your credit key. Check your AI credit settings.',
  'routstr.balance': 'Your AI credit cannot cover this request. Choose a cheaper model or top up.',
  'routstr.provider_declined':
    'The AI provider declined this request. Try another model, or try again in a minute.',
  'routstr.unavailable': 'The AI provider is unreachable right now. Try again in a minute.',
  // Distinct from `routstr.unavailable` on purpose. This one is OUR verdict
  // after walking every candidate, not one node's answer — saying "the
  // provider is unreachable" sent people chasing a provider that was fine, and
  // hid that the shortlist itself (model, mint, filters) was the thing to
  // change.
  // One chosen provider, and it refused. Naming the provider (not "providers")
  // is what points at the one action that helps.
  'routstr.provider_refused':
    'Your AI provider refused this request. Try another model, or switch provider in AI settings.',
  'routstr.no_providers':
    'No AI provider could take this request. Try a different model, or check your AI provider settings.',
  // 502 is the node telling us its own upstream model service failed. The node
  // answered, so "unreachable" is wrong, and retrying the same model usually
  // repeats it.
  'routstr.upstream_failed':
    'The AI provider could not reach the model it routes to. Try another model, or try again in a minute.',
  'routstr.no_provider':
    'Choose an AI provider first. Tap the pill at the top of the AI tab to see who is available.',
  // Not an answer from anyone — we never got as far as a request. The model
  // catalogue has not landed this session and no snapshot survived, so there
  // is no model id to send. Distinct from `routstr.unavailable`, which is a
  // claim about a node we actually tried.
  'routstr.catalog_unavailable':
    'The AI model list has not loaded yet. Check your connection and try again in a moment.',
  // The list DID load, and this provider serves nothing this wallet can use —
  // a node answering with no priced chat models, or none our filters keep.
  // Telling that user to check their connection sends them to retry something
  // that is working.
  'routstr.no_usable_models':
    'This AI provider is serving no models you can use. Choose another provider.',
  // Nothing was sent. The user chose the end-to-end encrypted vendor and this
  // node is serving no sealed model, so every model we could have reached
  // would have read the prompt in the clear. Falling back to one of those
  // quietly is the defect this id exists to make impossible: the promise is
  // the selection, so breaking it has to be something the user is told about
  // and chooses, not something the send path decides on their behalf.
  'routstr.e2ee_unavailable':
    'No end-to-end encrypted model is available from this AI provider, so nothing was sent. Choose another provider, or pick an unencrypted model.',
  'routstr.mint_not_accepted':
    'This AI provider does not accept any of your mints. Choose another provider, or add one of the mints it accepts.',
  'routstr.mint_refused':
    'Your mint could not complete the payment for this request. Try another mint, or a provider that accepts one.',
  'routstr.timeout': 'The AI service took too long to respond. Try again later.',
  'routstr.invalid_request':
    'The AI service could not accept this message. Check the message and attachments, or choose another model.',
  'cashu.unknown':
    'The wallet or mint could not complete this operation. Check its status in transaction history before trying again.',
  'cashu.proofs_invalid':
    'The mint could not verify this ecash. Check the token and contact the sender if needed.',
  'cashu.proofs_spent':
    'The mint reports that this ecash has already been spent. Check transaction history before trying to redeem it again.',
  'cashu.proofs_pending':
    'This ecash is involved in a pending operation. Check its status before trying to spend it again.',
  'cashu.outputs_signed':
    'The mint has already signed this request. Check transaction history or use wallet recovery before creating another payment.',
  'cashu.outputs_pending':
    'The mint is still processing this request. Check transaction history before trying again.',
  'cashu.invalid_transaction':
    'The mint rejected the transaction details. Check transaction history and contact support if this continues.',
  'cashu.amount_limit':
    'This amount is outside the mint’s supported limits. Choose a different amount.',
  'cashu.amountless_invoice':
    'This mint needs an invoice with an amount. Ask the recipient for a new invoice.',
  'cashu.unit_unsupported': 'This mint does not support the selected currency unit.',
  'cashu.keyset':
    'The mint could not use the requested signing keys. Refresh the mint’s information. If this continues, contact support.',
  'cashu.quote_unpaid':
    'The mint has not confirmed payment for this invoice yet. Check its status before paying again.',
  'cashu.quote_issued':
    'The mint has already issued ecash for this quote. Check transaction history or use wallet recovery.',
  'cashu.disabled':
    'The mint has disabled this operation. Try again later or contact the mint operator.',
  'cashu.lightning_failed':
    'The mint reports that the Lightning payment failed. Check transaction history before making another payment.',
  'cashu.quote_pending':
    'The mint is still processing this payment. Check its status before paying again.',
  'cashu.invoice_paid':
    'The mint reports that this invoice is already paid or pending. Check its status before paying again.',
  'cashu.quote_expired':
    'This payment quote has expired. Check the previous payment’s status before requesting a new quote.',
  'cashu.signature':
    'The mint could not verify a required signature. Check the ecash spending conditions or contact support.',
  'cashu.auth':
    'The mint requires authentication or did not accept it. Check the mint’s access requirements.',
  'cashu.insufficient_funds': 'Your available balance cannot cover this transaction.',
  'cashu.not_trusted': 'This mint is not trusted. Review and add it in mint settings first.',
  'cashu.operation_pending':
    'Another wallet operation is in progress. Wait for it to finish and check transaction history.',
  'cashu.operation_missing':
    'The wallet could not find this operation. Check transaction history before starting another payment.',
  'cashu.invalid_token':
    'This ecash token could not be read. Check that you copied or scanned the complete token.',
  'cashu.no_route':
    'The mint could not find a Lightning route. Check the payment status before trying again.',
  'cashu.lightning_unavailable':
    'The mint’s Lightning service is not ready. Try again later and check transaction history first.',
  'cashu.unavailable':
    'The mint is unavailable or returned an unexpected response. Check transaction history before trying again.',
  'cashu.timeout':
    'The mint took too long to respond. The payment outcome is not confirmed. Check transaction history before paying again.',
  'cashu.cancelled':
    'The request was cancelled. Check transaction history before starting another payment.',
  'cashu.network':
    'Could not reach the mint. Check your connection and the transaction status before trying again.',
  'nostr.unknown':
    'The Nostr request could not be completed. Check your connection and relay settings.',
  'nostr.no_signer': 'Your Nostr signer is unavailable. Check your profile or signer connection.',
  'nostr.sign_failed':
    'The Nostr event could not be signed. Check your signer connection and try again.',
  'nostr.no_relays': 'No Nostr relays are available. Check your relay settings.',
  'nostr.all_failed':
    'No relay confirmed this publish. Check your connection and relay settings before trying again.',
  'nostr.rejected':
    'The relay rejected this event. Check the relay’s access rules or try another relay.',
  'nagg.unknown': 'The feed service could not complete this request. Try again later.',
  'nagg.unavailable': 'The feed service is unavailable. Try again later.',
  'nagg.not_found':
    'The feed service could not find the requested resource or endpoint. Refresh and try again later.',
  'nagg.invalid_response':
    'The feed service returned an unexpected response. Try again later. If this continues, contact support.',
  'nagg.not_configured': 'The feed service is not configured. Check your backend settings.',
  network: 'Could not connect to the service. Check your internet connection and try again.',
  timeout: 'The service took too long to respond. Try again later.',
  cancelled: 'The request was cancelled.',
  rate_limited: 'Too many requests. Wait a moment before trying again.',
  forbidden: 'The service did not allow this request. Check your access settings.',
  auth: 'The service did not accept your authentication. Check your connection settings.',
  unavailable: 'The service is temporarily unavailable. Try again later.',
} as const;

export type ErrorId = keyof typeof ERROR_COPY;

/** NUT codes, not HTTP statuses. CDK and Nutshell share these, with noted differences.
 * Sources and vendor caveats: README.md in this directory. */
export const CASHU_CODES: Readonly<Record<number, ErrorId>> = {
  10001: 'cashu.proofs_invalid',
  11001: 'cashu.proofs_spent',
  11002: 'cashu.proofs_pending',
  11003: 'cashu.outputs_signed',
  11004: 'cashu.outputs_pending',
  11005: 'cashu.invalid_transaction',
  11006: 'cashu.amount_limit',
  11007: 'cashu.invalid_transaction',
  11008: 'cashu.invalid_transaction',
  11009: 'cashu.invalid_transaction',
  11010: 'cashu.invalid_transaction',
  11011: 'cashu.amountless_invoice',
  11012: 'cashu.invalid_transaction',
  11013: 'cashu.unit_unsupported',
  11014: 'cashu.invalid_transaction',
  11015: 'cashu.invalid_transaction',
  11016: 'cashu.invalid_transaction',
  11017: 'cashu.invalid_transaction',
  12001: 'cashu.keyset',
  12002: 'cashu.keyset',
  12003: 'cashu.keyset',
  20001: 'cashu.quote_unpaid',
  20002: 'cashu.quote_issued',
  20003: 'cashu.disabled', // CDK also uses this for disabled melting.
  20004: 'cashu.lightning_failed',
  20005: 'cashu.quote_pending',
  20006: 'cashu.invoice_paid', // CDK also uses this for a pending duplicate invoice.
  20007: 'cashu.quote_expired',
  20008: 'cashu.signature', // CDK also maps NUT-11 witness failures here.
  20009: 'cashu.signature',
  30001: 'cashu.auth',
  30002: 'cashu.auth',
  31001: 'cashu.auth',
  31002: 'cashu.auth',
  31003: 'cashu.amount_limit',
  31004: 'rate_limited',
};

/** Legacy strings from Coco/mints when the structured cause has been lost.
 * Deliberately scoped to Cashu; never run these against AI or relay messages. */
export const CASHU_MESSAGE_RULES: readonly (readonly [RegExp, ErrorId])[] = [
  [/\b(?:proofs?|tokens?) (?:are |were |have been )?already spent\b/i, 'cashu.proofs_spent'],
  [/\bproofs? (?:are |is )?pending\b/i, 'cashu.proofs_pending'],
  [
    /outputs (?:have )?(?:already been signed(?: before)?|already signed|are already signed)/i,
    'cashu.outputs_signed',
  ],
  [/outputs (?:are )?pending/i, 'cashu.outputs_pending'],
  [/keyset (?:id )?(?:is )?(?:inactive|not found|unknown|expired)/i, 'cashu.keyset'],
  [/\b(?:mint )?quote (?:has )?(?:already been issued|already issued)\b/i, 'cashu.quote_issued'],
  [/\binvoice (?:is )?already paid\b/i, 'cashu.invoice_paid'],
  [/\bquote (?:is )?(?:not paid|unpaid)\b/i, 'cashu.quote_unpaid'],
  [/\bquote (?:is )?pending\b/i, 'cashu.quote_pending'],
  [/\b(?:quote|invoice) (?:is )?expired\b/i, 'cashu.quote_expired'],
  [/\bwitness is missing for p2pk\b/i, 'cashu.signature'],
  [/\b(?:no_route|FAILURE_REASON_NO_ROUTE|ran out of routes)\b/i, 'cashu.no_route'],
  [/\blnd is not ready\b/i, 'cashu.lightning_unavailable'],
  [/\bFAILURE_REASON_TIMEOUT\b/, 'cashu.timeout'],
  [/\blightning payment failed\b/i, 'cashu.lightning_failed'],
  [/\binsufficient (?:funds|balance)\b/i, 'cashu.insufficient_funds'],
  [/\bmint\b.*\b(?:is )?not trusted\b/i, 'cashu.not_trusted'],
  [/\boperation already in progress\b/i, 'cashu.operation_pending'],
  [/\boperation not found\b/i, 'cashu.operation_missing'],
  [/\binvalid token\b/i, 'cashu.invalid_token'],
  [/\bbad response\b/i, 'cashu.unavailable'],
];

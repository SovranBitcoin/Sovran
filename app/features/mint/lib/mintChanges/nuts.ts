/**
 * NUT titles and NUT-06 field names used to turn a JSON Pointer into a readable
 * label. Ported from the `Sovran/changes` observatory (`src/nuts.ts`) so the app
 * and the web changelog name the same things the same way — keep the two in
 * sync when the spec index moves.
 *
 * Titles are verbatim from the spec index in the `nuts` repo (cashubtc/nuts
 * README). Unlisted numbers stay unnamed on purpose: it is better to render a
 * bare "NUT-31" than to invent a title for it.
 */
export const NUT_TITLES: Record<string, string> = {
  '0': 'Cryptography and models',
  '1': 'Mint public keys',
  '2': 'Keysets and fees',
  '3': 'Swapping tokens',
  '4': 'Minting tokens',
  '5': 'Melting tokens',
  '6': 'Mint info',
  '7': 'Token state check',
  '8': 'Overpaid Lightning fees',
  '9': 'Signature restore',
  '10': 'Spending conditions',
  '11': 'Pay-to-pubkey',
  '12': 'DLEQ proofs',
  '13': 'Deterministic secrets',
  '14': 'Hashed timelock contracts',
  '15': 'Multi-path payments',
  '16': 'Animated QR codes',
  '17': 'WebSocket subscriptions',
  '18': 'Payment requests',
  '19': 'Cached responses',
  '20': 'Signature on mint quote',
  '21': 'Clear authentication',
  '22': 'Blind authentication',
  '23': 'Payment method: BOLT11',
  '24': 'HTTP 402 Payment Required',
  '25': 'Payment method: BOLT12',
  '26': 'Payment request bech32m',
  '27': 'Nostr mint backup',
  '28': 'Pay to blinded key',
  '29': 'Batched mint',
  '30': 'Payment method: onchain',
};

/** Top-level mint-info fields, named as NUT-06 describes them. */
export const INFO_FIELDS: Record<string, string> = {
  name: 'Mint name',
  pubkey: 'Mint pubkey',
  version: 'Software',
  description: 'Description',
  description_long: 'Long description',
  contact: 'Contact',
  motd: 'Message of the day',
  icon_url: 'Icon',
  urls: 'Mint URLs',
  time: 'Server clock',
  tos_url: 'Terms of service',
};

/** Leaf keys that appear inside a NUT's settings object. */
export const LEAF_FIELDS: Record<string, string> = {
  max_amount: 'max amount',
  min_amount: 'min amount',
  method: 'method',
  method_name: 'method name',
  unit: 'unit',
  amountless: 'amountless invoices',
  description: 'invoice description',
  options: 'options',
  commands: 'commands',
  supported: 'support',
  methods: 'methods',
  disabled: 'disabled',
  ttl: 'cache lifetime',
  cached_endpoints: 'cached endpoints',
  max_batch_size: 'max batch size',
  confirmations: 'confirmations',
  info: 'info',
  bat_max_mint: 'max auth tokens per mint',
  protected_endpoints: 'protected endpoints',
};

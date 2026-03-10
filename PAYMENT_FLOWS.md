# Payment Flows

Comprehensive reference for every unique payment flow in Sovran. Used for debugging, onboarding, and ensuring routing logic matches expected behavior.

**Debug logging:** Mint context (trustedMintCount, mintBalances, validMintCount, etc.) is logged at routing decision points via `buildMintContext`. See `shared/lib/debugSession.ts` and logs with `hypothesisId: 'process'` or `'nfc'` or `'screen'`.

---

## Entry Points

| Entry | Source | Destination |
|-------|--------|-------------|
| Wallet tab "Receive" | `AccountPagerView` | `/(receive-flow)/receive` (to: sendToken) |
| Wallet tab "Scan QR" | `AccountPagerView` | `/camera` (to: sendToken) |
| Wallet tab "Send" | `AccountPagerView` | `/(send-flow)/currency` or `/(send-flow)/mintSelect` |
| Receive screen "Paste" | `ReceiveScreen` | `processPaymentString` (paste) |
| Receive screen "Fixed amount" | `ReceiveScreen` | `/(receive-flow)/currency` (to: mintQuote) |
| Receive screen "Scan QR" | `ReceiveScreen` | `/camera` |
| NFC tap | `useNfcEcashPayment` | `NfcPayment.performPayment` |
| Camera scan | `StandaloneCameraScreen` / flow | `processPaymentString` (qr) |
| Deeplink | App open | `processPaymentString` (deeplink) |

---

## Flow Catalog

### 1. Send Ecash (Currency → SendToken)

**Entry:** Wallet Send (with balance) → `/(send-flow)/currency` (to: sendToken)

**Steps:**
1. User enters amount on CurrencyScreen
2. `handleNext` → `sendMachine.next()`
3. `sendTokenMachine`: idle → (guards) → checkingOffline | checkingFiatOfflineOptimization | sending
4. If offline: `checkingOffline` → `offlineSuggestions` or `sending`
5. If online fiat: `checkingFiatOfflineOptimization` → `sending`
6. `sending` invokes `sendEcashActor` → `capturingLocation` → `success`
7. `onSendTokenCreated` → navigate to `/(send-flow)/sendToken`

**State machine:** `sendTokenMachine`  
**Key guards:** `isMintSelected`, `isAmountValid`, `isBalanceSufficient`, `isOffline`, `isExactOfflineAmount`

---

### 2. Send Ecash (MintSelect → Currency → SendToken)

**Entry:** Wallet Send (no balance) → `/(send-flow)/mintSelect` (to: sendToken)

**Steps:**
1. User selects mint from MintListScreen
2. `handleMintNavigation` → `/(send-flow)/currency` (to: sendToken)
3. Same as Flow 1 from step 2 onward

---

### 3. Receive Lightning (Currency → MintQuote)

**Entry:** Receive screen "Fixed amount" → `/(receive-flow)/currency` (to: mintQuote)

**Steps:**
1. User enters amount on CurrencyScreen
2. `handleNext` → `mintMachine.next()`
3. `mintQuoteMachine`: idle → `requestingInvoice` → `capturingLocation` → `invoiceReady`
4. `onMintQuoteCreated` → navigate to `/(receive-flow)/mintQuote`
5. User waits for payment; `PAYMENT_RECEIVED` → `paid`; `REDEEMED` → `redeemed`

**State machine:** `mintQuoteMachine`  
**Key guards:** `isMintSelected`, `isAmountValid`

---

### 4. Melt Lightning (Currency → MeltQuote)

**Entry:** CurrencyScreen with `params.to === 'meltQuote'` and `lnUrlOrAddress`

**Steps:**
1. User enters amount on CurrencyScreen
2. `handleNext` → `onMeltQuoteReady(lnUrlOrAddress, amount)`
3. Navigate to `/(send-flow)/meltQuote` with lnUrlOrAddress + amount
4. MeltQuoteScreen: `meltQuoteMachine` validates → `resolvingLnUrl` (if LNURL) → `preparingQuote` → `quoteReady`
5. User taps Pay → `handleMelt` → `meltMachine.execute()` or legacy `executeMeltByQuote`
6. `executing` → `capturingLocation` → `success`

**State machine:** `meltQuoteMachine`  
**Key guards:** `isMintSelected`, `hasLnUrlOrAddress`, `hasInvoice`

---

### 5. Melt Lightning (Direct Invoice)

**Entry:** QR/paste of Lightning invoice with amount → `/(send-flow)/meltQuote` (invoice param)

**Steps:**
1. `useProcessPaymentString` detects `isLightningInvoice` + `getLightningAmount` → has amount
2. `router.navigate` to `/(send-flow)/meltQuote` with `invoice`
3. MeltQuoteScreen creates quote from invoice; user taps Pay
4. Same as Flow 4 from step 5 onward

**Requires:** `selectedMint` (mint must be selected for Lightning routing)

---

### 6. Melt Lightning (LNURL/Address → Currency)

**Entry:** QR/paste of Lightning address or LNURL without amount

**Steps:**
1. `useProcessPaymentString` detects `isLightningAddress` or `isLnurlp` (no amount)
2. `router.navigate` to `/(send-flow)/currency` (to: meltQuote, lnUrlOrAddress)
3. Same as Flow 4 from step 1 onward

**Requires:** `selectedMint`

---

### 7. Receive Ecash (QR/Paste Token)

**Entry:** QR scan or paste of ecash token (Cashu format)

**Steps:**
1. `useProcessPaymentString` detects `isValidEcashToken`
2. `router.navigate` to `/(receive-flow)/receiveToken` with `receiveHistoryEntry`
3. ReceiveTokenScreen shows token; user taps Receive

---

### 8. Receive Ecash (UR Multi-Part)

**Entry:** QR scan of `ur:` (UR-encoded ecash)

**Steps:**
1. `useProcessPaymentString` receives `ur:` parts via `urDecoder.receivePart`
2. Progress updates via `onProgress`; haptics on progress milestones
3. When `urDecoder.isComplete()` and `urDecoder.isSuccess()`: decode CBOR → token string
4. Same as Flow 7 from step 2 onward

---

### 9. NUT-18 Payment Request (Nostr)

**Entry:** QR/paste of `creqA` payment request with Nostr transport

**Routing table (from useProcessPaymentString):**

| Mints | Amount | Valid mints | Flow |
|-------|--------|-------------|------|
| No | No | Any | currency (to: paymentRequest) → user picks mint + amount |
| No | Yes | 1 | sendToken (paymentRequest, amount, selectedMintUrl) directly |
| No | Yes | 2+ | mintSelect (to: paymentRequest) → sendToken |
| Yes | No | 1 | currency (to: paymentRequest, amount only) |
| Yes | No | 2+ | currency (to: paymentRequest, pick from allowed + amount) |
| Yes | Yes | 1 | sendToken (PR mode) directly |
| Yes | Yes | 2+ | mintSelect (to: paymentRequest) → sendToken |

**Valid mints:** trusted mints with balance ≥ minAmount (if specified), and in allowedMints (if specified).

**Steps (currency path):**
1. User enters amount (and/or selects mint)
2. CurrencyScreen `handleNext` → paymentRequest case
3. Decode request → create token → send via NIP-17 DM → `paymentStatusPopup` → navigate to SendTokenScreen

**Steps (sendToken path):**
1. SendTokenScreen in payment request mode
2. User taps Send → `handleSendPayment` → create token → send via Nostr → `paymentStatusPopup`

---

### 10. NFC Ecash Send

**Entry:** NFC tap on POS device

**Steps:**
1. `useNfcEcashPayment.startPayment(usdLimit?)` → `NfcPayment.performPayment`
2. Phase 1: Read payment request from tag (APDU)
3. Phase 2: Parse request → if ecash: `createToken` (mintUrl, amount) via `send()`
4. Phase 3: Write token to tag via NFC
5. Success: `setStatus('idle')`

**On Lightning invoice from NFC:** `onLightningInvoice` → navigate to mintSelect (if amount) or currency (if no amount)

**State machine:** `nfcSendMachine` (available but not yet primary; imperative flow in `useNfcEcashPayment` is current)

---

### 11. NFC Lightning Redirect

**Entry:** NFC tap returns Lightning invoice

**Steps:**
1. `NfcPayment.performPayment` → `onLightningInvoice(invoice, amount)`
2. If `amount`: `router.navigate` to `/(send-flow)/mintSelect` (to: meltQuote, invoice, minAmount)
3. If no amount: `router.navigate` to `/(send-flow)/currency` (to: meltQuote, lnUrlOrAddress: invoice)
4. Continue to Flow 4 or 5

---

### 12. Mint URL (Info)

**Entry:** QR/paste of `http://` or `https://` URL

**Steps:**
1. `useProcessPaymentString` detects URL
2. `router.navigate` to `/(mint-flow)/info` (mintUrl, fromScan)

---

### 13. Npub Profile

**Entry:** QR/paste of `npub1` or `nprofile1`

**Steps:**
1. `useProcessPaymentString` detects `parseNpub`
2. `router.navigate` to `/(user-flow)/profile` (npub)

---

### 14. Send Token (Offline Fallback)

**Entry:** Same as Flow 1, but when `sending` fails (mint offline, network error)

**Steps:**
1. `sendTokenMachine`: `sending` → `onError` → `sendFailed`
2. If `operationId`: `rollingBack` → `offlineFallback`
3. If `offlineSendability.reachableSums.length > 0`: `offlineFallbackSuggestions`
4. User selects `SELECT_AMOUNT` or `CANCEL`
5. If SELECT_AMOUNT: `sending` again with offline amount

---

### 15. Send Token (Offline Direct)

**Entry:** CurrencyScreen with `isOffline` and no mock

**Steps:**
1. `handleNext` → `maybeShowOfflineSendSuggestions`
2. If amount is exact offline match: `handleEcashSend(amount)` directly
3. Else: show offline suggestions popup; user selects amount or cancels

---

### 16. QR Scan Router Machine (Future)

**Parsed types:** `ur`, `ecash`, `paymentRequest`, `lightningInvoice`, `lightningAddress`, `mintUrl`, `npub`, `unknown`

**States:** idle → checkingPermission → parsing → routing → routeUR | routeEcash | routePaymentRequest | routeLightning | routeMintUrl | routeNpub

**Note:** `qrScanRouterMachine` models the same routing logic as `useProcessPaymentString`; the hook is the current implementation. The machine is used for future migration.

---

## State Machines Summary

| Machine | ID | Purpose |
|---------|-----|---------|
| `sendTokenMachine` | sendToken | Ecash send, offline handling, fiat optimization |
| `meltQuoteMachine` | meltQuote | Lightning melt, LNURL resolution, quote prep/execute |
| `mintQuoteMachine` | mintQuote | Receive Lightning, invoice request |
| `nfcSendMachine` | nfcSend | NFC ecash send (read → decode → select mint → create token → write) |
| `qrScanRouterMachine` | qrScan | Parse and route scanned strings |

---

## Mint Context for Routing

Routing decisions (especially NUT-18 payment requests) depend on:

- **trustedMints:** All mints user trusts
- **mintBalances:** Balance per mint URL
- **allowedMints:** From payment request (if specified)
- **minAmount:** From payment request (if specified)
- **validMints:** trustedMints filtered by allowedMints, minAmount, balance > 0

**Valid mint count** determines whether we go to mintSelect (2+) or directly to currency/sendToken (1).

---

## Tested Flows

Verbose table of tested payment situations. Each row captures wallet state, terminal/external state, and outcome so we can reproduce and verify without re-stating context.

### NFC Ecash

| # | Date | Wallet state | Terminal state | USD limit | Result | Logs |
|---|------|--------------|----------------|-----------|--------|------|
| 1 | 2025-03-09 | selectedMint: Sovran; minibits: sufficient; sovran: sufficient | Accept unknown mints: false; only knows minibits; amount: 10 sats | No limits | *(pending)* | startPayment, performPayment, decoded, selectBestMint, createToken |

**Wallet state columns:** `selectedMint` (user's selected), `mintBalances` (per-mint balance, e.g. `minibits: 5000`), `trustedMints` count.

**Terminal state columns:** `acceptUnknownMints`, `allowedMints` (from payment request), `amount`, `unit`.

**Logging:** `startPayment` logs selectedMint, preferredMint, usdLimit, mintBalances. `payment.ts:decoded` logs terminal amount, unit, allowedMints. `payment.ts:selectBestMint` logs selected mint, balance, preferredMint. `createToken` logs terminal requested mint/amount. Use these to populate the table without re-stating.

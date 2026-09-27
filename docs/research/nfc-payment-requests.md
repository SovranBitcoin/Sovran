# NFC payment requests: footguns and best practices for a reader-side wallet

Research note, 2026-09-26. Scope: Sovran (React Native, `react-native-nfc-manager`) acting as
the NFC **reader** that opens an IsoDep session against a point-of-sale terminal emulating an
NFC Forum Type 4 Tag (Numo on Android HCE, Macadamia on iOS `CardSession`), reads a NUT-18
`creq...` payment request from the NDEF file, and writes a `cashuB...` token back into the same
file with UPDATE BINARY.

Primary sources only. Where a claim could not be tied to a primary source it is marked
**(not verified)**. Repository snapshots consulted: `cashubtc/Numo` main `45d7cfb5a5`
(2026-09-24), `revtel/react-native-nfc-manager` main `63ad94f236` / release v3.17.2
(2025-11-28), `cashubtc/nuts` main `8bde3c0c36` (2026-09-24), `minibits-cash/minibits_wallet`
`d10d3893e3`, `zeugmaster/macadamia` `47f4726a61`, `cashubtc/cashu-ts` `9c44601a1c`, AOSP
`platform/system/nfc` branch `android15-release`, CoreNFC headers from the iPhoneOS 26.1 SDK.

## Summary

1. **`90 00` on UPDATE BINARY does not mean the terminal accepted the token.** Numo acknowledges
   every syntactically valid write immediately and processes the NDEF on a background thread; a
   token that fails validation, arrives after the terminal reached a terminal state, or arrives
   while another token is being processed is dropped with no wire-level signal. Treat the write as
   "delivered, outcome unknown" and reconcile against the mint (proof state) afterwards.
2. **Do not over-read the NDEF file.** Macadamia answers `6A 82` to any READ BINARY whose
   `offset + Le` exceeds the file; Numo's published payer spec says the same. Read NLEN first,
   then request exactly the remaining bytes in chunks no larger than the CC file's MLe (Numo and
   Macadamia advertise MLe = 59, MLc = 52). Never rely on `Le = 00` (256).
3. **Write like AOSP does: NLEN = 0 first, then the body in MLc-sized chunks at offset 2, then the
   real NLEN last.** Numo and Macadamia accept both orders, but writing the real NLEN first makes
   Numo process the message as soon as `offset + Lc >= NLEN + 2`, which is fragile if a chunk is
   lost or repeated. The zero-first pattern is what Android's own Type 4 writer uses.
4. **`6A 82` on `SELECT E104` means "no active payment request".** Numo only exposes the NDEF file
   while a request is armed; after success or error it clears the request and the same SELECT
   fails. This is the terminal's only "already paid / not ready" signal. Also, Numo fires its
   "message sent" callback on the SELECT of E104, not on the READ.
5. **iOS reader sessions are hard-limited to 60 seconds, one session system-wide, and require
   `D2760000850101` in `com.apple.developer.nfc.readersession.iso7816.select-identifiers`.**
   CoreNFC auto-SELECTs the listed AIDs in array order on discovery and only hands you an
   `NFCISO7816Tag` if one succeeds; a SELECT-by-name for an unlisted AID is a
   `readerErrorSecurityViolation`. A session cannot be reused after invalidation, and
   `restartPolling` invalidates previously detected tags.
6. **Re-arming a CoreNFC session immediately after the user cancels can hang forever.**
   `react-native-nfc-manager` returns `"Duplicated registration"` if it still holds a session,
   and community reports show `requestTechnology` never activating when called right after a
   cancel. There is no Apple documentation for a mandatory gap; back off ~1-2 s and treat
   "Duplicated registration" as retryable.
7. **On Android, use reader mode with `FLAG_READER_NFC_A | FLAG_READER_SKIP_NDEF_CHECK`, keep it
   enabled until the payment UI is dismissed, and do the whole read→prepare→write in one
   session.** Android documents these flags for HCE peers; reader mode disables both NDEF
   dispatch and this device's own card emulation. Tearing it down while the terminal is still
   presenting re-enables the OS "Complete action using…" chooser; a cold-launch tap (tag read by
   the OS) leaves no session to write back on.
8. **A raw token in a Text record is the de-facto NFC transport, not the NUT-18 payload.** NUT-18
   says an empty transport means in-band; the `ndef` transport PR (#240) was closed in favour of
   that reading. Numo strips transports before emulating, and Minibits only writes back when the
   request has no transport. The bare token carries no `i`/memo, so the terminal correlates by
   "currently armed request", not by id.
9. **`react-native-nfc-manager` flattens Android errors to `"transceive fail"` (losing
   `TagLostException`), silently `restartPolling`s on iOS connect failure (the JS promise keeps
   waiting), and allows only one listener per event.** Add your own overall timeout, classify
   `NfcError.UserCancel` / `Timeout` / `TagConnectionLost` explicitly, and route the Android
   `cancelTechnologyRequest` 1 s unregister delay into your state machine.
10. **Keep the payload small and the APDU count low.** Android's HCE guide targets about 1 KB
    exchanged in ~300 ms; Apple forum reports tie "Tag connection lost" to larger and more
    numerous APDUs per session; Minibits caps NFC payloads at 32,000 bytes. Prefer `cashuB`
    (CBOR) tokens with few proofs, and write only `TNF_WELL_KNOWN`/`T` (UTF-8, `en`) or
    `U` with identifier code `0x00` — Macadamia decodes only prefix codes `0x00`–`0x04`.

## 1. Type 4 Tag operation over HCE

### CC file layout as emulated by the terminals Sovran talks to

Numo's capability container (`NdefConstants.CC_FILE`), which Macadamia copies "byte-identical":

```
00 0F        CCLEN = 15
20           Mapping version 2.0
00 3B        MLe (max READ BINARY response) = 59
00 34        MLc (max UPDATE BINARY data)  = 52
04 06        NDEF File Control TLV, length 6
E1 04        NDEF file id
70 FF        Max NDEF file size = 0x70FF (28,671)
00 00        Read / write access unrestricted
```

Source: https://github.com/cashubtc/Numo/blob/main/app/src/main/java/com/electricdreams/numo/ndef/NdefConstants.java
and https://github.com/zeugmaster/macadamia/blob/main/macadamia/Wallet/NFCRequestEmulation.swift
("Capability container advertising the NDEF file E104, byte-identical to Numo's").

Numo's payer-side spec states both limits are advisory on their side: "The CC file advertises
`MLe = 0x003B = 59` bytes. The implementation **does not enforce** this limit." and "The
implementation **does not check MLc**." (sections 3.2 and 3.3,
https://github.com/cashubtc/Numo/blob/main/docs/NDEF_Payer_Side_Spec.md).

What a conforming reader stack validates in the CC (AOSP libnfc-nci, `rw_t4t.cc`,
`rw_t4t_validate_cc_file`): MLe < `0x000F` is rejected ("MaxLe (%d) is too small"), MLc < 1 is
rejected, NDEF file ids `E103`, `E102`, `0000` (for v2.0/v3.0), `3F00`, `3FFF`, `FFFF` are
invalid, and for mapping version 2.0 the max file size must be within `0x0005`..`0x7FFF`
("max_file_size (%d) is reserved"). Source:
https://android.googlesource.com/platform/system/nfc/+/refs/heads/android15-release/src/nfc/tags/rw_t4t.cc

The NFC Forum "Type 4 Tag" (current version 1.2), NDEF, RTD and URI RTD specifications are
"Purchase Specification" items on https://nfc-forum.org/build/specifications and were not
consulted directly; clause numbers from those documents are therefore not cited here.

### NLEN prefix

The NDEF file is `[NLEN hi][NLEN lo][NDEF message bytes…]`, NLEN big-endian and excluding the
two NLEN bytes (Numo spec section 2.3). AOSP uses `T4T_FILE_LENGTH_SIZE 0x02` for mapping v2.0
and a 4-byte `T4T_EFILE_LENGTH_SIZE 0x04` (ENLEN) for v3.0
(https://android.googlesource.com/platform/system/nfc/+/refs/heads/android15-release/src/nfc/include/tags_defs.h).
AOSP also enforces `NLEN + 2 <= max file size` when reading. Both Numo and Macadamia emulate
v2.0 with 2-byte NLEN.

### READ BINARY chunking, Le, extended length

Command: `00 B0 P1 P2 Le`, offset = `P1<<8 | P2`. Numo: "`length = Le` (0 is treated as 256)"
(spec 3.2). Macadamia: `let length = bytes[4] == 0 ? 256 : Int(bytes[4])` and
`guard offset + length <= file.count else { return (Self.error, nil) }`, i.e. **any over-read
returns `6A 82`**. Numo's spec section 3.2 states the same rule ("If `offset + length >
selectedFile.length`: Response `6A 82`"); the checked-in Java (`NdefApduHandler.handleReadBinary`)
currently clamps instead, so behaviour differs between Numo versions and between Numo and
Macadamia. Read NLEN, then request exactly `min(remaining, MLe)` per chunk.

Reader-side chunk size in AOSP: `max_read_size = min(MLe, RW_T4T_MAX_DATA_PER_READ)`; if
`max_read_size > T4T_MAX_LENGTH_LE + 1` (0x100) the stack switches to extended field coding
(`RW_T4T_EXT_FIELD_CODING`). Writes: `max_update_size = min(MLc, RW_T4T_MAX_DATA_PER_WRITE)`.
`T4T_MAX_LENGTH_LE` and `T4T_MAX_LENGTH_LC` are `0xFF`. Sources: `rw_t4t.cc` (state
`RW_T4T_SUBSTATE_WAIT_READ_NLEN`), `tags_defs.h`, `rw_int.h` (same branch).

Android's `IsoDep.isExtendedLengthApduSupported()` documentation: "Standard APDUs have a 1-byte
length field, allowing a maximum of 255 payload bytes, which results in a maximum APDU length
of 261 bytes. Extended length APDUs have a 3-byte length field, allowing 65535 payload bytes.
Some NFC adapters … do not support extended length APDUs."
https://developer.android.com/reference/android/nfc/tech/IsoDep#isExtendedLengthApduSupported()

### Max NDEF file size

Numo advertises `0x70FF` and buffers up to 65,536 bytes (`MAX_NDEF_DATA_SIZE`); Macadamia uses a
65,536-byte receive buffer. AOSP rejects v2.0 CC files declaring more than `0x7FFF`. Minibits
caps what it will send over NFC at 32,000 bytes ("Conservative limit (leaves room for NDEF
wrapper)", `isStringSafeForNFC` in
https://github.com/minibits-cash/minibits_wallet/blob/master/src/services/nfcService.ts).
The commonly quoted "0xFFFE max with 2-byte NLEN" comes from the paid T4T spec and is
**(not verified)** here.

### Write procedure (NLEN = 0, body, NLEN)

AOSP `RW_T4tUpdateNDef` is the reference reader-side procedure:
"/* set NLEN to 0x0000 for the first step */ `rw_t4t_update_nlen(0x0000)`", then
`rw_t4t_update_file()` writes the body starting at `rw_offset = nlen_size` in chunks of at most
`max_update_size`, and in `RW_T4T_SUBSTATE_WAIT_UPDATE_RESP`: "/* update NLEN as last step of
updating file */ `rw_t4t_update_nlen(p_t4t->ndef_length)`". Source: `rw_t4t.cc` (same URL).

Numo accepts two patterns (spec 6.2): **Pattern A** "Header (NLEN) first, then body" — processing
triggers when a later UPDATE satisfies `(offset + Lc) >= (NLEN + 2)`; **Pattern B** "Set NLEN=0,
then body, then final NLEN" — processing triggers on the final NLEN write because
`hasNonZeroData` sees the body. A zero NLEN header is "treated as initialization". Macadamia's
`handleUpdateBinary` mirrors both. Numo also has a 3,000 ms `MESSAGE_TIMEOUT_MS` that processes
a partial message "with available data" if no UPDATE arrives (spec 5.1.1 item 4), and a
3,500 ms `NFC_TIMEOUT_MS` after which the service reports "reading stopped" with
`failedInMiddleOfTransaction = isNfcWriting`
(https://github.com/cashubtc/Numo/blob/main/app/src/main/java/com/electricdreams/numo/ndef/NdefHostCardEmulationService.java).

UPDATE BINARY preconditions in Numo: `selectedFile != null` and not the CC file, otherwise
`6A 82`; Macadamia: "Writing requires the NDEF file to be selected; the CC file is read-only."

### Status words

AOSP `tags_defs.h` defines the words a Type 4 reader expects: `T4T_RSP_CMD_CMPLTED 0x9000`,
`T4T_RSP_NOT_FOUND 0x6A82`, `T4T_RSP_WRONG_PARAMS 0x6B00`, `T4T_RSP_CLASS_NOT_SUPPORTED 0x6E00`,
`T4T_RSP_WRONG_LENGTH 0x6700`, `T4T_RSP_INSTR_NOT_SUPPORTED 0x6D00`,
`T4T_RSP_CMD_NOT_ALLOWED 0x6986`. Any non-`9000` word aborts AOSP's operation
(`rw_t4t_handle_error(NFC_STATUS_CMD_NOT_CMPLTD, …)`). `6A86` was not found in AOSP's Type 4
definitions **(not verified)**.

The terminals are coarser: Numo returns `6A 82` for every NDEF-layer error (`NDEF_RESPONSE_ERROR`)
and `6F 00` (`STATUS_FAILED`) for unknown commands or exceptions in the outer service; Macadamia
returns `6A 82` for everything. Specifically, Numo `SELECT E104` returns `6A 82` unless
`isInWriteMode && messageToSend non-empty` ("Not in payment mode - return error"), and the
`onMessageSent()` callback fires at that SELECT, before any READ BINARY
(https://github.com/cashubtc/Numo/blob/main/app/src/main/java/com/electricdreams/numo/ndef/NdefApduHandler.java).

### Android `HostApduService` constraints on the terminal

- "response APDUs must be sent as quickly as possible, given the fact that the user is likely
  holding their device over an NFC reader"; "This method is running on the main thread of your
  application. If you cannot return a response APDU immediately, return null" and use
  `sendResponseApdu` ("may be called from any thread and will not block").
  https://developer.android.com/reference/android/nfc/cardemulation/HostApduService
- `onDeactivated(int reason)`: `DEACTIVATION_LINK_LOSS` ("the NFC link being lost") or
  `DEACTIVATION_DESELECTED` ("a different AID being selected … this next AID may still be
  resolved to this service"). Same page.
- HCE guide: "Android's HCE implementation, however, supports only a single logical channel";
  "Try to limit the amount of APDUs and the size of the data to exchange … A reasonable upper
  bound is about 1 KB of data, which can usually be exchanged within 300 ms."; Android
  "mandates emulating ISO-DEP only on top of the Nfc-A (ISO/IEC 14443-3 Type A) technology."
  https://developer.android.com/develop/connectivity/nfc/hce
- A per-response size limit (the often-quoted 253/261 bytes) is **not stated** in either page
  **(not verified)**. Numo answers a `Le = 00` READ with up to 256 data bytes + SW; whether the
  reader's NFC controller carries that in one frame is device-dependent (see IsoDep extended
  length above), so staying at or below MLe is the safe choice.
- Because Numo processes the written NDEF on a worker thread and "Always acknowledge the UPDATE
  BINARY APDU immediately at the transport layer", the payer never learns the redemption result
  over NFC (`NdefUpdateBinaryHandler.processMessageAndReset`).

## 2. Android reader side

### Reader mode and flags

`NfcAdapter.enableReaderMode(Activity, ReaderCallback, int flags, Bundle extras)`: "Limit the
NFC controller to reader mode while this Activity is in the foreground. In this mode the NFC
controller will only act as an NFC tag reader/writer, thus disabling any peer-to-peer (Android
Beam) and card-emulation modes of the NFC adapter on this device. Use
`FLAG_READER_SKIP_NDEF_CHECK` to prevent the platform from performing any NDEF checks in reader
mode. Note that this will prevent the Ndef tag technology from being enumerated on the tag, and
that NDEF-based tag dispatch will not be functional. For interacting with tags that are emulated
on another Android device using Android's host-based card-emulation, the recommended flags are
`FLAG_READER_NFC_A` and `FLAG_READER_SKIP_NDEF_CHECK`."
https://developer.android.com/reference/android/nfc/NfcAdapter#enableReaderMode(android.app.Activity,%20android.nfc.NfcAdapter.ReaderCallback,%20int,%20android.os.Bundle)

Constants (same page): `FLAG_READER_NFC_A = 1`, `FLAG_READER_NFC_B = 2`, `FLAG_READER_NFC_F = 4`,
`FLAG_READER_NFC_V = 8`, `FLAG_READER_NFC_BARCODE = 16`, `FLAG_READER_SKIP_NDEF_CHECK = 128`,
`FLAG_READER_NO_PLATFORM_SOUNDS = 256` ("prevent the platform from playing sounds when it
discovers a tag"). `EXTRA_READER_PRESENCE_CHECK_DELAY` (`"presence"`): "allows the calling
application to specify the delay that the platform will use for performing presence checks on
any discovered tag" — no default is documented. `react-native-nfc-manager` passes
`readerModeDelay` (default 250) into this extra
(https://github.com/revtel/react-native-nfc-manager/blob/main/android/src/main/java/community/revteltech/nfc/NfcManager.java).
`NfcAdapter.ReaderCallback.onTagLost(Tag)` exists from API 37.

Without `FLAG_READER_SKIP_NDEF_CHECK` the platform performs its own NDEF check on discovery;
against Numo that check is itself a SELECT AID / SELECT E104 / READ sequence and triggers
Numo's `onMessageSent()` before your code runs (inference from the flag documentation plus
Numo's SELECT handler; the exact platform APDU sequence is **not verified**).

### IsoDep

- `transceive(byte[])`: "Applications do not need to fragment the payload, it will be
  automatically fragmented and defragmented … if it exceeds FSD/FSC limits. Use
  `getMaxTransceiveLength()` … This is an I/O operation and will block until complete. It must
  not be called from the main application thread. A blocked call will be canceled with
  IOException if close() is called from another thread." Throws `TagLostException` "if the tag
  leaves the field".
- `setTimeout(int)`: "The timeout only applies to ISO-DEP transceive(byte), and is reset to a
  default value when close() is called." No default value is documented on the page
  **(the 618 ms figure sometimes quoted is not verified)**.
- `connect()`: "Only one TagTechnology object can be connected to a Tag at a time."
- `isExtendedLengthApduSupported()` quoted in section 1.
  https://developer.android.com/reference/android/nfc/tech/IsoDep

### Tag dispatch stealing the tap

"Android-powered devices automatically look for NFC tags when the screen is unlocked"; the
dispatch order is `ACTION_NDEF_DISCOVERED` → `ACTION_TECH_DISCOVERED` → `ACTION_TAG_DISCOVERED`;
"Starting Android 16, scanning NFC tags that store URL links … will trigger the ACTION_VIEW
intent"; Android 17 requires `android.permission.DISPATCH_NFC_MESSAGE` on receiving activities
and "will not dispatch NFC intents to applications in a stopped state".
https://developer.android.com/develop/connectivity/nfc/nfc

Minibits' first-hand account of the consequences (comments in
https://github.com/minibits-cash/minibits_wallet/blob/master/src/screens/NfcPayScreen.tsx and
`nfcService.ts`): "Enabling reader mode is what makes our foreground session take EXCLUSIVE
control of the NFC stack and suppress the OS 'Complete action using…' chooser + other installed
wallets"; "do NOT cancelTechnologyRequest here … cancelling would disable Android reader mode
mid-payment and let the payee's still-presented HCE tag trigger the OS 'Complete action using…'
chooser over our result modal"; and for cold/warm launches "the OS already consumed the tap that
read the PR and closed that RF session, so there is NO session to write on … So we DISCARD the
pre-read text for this case and run the normal live reader flow: read PR → prepare → write back
all on ONE continuous session". Minibits uses `FLAG_READER_NFC_A | FLAG_READER_NFC_B |
FLAG_READER_NO_PLATFORM_SOUNDS` with `NfcTech.Ndef` (letting Android perform the Type 4 write),
and a 300 ms pause before re-arming after `cancelTechnologyRequest`.

### Phone-to-phone roles

The library maintainer's summary (issue #560 "Communication between 2 phones"): iOS can only be
a reader; Android can be reader or emulated tag (HCE), P2P is deprecated; "iOS to iOS: cannot
communicate … two readers cannot talk to each other"; "Android to Android: possible … but two
devices must have different roles."
https://github.com/revtel/react-native-nfc-manager/issues/560. Reader mode on the wallet
disables its own card emulation (NfcAdapter docs above), so a wallet in reader mode cannot
simultaneously present a tag. `react-native-nfc-manager` rejects `setNdefPushMessage` with
`'this api is deprecated'` (`NfcManagerAndroid.js`); the Android Beam removal itself was not
confirmed from a developer.android.com page in this pass **(not verified)**.

### Device quirks reported first-hand

- Issue #802 "Initial requestTechnology works but subsequent write attempts fail. Android 16,
  Samsung S24 ultra": reader mode crashed after the first read on One UI 8; "Appears to be fixed
  by samsung!" https://github.com/revtel/react-native-nfc-manager/issues/802
- Issue #480 "Android OS 12 issues": Pixel 6 / Samsung Flip did not discover tags until more
  reader flags were passed; the maintainer added `isReaderModeEnabled` / `readerModeFlags` in
  v3.13.2. https://github.com/revtel/react-native-nfc-manager/issues/480
- Issue #130 "Buffer size issue": a 227-byte read failed with "transceive fail" on a device
  without extended-length support; `getMaxTransceiveLength` was added.
  https://github.com/revtel/react-native-nfc-manager/issues/130
- Issue #137 "setTimeout function for transceive": long card processing produced "transceive
  fail" until `setTimeout` was exposed. https://github.com/revtel/react-native-nfc-manager/issues/137

## 3. iOS CoreNFC reader side

### Session types, limits, entitlements

- `NFCTagReaderSession` (ISO 7816/ISO 15693/FeliCa/MIFARE) vs `NFCNDEFReaderSession` (NDEF
  tags). Both: "Only one reader session of any type can be active in the system at a time. The
  system puts additional sessions in a queue and processes them in first-in, first-out (FIFO)
  order." https://developer.apple.com/documentation/corenfc/nfctagreadersession
- iPhoneOS 26.1 SDK `NFCNDEFReaderSession.h`: "An opened session has a 60 seconds time limit
  restriction after -beginSession is called; -readerSession:didInvalidateWithError: will return
  NFCReaderSessionInvalidationErrorSessionTimeout"; "Only 1 active reader session is allowed in
  the system; … NFCReaderSessionInvalidationErrorSystemIsBusy when a new reader session is
  initiated"; "NFCReaderSessionInvalidationErrorSessionTerminatedUnexpectedly when the client
  application enters the background state"; "NFCReaderErrorUnsupportedFeature when 1) reader
  mode feature is not available on the hardware, 2) client application does not have the
  required entitlement." `NFCTagReaderSession.h`: "Only one NFCReaderSession can be active at any
  time in the system. Subsequent opened sessions will get queued up and processed by the system
  in FIFO order."
- `invalidateAfterFirstRead: true` → session ends after the first successful NDEF read with
  `readerSessionInvalidationErrorFirstNDEFTagRead`; "When creating the reader session that your
  app uses to write an NDEF message to a tag, set invalidateAfterFirstRead to false."
  https://developer.apple.com/documentation/corenfc/nfcndefreadersession/init(delegate:queue:invalidateafterfirstread:)
- Entitlement `com.apple.developer.nfc.readersession.formats` (values NDEF / TAG) plus a
  non-empty `NFCReaderUsageDescription` ("You're required to provide this key if your app uses
  APIs that access the NFC hardware"; the app exits otherwise per "Building an NFC Tag-Reader
  App"). https://developer.apple.com/documentation/corenfc/building-an-nfc-tag-reader-app
- ISO 7816 AID list: "When the session discovers a compatible ISO 7816 tag, the session performs
  a SELECT command for each application identifier provided in
  com.apple.developer.nfc.readersession.iso7816.select-identifiers. The SELECT command searches
  for the identifiers in the order in which they appear in the array. The session calls the
  tagReaderSession:didDetectTags: delegate method after the first successful SELECT command."
  https://developer.apple.com/documentation/corenfc/nfciso7816tag. SDK header adds: "Tag will
  not be returned to the NFCTagReaderSessionDelegate if no application described in … is found.
  Tag must be in the connected state for NFCNDEFTag protocol properties and methods to work
  correctly." And: "If you include the application identifier D2760000850101—the identifier for
  the NDEF application on MIFARE DESFire tags (NFC Forum T4T tag platform)—and the reader session
  finds a tag matching this identifier, it sends the delegate an NFCISO7816Tag tag object."
  (NFCTagReaderSession page.)
- "When you send a SELECT command with a p1Parameter value of 0x04, your app must support one of
  the applications listed in the … select-identifiers property list key. Otherwise, the
  completionHandler receives an readerErrorSecurityViolation error."
  https://developer.apple.com/documentation/corenfc/nfciso7816tag/sendcommand(apdu:completionhandler:)
- "NFCTagReaderSession doesn't support selection of payment-related application IDs. In the
  European Union (EU), you can use NFCPaymentTagReaderSession" (NFCTagReaderSession page).

### restartPolling and reuse

"After restarting the polling sequence, the reader session sends newly detected tags to the
session's delegate … Tags detected before polling restarts are invalid. Your app should discard
any references … Calling restartPolling() on an invalidated session has no effect. If you need
to restart the reader session, create a new NFCTagReaderSession."
https://developer.apple.com/documentation/corenfc/nfctagreadersession/restartpolling()
`invalidate(errorMessage:)`: "After invalidating a reader session, you cannot use it to scan and
detect other tags." https://developer.apple.com/documentation/corenfc/nfcreadersessionprotocol/invalidate(errormessage:)

The "new session cannot start for a few seconds after invalidation" behaviour is **not
documented by Apple**. First-party evidence is community-only: issue #408 "[iOS] Request
technology sometimes fails to start" — "the shorter the time between a session is closed … and a
new session is requested … the more frequently this behaviour happens", "this only seems to
happen when the user cancels", and the adopted workaround "Block requests for X seconds".
https://github.com/revtel/react-native-nfc-manager/issues/408. Issue #721 shows a session ending
at ~20 s with `nfcd Code=47` reported as `Unexpected`
(https://github.com/revtel/react-native-nfc-manager/issues/721).

### alertMessage

"Before you call begin(), use this property to supply a string … you can update this string in
any thread context while the reader session remains valid."
https://developer.apple.com/documentation/corenfc/nfcreadersessionprotocol/alertmessage. No
length limit is documented **(not verified)**.

### sendCommand and Le

`NFCISO7816APDU(instructionClass:instructionCode:p1Parameter:p2Parameter:data:expectedResponseLength:)`:
Le "should be one of the following: A length between 1 and 65536 inclusively. –1 when you expect
no response data. 256 to send 00 as the short Le field value, assuming the data field is less
than 256 bytes. 65536 to send 0000 as the extended Le field." Lc is derived from `data`. "If your
app needs more precise control of the APDU format, use init(data:)."
https://developer.apple.com/documentation/corenfc/nfciso7816apdu/init(instructionclass:instructioncode:p1parameter:p2parameter:data:expectedresponselength:)
Response: "responseData: The response data, which may be empty even if the operation completes
successfully. sw1 … sw2 … always valid. error: nil when the operation completes successfully;
otherwise, an NSError object when there's a communication issue with the tag." So a `6A 82`
arrives as `(empty, 0x6A, 0x82, nil)`, not as an error.

### Error codes (iPhoneOS 26.1 `NFCError.h`, values confirmed)

`UnsupportedFeature = 1`, `SecurityViolation = 2`, `InvalidParameter`, `InvalidParameterLength`,
`ParameterOutOfBound`, `RadioDisabled`, `Ineligible` (iOS 26), `AccessNotAccepted` (iOS 26);
`TransceiveErrorTagConnectionLost = 100`, `RetryExceeded = 101`, `TagResponseError = 102` ("Tag
response is invalid or tag does not provide a response"), `SessionInvalidated = 103`,
`TagNotConnected = 104`, `PacketTooLong = 105` ("Packet length has exceeded the limit");
`SessionInvalidationErrorUserCanceled = 200`, `SessionTimeout = 201`,
`SessionTerminatedUnexpectedly = 202`, `SystemIsBusy = 203`, `FirstNDEFTagRead = 204`;
`TagCommandConfigurationErrorInvalidParameters = 300`; NDEF errors 400–403.
Listing page: https://developer.apple.com/documentation/corenfc/nfcreadererror-swift.struct/code

### Background tag reading

iPhone XS and later; "the system inspects the tag's NDEF message for a URI record … typeNameFormat
equal to nfcWellKnown, type equal to 'U' … The URI record must contain either a universal link or
a supported URL scheme"; "Background tag reading doesn't support custom URL schemes. Use universal
links instead."; unavailable when "A Core NFC reader session is in progress", Wallet or camera in
use, airplane mode, or never unlocked.
https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading
Consequence: a `creq…` Text record, or a `cashu:` URI, will never background-launch Sovran on iOS.

### iOS cannot emulate a tag for a reader wallet, except via `CardSession`

`CardSession` "supports host card emulation (HCE) transactions … in the European Economic Area
(EEA)"; "Card emulation is valid for up to 60 seconds from the startEmulation() call"; requires
`com.apple.developer.nfc.hce` and `com.apple.developer.nfc.hce.iso7816.select-identifier-prefixes`
("If your app lacks a required entitlement, init() raises fatalError"); "Use of this entitlement
is managed by Apple." https://developer.apple.com/documentation/corenfc/cardsession
Apple's support page: "iOS 17.4 or later includes APIs that support contactless transactions …
Users based in the European Economic Area (EEA) with an iPhone running iOS 17.4 or later can
initiate in-person NFC transactions", developers outside the EEA can test with "iOS 18.2 or
later", and "Device-to-Device transactions" is a listed use case.
https://developer.apple.com/support/hce-payment-transactions-in-payment-apps/
Macadamia implements exactly this (section 7).

### "Tag connection lost" first-hand accounts

Apple Developer Forums thread 765855 ("NFC (ISO7816)- Tag Connection Lost IPhone 15 & 16
variants"): DTS asked for sysdiagnose and a Feedback report and gave no root cause; a participant
reported "iOS 18.1 beta 7 … appears to have resolved this issue".
https://developer.apple.com/forums/thread/765855. Thread 118499: no Apple response; community
observations that failure likelihood grows with "The Size of the APDU Command … and the Size of
the APDU Response" and "The number of APDU Command/Response pairs you are sending … in a single
Session". https://developer.apple.com/forums/thread/118499. Library issue #358 was closed as a
hardware fault on a refurbished iPhone 7
(https://github.com/revtel/react-native-nfc-manager/issues/358).

## 4. `react-native-nfc-manager` specifics

Version notes (README): "`v3` only supports legacy architecture (`v3.x.y`). `v4` supports new
architecture (`v4.0.0-beta.x`)." Latest release v3.17.2 (2025-11-28). iOS setup: enable the NFC
capability, add `NFCReaderUsageDescription`, and "if writing ISO7816 tags add application
identifiers (aid) into your info.plist" with the example `D2760000850100` / `D2760000850101`.
Android: `<uses-permission android:name="android.permission.NFC" />`, and `compileSdkVersion`
31+ since v3.11.1 (PendingIntent mutability).
https://github.com/revtel/react-native-nfc-manager/blob/main/README.md

### API surface (from `index.d.ts` and `src/`)

- `requestTechnology(tech | tech[], options?: RegisterTagEventOpts)` where `RegisterTagEventOpts =
  { alertMessage?, invalidateAfterFirstRead?, isReaderModeEnabled?, readerModeFlags?, readerModeDelay? }`;
  defaults `{ alertMessage: 'Please tap NFC tags', invalidateAfterFirstRead: false,
  isReaderModeEnabled: false, readerModeFlags: 0, readerModeDelay: 250 }` (`NfcManager.js`).
- `cancelTechnologyRequest({ throwOnError = false, delayMsAndroid = 1000 })`. On Android, if
  `requestTechnology` had to register the tag event itself, cancel waits `delayMsAndroid` and then
  `unregisterTagEvent()` (`NfcManagerAndroid.js`).
- `isoDepHandler.transceive(bytes: number[])` → `number[]`. On Android the bytes go straight to
  `IsoDep.transceive` with no chunking and any exception becomes the string `"transceive fail"`
  (`NfcManager.java`, `ERR_TRANSCEIVE_FAIL`; the `TagLostException` distinction is lost). On iOS it
  calls `sendCommandAPDUBytes`, which builds the APDU with `initWithData:` (raw bytes, your Le
  byte is used verbatim) and resolves `[...response, sw1, sw2]` ("TODO: make following data the
  same format as Android", `IsoDepHandler.js`, `ios/NfcManager+IsoDep.m`). `sendCommandAPDUIOS`
  additionally accepts `{cla, ins, p1, p2, data, le}` and uses `expectedResponseLength: le`.
- `setAlertMessageIOS`, `invalidateSessionIOS`, `invalidateSessionWithErrorIOS(msg)`,
  `restartTechnologyRequestIOS()` (re-arms the pending callback on the same session via
  `restartPolling`, no new sheet), `isTagSessionAvailableIOS()`.
- `setEventListener(name, cb)` throws `'no such event'` for unknown names and stores **one**
  callback per event (`this._clientListeners[name] = callback`). `NfcEvents.SessionClosed` is
  only subscribed on iOS; `StateChanged` only on Android. On iOS `SessionClosed` receives `null`
  for user cancel and an `NfcError` otherwise (`_onSessionClosedIOS`).
- Android only: `setTimeout`, `getTimeout`, `getMaxTransceiveLength`, `connect`, `close`,
  `getLaunchTagEvent`, `getBackgroundTag`/`clearBackgroundTag` (`DiscoverBackgroundTag`).

### Native behaviour worth knowing

iOS (`ios/NfcManager.m`):
- `requestTechnology` creates an `NFCTagReaderSession` with `NFCPollingISO14443 |
  NFCPollingISO15693` (+ISO18092 for FeliCa) on the main queue and returns `"Duplicated
  registration"` if any session object still exists.
- In `didDetectTags`, if `connectToTag` fails the module logs "restarting polling", calls
  `restartPolling`, and **does not reject** the pending promise.
- `didInvalidateWithError` rejects the pending `requestTechnology` with the error string, resets
  state, and emits `NfcManagerSessionClosed` with `{error}`.
- Error strings are `"<domain>:<code>,<underlying domain>:<code>"` (issue #268 "unknown error"
  when user cancels … merged in 2.1.4), parsed by `buildNfcExceptionIOS` into `NfcError.*`
  classes keyed on `NFCError:<code>` (`NfcError.js`).
- `registerTagEvent` (not `requestTechnology`) uses `NFCNDEFReaderSession`, which only detects
  NDEF-formatted tags (issue #431 "[iOS] requestTechnology works, registerTagEvent doesn't";
  maintainer: "we do recommend using requestTechnology", issue #529).

Android (`android/.../NfcManager.java`, `TagTechnologyRequest.java`):
- `requestTechnology` fails with `"you should requestTagEvent first"` if not registered and
  `"You can only issue one request at a time"` if a request is pending; the JS wrapper
  auto-registers when needed.
- `registerTagEvent` reads `isReaderModeEnabled`, `readerModeFlags`, `readerModeDelay`; reader
  mode is re-enabled in `onHostResume` when `isForegroundEnabled`.
- `TagTechnologyRequest.connect` tries requested techs in order and swallows `connect()`
  exceptions ("fail to connect tech"), returning `false`.
- `cancelTechnologyRequest` rejects the pending callback with `"cancelled"` (→ `NfcError.UserCancel`).

### Issues to know by number

- #57 "Not able to scan tag again after canceling on ios." — must unregister after a closed
  session before registering again.
- #268 "'unknown error' when user cancels technology request on iOS" — structured error strings.
- #385 "Handling IOS Cancel Button" / #544 "How to determine if scanning is canceled and not
  failed" — check `ex instanceof NfcError.UserCancel`; a commenter notes catch is sometimes not
  called on cancel/timeout in newer versions.
- #389 "SessionClosed is not accurate and results in Duplicate registration error" — track an
  active-session ref, wait for `SessionClosed` before re-requesting.
- #408 "[iOS] Request technology sometimes fails to start." — see section 3.
- #603 "Read Android HCE from iPhone" — "Missing required entitlement" with IsoDep against an
  Android HCE peer; unresolved in-thread (the AID list is the usual cause, section 3).
- #677 "ISO 14443-4 not reading in IOS" — `getTag()` empty / "Not connected" on IsoDep until the
  correct AID is listed.
- #708 "SecurityViolation error with isoDepHandler.transceive" — `NFCError:2` on iOS 17.x with
  `D2760000850100/01` listed; unresolved.
- #721 "Session sometimes closes itself" — ~20 s termination reported as `Unexpected`.
- #763 "Host Card Emulation" — HCE not in the library; PR #770 stalled; the maintainer points to
  https://github.com/icedevml/react-native-host-card-emulation.
- #768 "Session is auto closed and app stops listening to DiscoverTag events" — the 60 s limit.
- #802, #480, #130, #137, #358, #364 ("transceive fail - Tag was lost." on NfcV) — sections 2–3.

## 5. NDEF specifics

### Record layout

The library's `ndef-lib/ndef.js` encodes the header byte as `tnf | MB 0x80 | ME 0x40 | CF 0x20 |
SR 0x10 | IL 0x08`, then type length (1 byte), payload length (1 byte if SR else 4 bytes
big-endian), optional id length, type, id, payload. SR is chosen when `payload.length < 0xff`
and the encoder has `cf = false // chunkFlag TODO implement`; the decoder stops at the first
record with ME set. https://github.com/revtel/react-native-nfc-manager/blob/main/ndef-lib/ndef.js
Constants: `TNF_WELL_KNOWN 0x01`, `TNF_MIME_MEDIA 0x02`, `TNF_ABSOLUTE_URI 0x03`,
`TNF_EXTERNAL_TYPE 0x04`, `TNF_UNCHANGED 0x06`, `RTD_TEXT 'T' (0x54)`, `RTD_URI 'U' (0x55)`
(`ndef-lib/constants.js`).

Android: `TNF_UNCHANGED` "Indicates the payload is an intermediate or final chunk of a chunked
NDEF Record … cannot be used with this class since all NdefRecords are already unchunked"; the
`NdefRecord(short, byte[], byte[], byte[])` constructor validation "is specified by
NFCForum-TS-NDEF_1.0 section 3.2.6 (Type Name Format)"; `TNF_EXTERNAL_TYPE` "should not be used
with RTD_TEXT or RTD_URI constants"; `createUri` "Uses the well known URI type representation:
TNF_WELL_KNOWN and RTD_URI. This is the most efficient encoding of a URI into NDEF."
https://developer.android.com/reference/android/nfc/NdefRecord

### Why chunked records break the terminals

Numo's `NdefMessageParser.parseNdefRecord` reads only the first record, requires
`typeLength == 1` and either (`TNF_WELL_KNOWN`, `'T'`), (`TNF_WELL_KNOWN`, `'U'`) or
(`TNF_MIME_MEDIA`, `application/octet-stream` for a binary token), and ignores the CF flag; a
chunked first record would yield a truncated payload and "No Cashu token found". Macadamia's
`parseNDEFFile` is the same shape (`guard typeLength == 1`). Sources: Numo
`NdefMessageParser.java`, Macadamia `NFCRequestEmulation.swift`.

### URI record identifier code

Numo `NdefUriProcessor.getUriPrefix`: `0x00 → ""` ("No prefix"), `0x01 http://www.`,
`0x02 https://www.`, `0x03 http://`, `0x04 https://`, … `0x23 urn:nfc:`. The library's
`RTD_URI_PROTOCOLS[0] === ''`. **Macadamia only maps `0x00`–`0x04`** and treats every other
code as an empty prefix. So for a Cashu URI/token in a `U` record use code `0x00` with the full
string, or `0x04` for an `https://…` URL.

### Text record

Numo and Macadamia write `[status = len("en")]["en"][UTF-8 text]` with `0xD1 01 <len> 54` (SR)
or `0xC1 01 <4-byte len> 54` (long); on receipt they compute `languageCodeLength = status &
0x3F` and decode UTF-8 unconditionally (UTF-16, status bit 7, is not handled). Write UTF-8 only.

### Practical max NDEF payload

See section 1: 2-byte NLEN; Numo advertises 28,671 and buffers 65,536; AOSP caps a v2.0 file at
`0x7FFF`; Minibits refuses payloads over 32,000 bytes.

### Cashu URI schemes and where `creq` goes

- NUT-18 defines the bare string `"creq" + "A" + base64_urlsafe(CBOR(PaymentRequest))`
  (https://github.com/cashubtc/nuts/blob/main/18.md, "Encoded Request").
- NUT-26 defines `"creqb" + "1" + bech32m(TLV(PaymentRequest))` and a BIP-321 carrier:
  "NUT-26 payment requests can be included in BIP-321 Bitcoin URIs using the `creq` query
  parameter" (https://github.com/cashubtc/nuts/blob/main/26.md).
- Numo's emitted Text record is one of `bitcoin:?creq={bech32}&lightning={bolt11}`, a raw
  `creqA…`, or `lnbc…` (payer spec 4.2); its parser also accepts `creqb` case-insensitively
  (`isCashuPaymentRequest`).
- The closed PR #240 proposed an `ndef` transport with tag `[["r", "text"]]` — "Currently,
  `"text"` is the only option" — i.e. a Text record, not a URI record
  (https://github.com/cashubtc/nuts/pull/240).
- No NUT in the fetched `cashubtc/nuts` tree defines a `cashu:` or `web+cashu://` URI scheme;
  guidance for embedding `creq` in a URI versus a Text record is therefore **not defined in a
  primary spec (not verified)** beyond NUT-26's BIP-321 parameter and Numo's Text-record
  practice.

## 6. NUT-18 encoding, transports and "no transport"

Spec text (https://github.com/cashubtc/nuts/blob/main/18.md):

- Fields: `i` payment id, `a` amount ("net of input fees"), `u` unit ("MUST be set if `a` or `sm`
  is set"), `s` "Whether the payment request is for single use", `m` mint list, `mp` "Whether
  the mint list is advisory (`true`) or strict (`false` or omitted)", `sm` supported methods with
  optional per-method fee `mf`, `d` description, `t` transports "(can be multiple, sorted by
  preference)", `nut10` locking condition.
- Transports: `nostr` (target `<nprofile>`, tags `[["n","17"]]`, NIP-17 DM carrying a
  `PaymentRequestPayload`) and `post` (target endpoint URL, POST body `PaymentRequestPayload`).
- "The transport can be empty! If the transport is empty, we implicitly assume that the payment
  will be in-band. An example is X-Cashu where the payment is expected in the HTTP header of a
  request. We can only hope that the protocol you're using has a well-defined transport."
- Payload: "If not specified otherwise, the payload sent to the receiver is a
  `PaymentRequestPayload` JSON serialized object" `{id?, memo?, mint, unit, proofs}`.
- Input fees: "the payer MUST select proofs such that `sum(proofs) - input_fee(proofs) >= a + mf`".
- Encoding: `"creq" + "A" + base64_urlsafe(CBOR(PaymentRequest))`.

NUT-26 (bech32m/TLV, `creqb1…`): "When parsing a `creq` parameter, implementations SHOULD support
both formats: 1. If the parameter starts with `creqA` (case-insensitive), parse as NUT-18 …
2. If the parameter is valid Bech32m with HRP `creqb`, parse as NUT-26"; "If no transport is
specified (tag 0x07 is absent), the payment is assumed to be in-band, consistent with NUT-18
semantics." NUT-24 (HTTP 402) now says "Wallets **MUST** support both formats" (PR #393
"nut24(402 payments): explicitly allow creqB payment requests", closing issue #392).

History relevant to NFC in `cashubtc/nuts`:
- PR #240 "Add NFC Payment Requests" (opened 2025-03-24, **closed** 2025-04-15) added an `ndef`
  transport. Reviewer comment: "#243 adds 'The transport can be empty! …' … I wonder if having
  an empty transport makes more sense than adding a new transport … if the transport field was
  empty the payer would know to send the token back in the same way that the request was
  received." Author: "Yes. It sounds right." https://github.com/cashubtc/nuts/pull/240
- PR #248 "NUT-18: Add optional `nut10` options and transport field" (merged 2025-06-12) made
  `t` optional. https://github.com/cashubtc/nuts/pull/248
- PR #294 added NUT-26; PR #381 "NUT-18: Payment request consolidation (and extra fees for
  non-preferred mints)" (merged 2026-07-21) added `mp`, `sm`/`mf`, and the net-of-input-fees
  rule. https://github.com/cashubtc/nuts/pull/381
- Searches of `cashubtc/nuts` issues and PRs for "NFC", "creqB", "payment request version",
  "in-band" and "offline transport" (via `gh search`/`gh issue list` on 2026-09-26) returned no
  open proposal for a payment-request v2 or an NFC-specific transport beyond the items above.

Implementation notes: cashu-ts `PaymentRequest.fromEncodedRequest` accepts `creqb` with an exact
HRP and `creq` + version `a` case-insensitively, throwing `'unsupported pr version'` otherwise
(https://github.com/cashubtc/cashu-ts/blob/main/src/model/PaymentRequest.ts). Numo
`stripTransports` re-encodes the request as `creqA` **without** `t` before emulating it
(`CashuPaymentHelper.kt`), and Minibits writes a token back "only if no transport methods
specified (POS device)" (`NfcPayScreen.tsx`). Minibits issue #184 "Paying of cashu payment
request between 2 Minibits wallets fails": "Only working scenario for now is to read cashu PR
that dows not have transport defined and is paid by writing the cashu token back to the NFC
device issuing the PR - such as Numo POS application." (fixed in 0.3.4-beta.13 by honouring
transports). https://github.com/minibits-cash/minibits_wallet/issues/184

The NFC path therefore deviates from the NUT-18 payload: what goes over the wire is a token
string (`cashuA`/`cashuB`/`crawB`, or a URL containing `token=cashu…`), not the
`PaymentRequestPayload` JSON, so `i` and `memo` are not carried back.

## 7. First-party accounts of NFC ecash flows

### Numo (Android POS, HCE)

- README: "a type-4 forum tag is emulated with a cashu PaymentRequest string as its content …
  the paying wallet will write a cashu token with the requested amount to the emulated tag and
  Numo will process it." Requirements: "NFC hardware with Host Card Emulation (HCE) support".
  https://github.com/cashubtc/Numo/blob/main/README.md
- Wire protocol: `docs/NDEF_Payer_Side_Spec.md` (quoted throughout sections 1 and 5). Token
  extraction accepts `cashuA`/`cashuB`/`crawB` prefixes, `#token=cashu…`, `token=cashu…`, or the
  first `cashu…` substring terminated by whitespace or one of `" ' < > & #`.
- Manifest: service exported with `android.permission.BIND_NFC_SERVICE`, `aid_list.xml`; the
  legacy `apduservice.xml` still lists a Satocash AID.
- Issue #344 "NFC listener stays active on 'Payment Received'/error/processing screens —
  re-tapped ecash is silently swallowed (fund loss)" (closed): "a customer wallet that taps a
  second time (many wallets auto-resend …) will transmit a second ecash token. That second
  token is then silently swallowed: it hits an early-return guard, is logged, and is dropped
  without being redeemed". The current code calls `clearHceService()` inside
  `beginTerminalOutcome` ("Immediately stop/clear NFC/HCE service to prevent paying wallets from
  attempting again"), and `onCashuTokenReceived` still drops tokens while
  `isProcessingNfcPayment` is true. https://github.com/cashubtc/Numo/issues/344
- "Payment request already paid": there is no explicit signal; after a terminal outcome
  `clearPaymentRequest()` sets write mode off, so `SELECT E104` answers `6A 82` and any UPDATE
  BINARY before a SELECT fails the `selectedFile != null` check.
- Mint list semantics (spec 4.3): with "Accept payments from unknown mints" enabled Numo omits
  `m` because "some paying wallets interpret an explicit `mints` list as a strict requirement".

### Minibits (React Native, same library)

`nfcService.ts` and `NfcPayScreen.tsx` (quoted in section 2): reader mode with
`NFC_A | NFC_B | NO_PLATFORM_SOUNDS`, `NfcTech.Ndef` plus `ndefHandler.writeNdefMessage`,
session kept alive after the write, cold-launch pre-read discarded in favour of one live
session, `getLaunchTagEvent` / `DiscoverBackgroundTag` for OS-dispatched taps, 32,000-byte
payload cap, and on iOS "a fresh requestTechnology would reopen the CoreNFC scan sheet, so iOS
re-arms only on screen focus". Minibits also patches `react-native-hce` to call
`CardEmulation.setPreferredService` because the NDEF AID "is also registered by other tag/wallet
apps (Numo, Google Pay 'embedded tag') … the OS … shows the 'Select an app to use'
disambiguation dialog on this (the emulating) device, which collapses the RF session and fails
the read" (`patches/react-native-hce+0.3.0.patch`) — relevant if Sovran ever emulates.

### Macadamia (iOS, `CardSession`)

`NFCRequestEmulation.swift`: "Card emulation requires the HCE entitlement on iOS 17.4 or later
and is currently limited to the European Economic Area. The wire protocol mirrors Numo's
implementation exactly". Behaviour a reader should expect: SELECT AID accepts any AID that
starts with `D2760000850101`, over-length READs get `6A 82`, "requestRead" is signalled when
`offset + length == file.count`, on `readerDeselected` it keeps emulating "so the payer can
simply tap again", and on a valid token it calls `stopEmulation(status: .success)` and
`invalidate()` — a second write after success finds no tag. Session end reasons
`userInvalidated`, `maxSessionDurationReached`, `emulationStopped`, `invalidated` are treated
as normal. The README roadmap lists "NFC payments on iPhone feasibility testing" and an
"AirNut" BLE alternative "to the very restricted APIs for NFC on Apple devices" (seen in a
search snippet of https://github.com/zeugmaster/macadamia; not re-read in full).

### cashu.me, eNuts, nutshell, cdk, Boardwalk

- cashu.me reads via Web NFC (`new window.NDEFReader()` in `src/stores/receiveTokensStore.ts`);
  issue #306 "implement native NFC for iOS/Android via a Capacitor NFC plugin" is open with no
  design notes. https://github.com/cashubtc/cashu.me/issues/306
- eNuts: #254 "Near Field Communication to share token" (open, motivation: tokens too big for
  QR) and #361 "[Feature Request] support for NFC payments" (closed as duplicate); no
  implementation. https://github.com/cashubtc/eNuts/issues/254
- `cashubtc/nutshell` and `cashubtc/cdk`: code search for "NFC" found no NFC transport code.
- Boardwalk (`boardwalkcash`): no repository was found via `gh search repos`.

### `react-native-nfc-manager` maintainer on roles

Issue #560 table (section 2) and #763: "When users develop a HCE based app, they normally need a
corresponding reader side app."

## Checklist for Sovran

Each item is phrased so it can be verified by a test or a log assertion.

**Session and platform setup**
1. iOS `Info.plist` lists `D2760000850101` **first** in
   `com.apple.developer.nfc.readersession.iso7816.select-identifiers` (Numo answers `6F 00` and
   Macadamia `6A 82` to `D2760000850100`, costing an extra APDU when it is listed first); the
   `formats` entitlement contains `TAG`; `NFCReaderUsageDescription` is non-empty. Test: on iOS
   the tag object's `initialSelectedAID === 'D2760000850101'`.
2. Android `requestTechnology(NfcTech.IsoDep, { isReaderModeEnabled: true, readerModeFlags:
   FLAG_READER_NFC_A | FLAG_READER_SKIP_NDEF_CHECK | FLAG_READER_NO_PLATFORM_SOUNDS })`. Test:
   Numo's log shows the app's own `SELECT` sequence and no platform NDEF check before it.
3. One live session covers read → prepare token → write. Never `cancelTechnologyRequest`
   between the read and the write; on Android keep reader mode until the result UI is
   dismissed (Minibits' rule). Test: after a successful pay, no "Complete action using…" chooser
   appears while the terminal is still presenting.
4. Wrap `requestTechnology` in an app-level timeout below 60 s (iOS hard limit) and treat the
   iOS `connect` failure path (library silently `restartPolling`s) as a retry, not a hang. Test:
   with the terminal removed mid-handshake the promise settles within the timeout.
5. After any `SessionClosed`/cancel on iOS, wait for the `SessionClosed` event **and** a
   1–2 s back-off before calling `requestTechnology` again; treat `"Duplicated registration"` as
   retryable. Test: cancel then immediately re-tap 20 times in a row without a stuck sheet.
6. Classify errors explicitly: `NfcError.UserCancel` (iOS 200 / Android `"cancelled"`),
   `Timeout` (201), `TagConnectionLost` (100), `TagResponseError` (102), `SessionInvalidated`
   (103), `PacketTooLong` (105), `SecurityViolation` (2 → AID/entitlement misconfiguration), and
   Android's flat `"transceive fail"`. Test: each maps to a distinct UI copy and log tag.
7. Cold-launch / OS-dispatched taps (Android `getLaunchTagEvent`, `DiscoverBackgroundTag`): do
   not try to write back on the consumed session; prompt for a fresh tap and run the full
   live flow (Minibits' finding). iOS background reading will never launch Sovran for a
   `creq` Text record, so do not depend on it.

**APDU layer**
8. Sequence: `00 A4 04 00 07 D2760000850101 00` → expect `90 00`; `00 A4 00 0C 02 E1 03` and
   `00 B0 00 00 0F` → parse CCLEN, mapping version, MLe, MLc, NDEF file id and max size; reject
   MLe < 15 or MLc < 1 or a max size > `0x7FFF` (AOSP rules); `00 A4 00 0C 02 <file id>`
   (use the id from the CC, not a hard-coded `E1 04`); `00 B0 00 00 02` → NLEN; then READ
   BINARY chunks of `min(remaining, MLe)` starting at offset 2 until `NLEN` bytes are read.
   Test: no READ ever requests bytes beyond `NLEN + 2` (Macadamia would answer `6A 82`).
9. Never send `Le = 00` and never assume 256-byte responses; on Android also cap chunks at
   `getMaxTransceiveLength()` and check `isExtendedLengthApduSupported()` before anything over
   255 data bytes. Test: run against a CC advertising MLe = 59 with a 2 KB request.
10. Write with AOSP's order: `00 D6 00 00 02 00 00` → `90 00`; body chunks of at most MLc bytes at
    offsets ≥ 2 → each `90 00`; then `00 D6 00 00 02 <NLEN>` → `90 00`. Ensure the NDEF file
    is still the selected file (re-SELECT `E1 04` if any error occurred in between). Test: Numo
    log shows "Received zero-length NDEF message header" then "Length header updated and there
    appears to be data already in buffer. Processing message."
11. Map status words: `90 00` ok; `6A 82` on `SELECT E104` = terminal has no armed request
    (already paid, cancelled, or not ready) → stop and tell the user; `6A 82`/`6700`/`6B00` on
    READ = adjust offset/Le, do not retry blindly; `6F 00` = terminal exception. Test: after
    Numo reaches "Payment Received", a re-tap yields `6A 82` on SELECT and Sovran shows
    "request no longer active" without sending a token.
12. Keep the total exchange small: prefer `cashuB` with the fewest proofs, target ≤ 1 KB, hard
    cap at 32,000 bytes (Minibits), and log APDU count and bytes per session to correlate with
    "Tag connection lost".

**NDEF layer**
13. Write exactly one record, `TNF_WELL_KNOWN` + `'T'` with status byte `0x02`, language `en`,
    UTF-8 body, SR when payload ≤ 255 else the 4-byte length form, MB=ME=1, CF=0, no id. If a
    URI record is ever used, identifier code `0x00` (or `0x04` for `https://`), never other
    prefix codes (Macadamia maps only `0x00`–`0x04`). Test: Numo `NdefMessageParser` log shows
    "Is Text Record: true".
14. Parse the terminal's first record only if `typeLength == 1` and type is `T` or `U`; reject
    CF-flagged records; accept `creqA…`, `creqb1…` (case-insensitive) and `bitcoin:?creq=…`
    with a `lightning=` fallback; decode URI prefix codes with the full 0x00–0x23 table.

**Payment semantics**
15. Only write a token back when the decoded request has **no** transport; if `t` is present,
    pay over that transport instead (NUT-18 "empty transport … in-band"; Minibits #184).
16. Honour `m`/`mp` strictness, `u`, `sm`/`mf`, and the net-of-input-fees rule
    (`sum(proofs) - input_fee(proofs) >= a + mf`) before building the token; Numo may omit `m`
    on purpose.
17. Treat `90 00` on the final NLEN write as "delivered, unconfirmed": persist the sent proofs
    as pending, never auto-resend the same or a fresh token on a re-tap while the previous send
    is unconfirmed, and reconcile by checking proof state with the mint (NUT-07) after the
    session closes. Test: a forced second tap after success produces no second token on the
    wire.
18. Because the token carries no `i`/memo, keep the request id, amount and mint locally and bind
    the pending transaction to them for history and support.
19. If the write fails after NLEN = 0 was written (tag lost mid-body), do not assume the terminal
    saw nothing: Numo's 3 s partial-message timeout may still process what arrived, so
    reconcile with the mint before re-issuing proofs.
20. Do not attempt to emulate a tag from the wallet on iOS unless Sovran obtains the
    `com.apple.developer.nfc.hce` entitlement (EEA users, 60 s emulation limit); on Android, a
    wallet in reader mode cannot also present a tag.

## Sovran findings (2026-09-26)

Evidence from `app/log.txt` (20 iOS taps against numo on 2026-09-26), the numo
source at `../../numo`, the cashu-ts source at `../../cashu-ts`, and the NUT-18
and NUT-26 specs in `../../nuts`.

### What numo actually puts on the tag

- numo is Android-only. It emulates an NFC Forum Type 4 Tag with Android HCE
  (`HostApduService`, AID `D2760000850101`, files E103/E104). There is no
  iOS or web build and it does not use cashu-ts; requests are hand-built CBOR
  and tokens are parsed with CDK 0.18.0-rc.0.
- The outgoing NDEF message is always **one Text record** (`T`, `en`, UTF-8),
  never a URI or MIME record, no `cashu:` prefix.
- The text depends on the numo tab:
  - Unified (the default): `bitcoin:?creq=<CREQB1…>&lightning=<bolt11>`. The
    request is the NUT-26 bech32m form, with a `creqA` fallback.
  - Cashu: bare `creqA…` with transports stripped.
  - Lightning: bare `lnbc…` (the README's `lightning:` prefix is not added).
- Request fields are `i`, `a`, `u`, `d`, `s`; `m` only when "Accept payments
  from unknown mints" is **off**. No `t`, no `nut10`, no `sm`, no `mp`.
- Token return is UPDATE BINARY on the same E104 file. numo accepts a Text,
  URI (`cashu:` with prefix code 0x00) or `application/octet-stream` (`craw`)
  record; `cashuB` V4 tokens are fine. It validates unit equality and
  `token face value >= amount` only; it does not subtract input fees.
- numo's CC advertises MLe 59 / MLc 52 but enforces neither; READ BINARY
  clamps at end-of-file; only short APDUs (1-byte Lc/Le).
- **Timing.** HCE idle timeout 3.5 s between APDUs (reset per APDU), and an
  activity safety timeout of **5 s from the overlay appearing until a token
  arrives**. After it fires, numo clears the service and SELECT E104 answers
  `6A82`. A wallet whose token creation needs a network swap is racing this.
- After a terminal outcome numo tears HCE down (`6A82`), so a second read of
  the same tag is a clean "nothing to read", not a replay.
- Once the token is written numo answers `90 00` immediately and processes on
  a background thread: **the wallet never learns over NFC whether the
  payment was accepted.**

### What the log showed

| Observation | Count |
| --- | --- |
| Taps that acquired a session and read a record | 20 |
| NDEF parse failures | 0 |
| Payment-request decode failures | 0 |
| Ecash write-backs attempted | 3 |
| Ecash write-backs that reached the tag | 1 |

Every read decoded. The failures were all on the write side, before any byte
was written:

```
effects.nfcWriteBack.failed  hasPreparedSend=false
  error="This payment request needs a mint without ecash redemption fees.
         Choose another mint or ask for a Lightning invoice."
popup  "NFC Write Failed"
```

The chain: numo was in "accept unknown mints" mode, so the request had no `m`
→ the wallet auto-picked its highest-balance mint → that mint's keysets charge
input fees → `assertPaymentRequestFeesSupported` refused (NUT-18 amounts are
net of input fees and Coco's send cannot add them) → the session was released
and the user saw "NFC Write Failed" for a token that never existed. The one
tap that paid carried `m` with four mints, one of which the wallet holds fee-free.

Two unrelated things the same log surfaced:

- One melt confirm failed with `MeltOperation with id … not found` (Coco
  operation lookup, not NFC). Not investigated here.
- The mint pill on the Send Lightning preview re-ran the NFC auto-resolver
  (fixed earlier today: the resolver now runs only for the scan's own EXECUTE).

### "unsupported pr version" in other wallets

Upstream cashu-ts throws that exact string when a request starts with `creq`
and the next character is neither `A` nor `B`; before v3.3.0 (2025-12-18) it
also threw it for every `creqB`. numo's default Unified tab sends the NUT-26
`CREQB1…` form. A wallet on an older cashu-ts (or any decoder without NUT-26)
fails numo's default tag with precisely that message. Sovran's pinned
`5.0.0-rc.4` decodes creqB; the failure is other wallets', not ours.

### Where Sovran is exposed

1. **Pinned cashu-ts `5.0.0-rc.4` plus a local patch that throws on `sm`**
   (`app/patches/@cashu+cashu-ts+5.0.0-rc.4.patch`: "unsupported pr: payment
   method constraints"). NUT-18 added `mp`/`sm` on 2026-07-21; rc.11
   (2026-09-22) supports both natively. A newer POS that sets `sm` is
   unreadable by Sovran today. numo does not set it yet.
2. **Uppercase `CREQA…`** fails in rc.4 with "invalid prefix"; fixed upstream
   in `929efa14` (rc.10). BIP321 URIs are sometimes upper-cased for QR
   alphanumeric mode.
3. **Unknown NUT-26 transport kinds** throw in rc.4 (`Unsupported transport
   kind`); fixed only in unreleased `37210ce7`.
4. **The 5 s numo budget.** The one successful tap spent 2.6 s creating the
   token (network swap) and 1.2 s writing, 3.8 s total. Anything slower loses.

### What changed in this pass

- `wallet/src/machine/createMachine.ts`: the NFC auto-resolver asks each
  candidate mint whether it can pay the request (`paymentRequestPayabilityFrom`,
  a local keyset read) before choosing it, both at `selectMint` and in front
  of the write-back when the resolver skipped the picker. Refused mints are
  excluded from re-selection. When no mint qualifies and the tag also carried
  a Lightning invoice, the resolver restores the option step and chooses the
  invoice (the melt preview follows, as for an invoice-only tag). With nothing
  else on the tag the error step carries the fee reason instead of a picker
  whose rows would all fail.
- `wallet/src/mint-selection.ts`: among funded candidates, a mint whose local
  proofs compose the amount exactly (no swap) ranks first; the spec-ordered
  preferences (terminal's `m`, fundedness) still come before it.
- `wallet/src/machine/effects.ts` + app: the write-failed notification carries
  `stage: 'prepare' | 'write'`; the app titles a prepare-stage failure
  "Payment not sent" instead of "NFC Write Failed".
- `app/shared/lib/nfc/ndef.ts`: the reader now accepts URI (`U`, prefix
  codes expanded), MIME and NFC-external records and records with an ID
  field, reads only the first record, and rejects chunked records explicitly.
- `app/shared/lib/nfc/write-token.ts`: the standalone tag writer reads the
  Capability Container, refuses read-only tags and tokens larger than the
  NDEF file before touching NLEN, and honours the tag's MLc. **Deliberate
  deviation from checklist items 8–9:** the POS adapter keeps 240-byte READ and
  UPDATE chunks against a terminal. numo advertises MLe 59 / MLc 52 and
  enforces neither (`NdefApduHandler.java`, `NdefUpdateBinaryHandler.java`),
  the 20 logged taps all read 300–630-byte files in 240-byte chunks, and at
  the ~170 ms per APDU numo's HCE showed, 52-byte chunks would add ~2 s to a
  5 s budget. Revisit if a terminal that enforces MLc (Macadamia is a
  candidate) is tested; the reader never over-reads (`READ` is sized from
  NLEN), so item 8's `6A 82` hazard does not apply.

### Still open

- Upgrade `@cashu/cashu-ts` to `5.0.0-rc.11` and drop the patch; then support
  `sm`/`mf` (add the lowest applicable `mf` to the amount) instead of
  rejecting.
- Pay NUT-18 requests from fee-charging mints by over-paying the input fee
  (`sum(proofs) - input_fee(proofs) >= a`) once the send path can size the
  proof set; today such mints are simply skipped.
- Consider a "keep-alive" READ BINARY every ~1 s during token creation. It
  resets numo's 3.5 s idle timer but not its 5 s activity timer, so it only
  helps terminals without the second timer.
- The `MeltOperation … not found` melt failure.

# 20. Retry access without replacing custody

Date: 2026-09-28
Status: Accepted; native verification outstanding.

Amends [ADR 0018](0018-recovery-must-not-replace-or-repeat-custody.md) and the
online-first routing decision in [ADR 0019](0019-an-exact-send-needs-no-mint.md).

A temporary keychain read failure must not require deleting an account. The
recovery gate retries on foreground and offers Retry. A successful read of the
existing valid mnemonic restarts initialization; an absent, invalid or unreadable
value leaves the guard intact. Derived accounts recover with a matching phrase;
imported accounts recover with their matching Nostr key. Existing profile metadata
must survive phrase recovery outside onboarding.

Delete All reads the key index and every vault manifest before destroying a wallet
database. Unreadable metadata aborts before destructive work. This is a preflight,
not a transaction across SQLite and Keychain: a later native deletion failure can
still leave a partial reset. Do not discard an unreadable index and claim a full
wipe, because it may be the only record of orphaned recovery tokens.

An exact bearer send uses Coco's existing `offline: true` path immediately, even
when the device is online. It does not wait for a mint refresh or depend on a
particular timeout classification. Locked sends still require an online swap.
The existing core patch now tries deterministic descending selection for binary
denominations before its randomized fallback. A pinned 1097-sat fixture proved
that the upstream selector could otherwise miss an exact combination. Reservation
ownership and the cache-only patch removal trigger in ADR 0019 remain unchanged.

An expired Lightning preview is re-quoted on Pay and displayed for another approval.
No melt is submitted on that tap. New fees must not be substituted under an old
approval. Plain permanent P2PK Nostr payment requests use Coco's P2PK target;
unsupported conditions are rejected before reserving proofs.

Verification and the disposition of all eleven reported findings are recorded in
[the regression review](../../../docs/review/regression-verification-2026-09-28.md).

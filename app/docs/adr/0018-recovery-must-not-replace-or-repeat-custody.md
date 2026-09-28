# 18. Recovery must not replace missing roots or repeat concurrent receives

Date: 2026-09-27
Status: Accepted; native upgrade verification outstanding.

## Context

A successful SecureStore read returning null can mean that a backup restored
account metadata without the root key. The existing error guard covered failed
reads, but this case still generated a replacement mnemonic beneath saved accounts.

Routstr startup, foreground and failure recovery can overlap. Two sweeps could
both observe an unspent token and create separate Coco receive operations. An
active response and a recovery sweep can also return the same token. Vanilla
Coco records the operation before executing its mint swap; a duplicate can
therefore leave a failed, spent-token history entry.

## Decision

Before creating a root after two absent key reads, inspect the durable
`profile-store` envelope directly. An absent envelope or an explicitly empty
profile list permits creation. Existing accounts, unreadable metadata or a
corrupt stored mnemonic enter the existing locked recovery screen. Do not
generate, write or delete keys in those cases. Reading durable metadata avoids
mistaking unhydrated Zustand defaults for a fresh installation.

Coalesce recovery sweeps per SDK instance, and each legacy balance/payment
recovery pass per Coco manager. Coalesce concurrent SDK receives per
Coco manager and normalized token across wallet adapters. Remove completed
in-flight entries so uncertain failures remain retryable through the existing
reconciliation flow. Owner checks still apply before wallet work and after
awaits. Coco remains unmodified.

## Limits

These guards cannot reconstruct a root lost by an older build, recover a
pre-Coco Redux wallet, or prove that a spent token was received by this wallet.
They do not delete historical failed transactions or discard unresolved
recovery records. The token guard covers simultaneous calls in this process;
the existing mint-state probe handles subsequent recovery attempts.

Regression tests reproduced replacement root generation and duplicate receive
submission before the changes, and pass afterward. Native backup/restore and
process-death scenarios still need iPhone and Android verification.

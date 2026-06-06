---
name: log-debugging
description: Debug Sovran behaviour and performance from its structured logs (the log-doctor workflow). Use when triaging a captured log/log.txt, hunting a perf regression (wallpaper, re-renders, payment flow), or instrumenting then cleaning up debug logs.
---

# Log debugging (log-doctor workflow)

Sovran logs are structured events: `log.info('domain.event', { ...fields })`.
Never `console.log` (lint forbids it) — route through `@/shared/lib/logger`
(`log`, `storeLog`, `paymentLog`, `walletLog`, `cashuLog`, `nostrLog`). Secrets
are auto-redacted (`shared/lib/loggerCore.ts`): nsec/cashu/lightning/jwt/pem and
any 64-hex are emitted as `{ _kind, len }` with no preview — never defeat this.

## Event namespaces worth knowing

| Prefix | Domain | Useful for |
|---|---|---|
| `bg.sprite.*` | wallpaper background | perf: `render` carries `renderCount`; `image_loaded` carries `decodeMs`; `motion.start/stop` shows the device-motion sensor lifecycle |
| `store.*` | zustand stores | `store.<name>.rehydrate_failed`, `store.popup.*`, `payment.context.clear` (which root cleared routing context) |
| `payment.*` / `cashu.manager.*` | payments / Coco | `cashu.manager.initialized` (`duration_ms`), `cleanup_*`, `sqlite_closed`, seed-cache hits |
| `navigation.guard.suppressed` | router guard | a double-tap modal open that was correctly debounced |
| `near_pay.session.*` | Nut Drop | session start/complete + durations |
| `nostr.secure.*` | seed/keys | mnemonic generated/stored, debug-mnemonic gate, corrupt-blob refusal |

## Performance triage

1. **Re-render storms:** grep a `*.render` event and watch `renderCount` climb
   without a state change → a missing `React.memo` / unstable prop. Wallpaper is
   the canonical offender (`bg.sprite.render`).
2. **Slow asset/decode:** `bg.sprite.image_loaded.decodeMs` (large image / no
   cache). The `Image` primitive already uses expo-image memory+disk cache.
3. **Wasted sensors/timers:** `bg.sprite.motion.start` firing on a solid-colour
   theme means the 50ms motion stream is running with no visible parallax.
4. **Init cost:** `cashu.manager.initialized.duration_ms`; PBKDF2 vs seed-cache hit.
5. **Wallpaper themes specifically:** every `bg.*` field exists so a custom-wallpaper
   perf regression is visible — correlate `render`/`image_loaded`/`motion.*` across a
   theme switch.

## Tagged-debug-log discipline

When adding temporary instrumentation, tag every line with a unique prefix, e.g.
`log.debug('DEBUG-a4f2.foo', {...})`. Cleanup at the end is a single
`grep -rn "DEBUG-a4f2"` + delete. Never ship `DEBUG-*` logs. Prefer a debugger /
targeted event over "log everything and grep". (Pairs with the `diagnose` skill.)

## Reading a captured log

`log.txt` / a shared capture is JSON-ish lines. To triage:
`grep -E "error|warn|failed" log.txt`, then narrow by namespace. For a perf
question, extract the relevant `*.render` / `*duration_ms` / `decodeMs` events and
look at the trend, not a single line.

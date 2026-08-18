import { z } from 'zod';
import { decodePaymentRequest } from '@cashu/cashu-ts';
import { nonCapturingSelectorSchema, selectorSchema } from './selectors';
import { allowedCommandSchema, unitSchema } from './capabilities';
import { isCanonicalPage } from './pages';
import { mintFaultRuleSchema } from '../../shared/lib/e2e/mintFaults/rules';

// Bounds — reject nonsense timeouts/coords at parse time.
const timeoutMs = z.number().int().positive().max(600_000);
const delayMs = z.number().int().positive().max(600_000);
const coord = z.number().min(0).max(1);
const fixtureParam = z.string().regex(/^\$\{[a-zA-Z][a-zA-Z0-9_]*\}$/);
const positiveAmount = z.union([z.number().int().positive().max(200), fixtureParam]);
const captureName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/);
const exactAsset = {
  mintUrl: z.union([z.string().url(), fixtureParam]),
  unit: z.union([unitSchema, fixtureParam]),
  accountIndex: z.union([z.literal(0), fixtureParam]),
};

/** Marks a control explicitly optional WITH a reason — the only sanctioned way
 *  to tolerate an absent control (no bare `if visible` around required UI). */
const optionalMarker = z.strictObject({ reason: z.string().min(3) });

/** A typed external command: argv[0] is allowlisted, the rest are strings that
 *  may carry `${var}` / `$CLIPBOARD` / `$AX:<id>` placeholders (resolved, then
 *  redacted, at the command boundary). No arbitrary shell. */
const command = z.tuple([allowedCommandSchema]).rest(z.string());

const waitFor = z.strictObject({
  action: z.literal('waitFor'),
  selector: selectorSchema,
  state: z.enum(['visible', 'enabled']).optional(),
  /** Also require the element's AX value to match exactly — the waitable form
   * of `assert ax` value for state that flips after a tap (e.g. a switch's
   * "1"/"0"), where a one-shot assert would race the re-render. */
  value: z.string().optional(),
  timeoutMs: timeoutMs.optional(),
  optional: optionalMarker.optional(),
});
const tap = z.strictObject({
  action: z.literal('tap'),
  selector: nonCapturingSelectorSchema,
  optional: optionalMarker.optional(),
});
const tapAt = z.strictObject({ action: z.literal('tapAt'), x: coord, y: coord });
const swipe = z.strictObject({
  action: z.literal('swipe'),
  dir: z.enum(['left', 'right', 'up', 'down']),
});
const drag = z.strictObject({
  action: z.literal('drag'),
  selector: nonCapturingSelectorSchema,
  from: z.strictObject({ x: coord, y: coord }),
  to: z.strictObject({ x: coord, y: coord }),
  durationMs: z.number().int().min(100).max(5_000).optional(),
});
const input = z.strictObject({
  action: z.literal('input'),
  selector: nonCapturingSelectorSchema,
  value: z.string(),
});
const typeText = z.strictObject({
  action: z.literal('typeText'),
  /** Coordinate tapped first so a field no selector can reach (e.g. inside a
   * FullWindowOverlay sheet, whose content is AX-invisible) owns focus; omit
   * when the field is already focused. */
  focus: z.strictObject({ x: coord, y: coord }).optional(),
  value: z.string().min(1),
});
const goHome = z.strictObject({ action: z.literal('goHome') });
const launch = z.strictObject({
  action: z.literal('launch'),
  reset: z.enum(['erase', 'reinstall', 'none']),
});

// Bounded retry of a tap sequence until a target selector appears — for
// FullWindowOverlay sheets the accessibility tree can't see (the amount
// "as Lightning" row is tapped by coordinate). `attempts` is capped, so it is a
// deterministic retry, never an unbounded loop.
const tapUntilItem = z.union([
  z.strictObject({ tap: nonCapturingSelectorSchema }),
  z.strictObject({ tapAt: z.strictObject({ x: coord, y: coord }) }),
  z.strictObject({ delayMs }),
  // Some pushed cards expose no AX until scroll-nudged; a swipe inside the
  // retry lets the until-target become observable on the SAME attempt as the
  // tap that navigated to it.
  z.strictObject({ swipe: z.strictObject({ dir: z.enum(['left', 'right', 'up', 'down']) }) }),
]);
const tapUntil = z.strictObject({
  action: z.literal('tapUntil'),
  sequence: z.array(tapUntilItem).min(1),
  until: nonCapturingSelectorSchema,
  /** Also require the target's accessibilityValue to equal this — retries a
   * swallowed tap on an already-VISIBLE toggle (filter chips) whose selected
   * state is the only observable change. */
  untilValue: z.string().optional(),
  attempts: z.number().int().min(1).max(8),
  settleMs: timeoutMs.optional(),
});
const delay = z.strictObject({
  action: z.literal('delay'),
  ms: delayMs,
  reason: z.string().min(3),
});
const exec = z.strictObject({
  action: z.literal('exec'),
  command,
  captureAs: z.string().min(1).optional(),
  timeoutMs: timeoutMs.optional(),
});
/** Deterministic simulator TCC control (`simctl privacy`). Host-side and
 * simulator-lane only — the fake driver just records the call. iOS may kill a
 * foreground app whose TCC record changes and permission hooks cache state at
 * mount, so always follow this step with `launch reset:none` before driving
 * the affected flow. `reset` returns the service to not-determined; scenarios
 * that mutate a permission must restore it in `finally`. */
const permission = z.strictObject({
  action: z.literal('permission'),
  service: z.enum(['camera', 'photos', 'location']),
  mode: z.enum(['grant', 'revoke', 'reset']),
});
/** Deterministic simulated device position (`simctl location set`). Ephemeral
 * simulators never acquire a real GPS fix, so location-dependent surfaces
 * (geohash tiers) hang without one. `clear` removes the simulated fix;
 * scenarios that set a location clear it in `finally`. Simulator lane only —
 * the android driver throws (no equivalent without emulator console access). */
const location = z
  .strictObject({
    action: z.literal('location'),
    mode: z.enum(['set', 'clear']),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'set' && (value.latitude === undefined || value.longitude === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'location set requires latitude and longitude' });
    }
  });
const setClipboard = z.strictObject({
  action: z.literal('setClipboard'),
  from: command,
  timeoutMs: timeoutMs.optional(),
});
/** OS-level deep-link entry (`simctl openurl`). Scheme-allowlisted to the
 * app's non-payment schemes so authored URLs can never carry a token,
 * invoice, or request payload; synthetic NIP-46 pairing URIs follow the
 * same e2e-secret convention as `signer.hub.paste`. */
const openUrl = z.strictObject({
  action: z.literal('openUrl'),
  url: z
    .string()
    .max(512)
    .regex(/^(nostrconnect|sovran):\/\//i, 'must use an allowlisted non-payment app scheme')
    .superRefine((value, ctx) => {
      if (/(cashu|creq|lnbc|lntb|lnurl|bitcoin:)/i.test(value.replace(/^nostrconnect:\/\//i, '')))
        ctx.addIssue({ code: 'custom', message: 'must not embed a payment payload' });
    }),
});
/** Literal clipboard seeding for NEGATIVE-input coverage only (empty or
 * garbage paste). Deliberately hostile to payloads: short, and must not
 * resemble a token, invoice, request, URI, key, or seed phrase — real
 * payment payloads still flow only through the typed counterparty/creq
 * seams. Empty string clears the clipboard. */
const setLiteralClipboard = z.strictObject({
  action: z.literal('setLiteralClipboard'),
  text: z
    .string()
    .max(64)
    .superRefine((value, ctx) => {
      if (
        /(cashu|creq|lnbc|lntb|lnurl|lightning:|bitcoin:|npub1|nsec1|nprofile1|nevent1)/i.test(
          value
        )
      )
        ctx.addIssue({
          code: 'custom',
          message: 'must not resemble a payment or identity payload',
        });
      if (value.trim().split(/\s+/).length >= 12)
        ctx.addIssue({ code: 'custom', message: 'must not resemble a seed phrase' });
    }),
});
const publicPaymentRequest = z
  .string()
  .min(1)
  .max(4_096)
  .superRefine((value, ctx) => {
    if (value !== value.trim() || !/^creq[ab]/i.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'must be an encoded NUT-18 payment request' });
      return;
    }
    if (/^creqb1/i.test(value) && value !== value.toLowerCase() && value !== value.toUpperCase()) {
      ctx.addIssue({ code: 'custom', message: 'creqB must not use mixed case' });
      return;
    }
    try {
      decodePaymentRequest(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be a decodable NUT-18 payment request' });
    }
  });
/** A deliberately narrow literal clipboard seam. NUT-18 requests contain
 * public routing metadata; token/invoice/seed payloads still cannot be authored. */
const setPaymentRequestClipboard = z.strictObject({
  action: z.literal('setPaymentRequestClipboard'),
  request: publicPaymentRequest,
});

/** Replace the in-app mint-fault rule set wholesale (`[]` clears all faults).
 * Requires the `mock.mint-faults` capability. The harness writes the rules
 * file into the app container and awaits the app's revision ack, so the step
 * completing means the faults are live. Funded scenarios activate faults
 * only AFTER setup (funding traffic must be real) and must clear them in
 * `finally` before the sweep. Rules survive `launch reset:none` relaunches
 * (the file lives in the container) — the boot-fault pattern — but are wiped
 * by erase/reinstall. */
const mintFaults = z.strictObject({
  action: z.literal('mintFaults'),
  rules: z
    .array(mintFaultRuleSchema)
    .max(32)
    .superRefine((rules, ctx) => {
      const seen = new Set<string>();
      rules.forEach((rule, index) => {
        if (seen.has(rule.id)) {
          ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'duplicate rule id' });
        }
        seen.add(rule.id);
      });
    }),
  timeoutMs: timeoutMs.optional(),
});

/** Real device-level network control (airplane mode). Android driver only
 * (`adb shell cmd connectivity airplane-mode`); requires the `device.network`
 * capability, so the scenario defers on sim/fake. `airplane` kills the
 * emulator's radios for real — the Metro/adb loopback link survives, but every
 * mint, relay, and the OfflineProvider reachability probe genuinely dies.
 * The provider's hysteresis commits the banner only ~5–6.5s later, and until
 * it commits the app still takes ONLINE code paths — so an `airplane` step
 * must be followed by a `waitFor` on the YOU ARE OFFLINE banner before any
 * flow step (the go-offline leg is a synchronization barrier, not décor).
 * Scenarios that go airplane must restore `online` in `finally` before any
 * sweep; the android session teardown force-restores online as a backstop. */
const network = z.strictObject({
  action: z.literal('network'),
  mode: z.enum(['airplane', 'online']),
});

/** Value-moving counterparty operations stay semantic and exact-asset. The
 * runtime adapter owns argv; authored funded plans never spell cocod commands. */
const counterpartyStepSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    action: z.literal('counterparty'),
    operation: z.literal('cashu.create'),
    ...exactAsset,
    amount: positiveAmount,
    captureAs: captureName,
    setClipboard: z.boolean().optional(),
    timeoutMs: timeoutMs.optional(),
  }),
  z.strictObject({
    action: z.literal('counterparty'),
    operation: z.literal('cashu.redeem'),
    ...exactAsset,
    amount: positiveAmount,
    token: z.string().min(1),
    timeoutMs: timeoutMs.optional(),
  }),
  z.strictObject({
    action: z.literal('counterparty'),
    operation: z.literal('bolt11.create'),
    ...exactAsset,
    amount: positiveAmount,
    captureAs: captureName,
    setClipboard: z.boolean().optional(),
    timeoutMs: timeoutMs.optional(),
  }),
  z.strictObject({
    action: z.literal('counterparty'),
    operation: z.literal('bolt11.pay'),
    ...exactAsset,
    amount: positiveAmount,
    invoice: z.string().min(1),
    timeoutMs: timeoutMs.optional(),
  }),
  z.strictObject({
    action: z.literal('counterparty'),
    operation: z.literal('bolt11.settled'),
    ...exactAsset,
    amount: positiveAmount,
    invoice: z.string().min(1),
    timeoutMs: timeoutMs.optional(),
  }),
  z.strictObject({
    action: z.literal('counterparty'),
    operation: z.literal('lightning-address.resolve'),
    ...exactAsset,
    amount: positiveAmount,
    address: z.string().min(1),
    captureAs: captureName,
    timeoutMs: timeoutMs.optional(),
  }),
  z.strictObject({
    action: z.literal('counterparty'),
    operation: z.literal('lightning-address.pay'),
    ...exactAsset,
    amount: positiveAmount,
    address: z.string().min(1),
    timeoutMs: timeoutMs.optional(),
  }),
  // Pays a NUT-18 payment request the app displays: cocod mints the exact
  // principal as a Cashu token and the harness delivers it over the request's
  // Nostr transport (NIP-17 gift wrap to the nprofile target's relays). The
  // request value is normally a captured `${var}`, so full creq validation
  // happens in the runtime after interpolation — authoring only pins a string.
  z.strictObject({
    action: z.literal('counterparty'),
    operation: z.literal('paymentRequest.pay'),
    ...exactAsset,
    amount: positiveAmount,
    request: z.string().min(1),
    timeoutMs: timeoutMs.optional(),
  }),
  z.strictObject({
    action: z.literal('counterparty'),
    operation: z.literal('recovery.sweep'),
    ...exactAsset,
    timeoutMs: timeoutMs.optional(),
  }),
  // Read-only and mint-independent: cocod's own npc lightning address. No
  // exact-asset fields because fetching an address moves no value.
  z.strictObject({
    action: z.literal('counterparty'),
    operation: z.literal('npc.address'),
    captureAs: captureName,
    setClipboard: z.boolean().optional(),
    timeoutMs: timeoutMs.optional(),
  }),
  // Trusted-delivery acknowledgment for an app→npub.cash send. cocod 0.0.16
  // exposes no `npc claim`/npc-balance surface, so the credit side is
  // unobservable — this op records the outflow on app-side evidence instead
  // of a cocod call. Author it ONLY after the scenario's PAID tx assert
  // (bolt11.settled placement rule): it must never pre-record an outflow.
  z.strictObject({
    action: z.literal('counterparty'),
    operation: z.literal('npc.outflow'),
    ...exactAsset,
    amount: positiveAmount,
    address: z.string().min(1),
    /** Sender-side melt-fee budget for the trusted delivery: the cross-mint
     * lightning melt costs the sender a fee that neither cocod nor the sweep
     * can observe. Reconciliation may attribute at most this many sats of the
     * leg's principal to that fee; beyond it the leg quarantines. */
    maxFeeSats: z.number().int().min(0).max(10).optional(),
    timeoutMs: timeoutMs.optional(),
  }),
]);
const capture = z
  .strictObject({
    action: z.literal('capture'),
    as: z.string().min(1),
    fromSelector: nonCapturingSelectorSchema.optional(),
    attribute: z.enum(['label', 'value']).default('label'),
    fromClipboard: z.literal(true).optional(),
  })
  .refine((c) => !!c.fromSelector !== !!c.fromClipboard, {
    message: 'capture takes exactly one of fromSelector / fromClipboard',
    path: ['fromSelector'],
  });
const screenshot = z
  .strictObject({
    action: z.literal('screenshot'),
    name: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]*$/, 'must be a safe lowercase artifact name')
      .refine(isCanonicalPage, {
        message: 'must be a canonical page name from schema/pages.ts',
      }),
    stable: z.boolean().optional(),
    /** Fraction of pixels allowed to differ between stability frames. */
    tolerance: z.number().min(0).max(1).optional(),
    delayMs: delayMs.optional(),
    /** Accessibility ids whose exact on-screen frames are replaced before write. */
    mask: z
      .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'must be a safe accessibility id'))
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.tolerance !== undefined && !value.stable) {
      ctx.addIssue({
        code: 'custom',
        path: ['tolerance'],
        message: 'tolerance requires stable:true',
      });
    }
  });

// Assertions — one `that` per assert, strict payloads.
const assertVisible = z.strictObject({
  action: z.literal('assert'),
  that: z.enum(['visible', 'notVisible']),
  selector: nonCapturingSelectorSchema,
  timeoutMs: timeoutMs.optional(),
});
const assertAx = z.strictObject({
  action: z.literal('assert'),
  that: z.literal('ax'),
  selector: nonCapturingSelectorSchema,
  role: z.string().optional(),
  label: z.string().optional(),
  value: z.string().optional(),
  state: z.record(z.string(), z.boolean()).optional(),
});
const assertBalanceDelta = z.strictObject({
  action: z.literal('assert'),
  that: z.literal('balanceDelta'),
  unit: unitSchema,
  delta: z.number().int(),
  feeEnvelopeSats: z.number().int().min(0).optional(),
});
const assertTx = z.strictObject({
  action: z.literal('assert'),
  that: z.literal('tx'),
  txRef: z.string().min(1),
  direction: z.enum(['in', 'out']).optional(),
  amount: z.number().int().positive().optional(),
  unit: unitSchema.optional(),
  mintHost: z.string().optional(),
  status: z.string().optional(),
  source: z
    .enum(['qr', 'nfc', 'paste', 'deeplink', 'ble', 'copy', 'share', 'airdrop', 'displayed', 'npc'])
    .nullable()
    .optional(),
  /** Poll until every field matches — transient op states (e.g. ISSUED right
   * after a mint quote pays) settle moments later. Omitted = one-shot read. */
  timeoutMs: z.number().int().positive().max(600_000).optional(),
});
const assertEmojiClipboardDecodesTo = z.strictObject({
  action: z.literal('assert'),
  that: z.literal('emojiClipboardDecodesTo'),
  variable: captureName,
});
/** Proves a fault actually fired: polls the app's intercepted-request ledger
 * until the rule has been APPLIED at least minCount times. Mandatory in every
 * fault scenario — a green run whose rule never matched is a false pass. */
const assertMintFaultIntercepted = z.strictObject({
  action: z.literal('assert'),
  that: z.literal('mintFaultIntercepted'),
  ruleId: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  minCount: z.number().int().positive().default(1),
  timeoutMs: timeoutMs.optional(),
});

// z.union (not discriminatedUnion): the four `assert` members share the
// `action` discriminator, which z.discriminatedUnion forbids. Each member is a
// strictObject, so unknown/extra keys and missing actions are still rejected.
export const stepSchema = z.union([
  waitFor,
  tap,
  tapAt,
  swipe,
  drag,
  input,
  typeText,
  goHome,
  launch,
  tapUntil,
  delay,
  exec,
  permission,
  location,
  openUrl,
  setClipboard,
  setLiteralClipboard,
  setPaymentRequestClipboard,
  mintFaults,
  network,
  counterpartyStepSchema,
  capture,
  screenshot,
  assertVisible,
  assertAx,
  assertBalanceDelta,
  assertTx,
  assertEmojiClipboardDecodesTo,
  assertMintFaultIntercepted,
]);
export type Step = z.infer<typeof stepSchema>;
export type CounterpartyStep = z.infer<typeof counterpartyStepSchema>;

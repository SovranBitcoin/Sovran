import { z } from 'zod';
import { decodePaymentRequest } from '@cashu/cashu-ts';
import { nonCapturingSelectorSchema, selectorSchema } from './selectors';
import { allowedCommandSchema, unitSchema } from './capabilities';
import { isCanonicalPage } from './pages';

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
]);
const tapUntil = z.strictObject({
  action: z.literal('tapUntil'),
  sequence: z.array(tapUntilItem).min(1),
  until: nonCapturingSelectorSchema,
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
const setClipboard = z.strictObject({
  action: z.literal('setClipboard'),
  from: command,
  timeoutMs: timeoutMs.optional(),
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

/** Value-moving counterparty operations stay semantic and exact-asset. The
 * runtime adapter owns argv; authored funded plans never spell cocod commands. */
export const counterpartyStepSchema = z.discriminatedUnion('operation', [
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
  z.strictObject({
    action: z.literal('counterparty'),
    operation: z.literal('recovery.sweep'),
    ...exactAsset,
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
  goHome,
  launch,
  tapUntil,
  delay,
  exec,
  setClipboard,
  setPaymentRequestClipboard,
  counterpartyStepSchema,
  capture,
  screenshot,
  assertVisible,
  assertAx,
  assertBalanceDelta,
  assertTx,
  assertEmojiClipboardDecodesTo,
]);
export type Step = z.infer<typeof stepSchema>;
export type CounterpartyStep = z.infer<typeof counterpartyStepSchema>;

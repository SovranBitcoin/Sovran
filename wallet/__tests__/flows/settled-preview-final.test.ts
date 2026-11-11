/**
 * settled-preview-final.test.ts — a settled payment stays settled
 *
 * Once a melt preview is paid, a payment request preview delivered or left
 * undelivered (its ecash left and was not taken back), or an ecash send has
 * made its token (`sendComplete`), that flow is over: a second Pay, or the
 * same amount or mint again, would pay twice. Every event type is listed
 * below against those four. An event either starts another flow (the step
 * leaves the settled one) or changes nothing, and in neither case does the
 * old payment go out again. `Record<FlowEvent["type"], …>` makes a new event
 * type fail to compile here until it is placed in the table.
 */

import { describe, expect, it } from "vitest";

import { createPaymentMachine } from "../../src/machine/createMachine";
import { defaultDetectors } from "../../src/detectors";
import { PaymentRequestUndeliveredError } from "../../src/errors";
import type {
  FlowEvent,
  MachineOperations,
  StepHandlerMap,
} from "../../src/machine/types";
import { createMockOperations, resetTxCounter } from "../_harness/mockOperations";
import { INPUTS, MINT1, MINT2, WALLETS } from "../_harness/fixtures";
import type { OperationCall } from "../_harness/types";

function build(operations?: Partial<MachineOperations>) {
  resetTxCounter();
  const operationCalls: OperationCall[] = [];
  const handlerCalls: string[] = [];
  const handlers = new Proxy({} as StepHandlerMap, {
    get: (_target, step: string) => () => {
      handlerCalls.push(step);
    },
  });
  const machine = createPaymentMachine({
    handlers,
    detectors: defaultDetectors,
    getContext: () => WALLETS.default,
    getUnit: () => "sat",
    operations: createMockOperations(operations, operationCalls),
    scanSources: {},
  });
  const calls = (names: readonly string[]) =>
    operationCalls.filter((call) => names.includes(call.name)).length;
  return { machine, handlerCalls, calls };
}

type Built = ReturnType<typeof build>;

/** A settled payment, how to reach it, and how to press Pay on it again. */
type Settled = {
  name: string;
  step: "navigateToMeltPreview" | "navigateToPaymentRequest" | "sendComplete";
  input: string;
  optionKind: "lightningAddress" | "paymentRequest";
  amount: number;
  /** A mint the flow could be moved to. */
  otherMint: string;
  /** The operations that pay it: either one counts. */
  operation: readonly string[];
  operations?: Partial<MachineOperations>;
  reach: (tm: Built) => Promise<void>;
  pay: (tm: Built) => Promise<unknown>;
};

const SETTLED: Settled[] = [
  {
    name: "a paid melt preview",
    step: "navigateToMeltPreview",
    input: INPUTS.lightningAddress,
    optionKind: "lightningAddress",
    amount: 200,
    otherMint: MINT2,
    operation: ["executeMelt"],
    reach: async ({ machine }) => {
      await machine.execute(INPUTS.lightningAddress, { reset: true });
      await machine.enterAmount({ value: 200, unit: "sat" }, MINT1);
      await machine.confirmMelt();
    },
    pay: ({ machine }) => machine.confirmMelt(),
  },
  {
    name: "a delivered payment request",
    step: "navigateToPaymentRequest",
    input: INPUTS.paymentRequestBasic,
    optionKind: "paymentRequest",
    amount: 100,
    // The request names MINT1 alone, so the only mint to move to is MINT1.
    otherMint: MINT1,
    operation: ["executePaymentRequest"],
    reach: async ({ machine }) => {
      await machine.execute(INPUTS.paymentRequestBasic, { reset: true });
      expect((await machine.confirmPaymentRequest()).kind).toBe("delivered");
    },
    pay: ({ machine }) => machine.confirmPaymentRequest(),
  },
  {
    name: "an undelivered payment request",
    step: "navigateToPaymentRequest",
    input: INPUTS.paymentRequestBasic,
    optionKind: "paymentRequest",
    amount: 100,
    otherMint: MINT1,
    operation: ["executePaymentRequest"],
    operations: {
      executePaymentRequest: async () => {
        throw new PaymentRequestUndeliveredError("op-9", new Error("relay down"));
      },
    },
    reach: async ({ machine }) => {
      await machine.execute(INPUTS.paymentRequestBasic, { reset: true });
      expect((await machine.confirmPaymentRequest()).kind).toBe("undelivered");
    },
    pay: ({ machine }) => machine.confirmPaymentRequest(),
  },
  {
    // The send screen has no Pay: committing the same amount is its Pay.
    name: "an ecash send that made its token",
    step: "sendComplete",
    input: INPUTS.paymentRequestBasic,
    optionKind: "paymentRequest",
    amount: 100,
    otherMint: MINT2,
    operation: ["executeSend", "executeOfflineSend"],
    reach: async ({ machine }) => {
      await machine.startSendEcash({ reset: true });
      await machine.enterAmount({ value: 100, unit: "sat" }, MINT1, {
        destination: "sendEcash",
      });
      expect(machine.getStep()).toBe("sendComplete");
    },
    pay: ({ machine }) =>
      machine.enterAmount({ value: 100, unit: "sat" }, MINT1, {
        destination: "sendEcash",
      }),
  },
];

/** What each event does to a settled payment. */
const EXPECTED: Record<FlowEvent["type"], "newFlow" | "unchanged"> = {
  EXECUTE: "newFlow",
  RESET: "newFlow",
  START_SEND: "newFlow",
  START_SEND_ECASH: "newFlow",
  START_RECEIVE_LIGHTNING: "newFlow",
  START_RECEIVE: "newFlow",
  SHOW_RECEIVE_QR: "newFlow",
  REVIEW_MINT: "newFlow",
  OPTION_CHOSEN: "unchanged",
  AMOUNT_ENTERED: "unchanged",
  MINT_SELECTED: "unchanged",
  PROOFS_CHOSEN: "unchanged",
  SEND_MEMO_SUBMITTED: "unchanged",
  REQUEST_MINT_SELECTOR: "unchanged",
  CONFIRM_MELT: "unchanged",
  CONFIRM_PAYMENT_REQUEST: "unchanged",
};

/** One or more events of each type, aimed at the settled flow itself. */
function eventsOf(type: FlowEvent["type"], s: Settled): FlowEvent[] {
  switch (type) {
    case "EXECUTE":
      return [{ type, input: INPUTS.cashuTokenV3 }];
    case "RESET":
    case "START_SEND":
    case "START_RECEIVE_LIGHTNING":
    case "START_RECEIVE":
    case "SHOW_RECEIVE_QR":
    case "CONFIRM_MELT":
    case "CONFIRM_PAYMENT_REQUEST":
    case "START_SEND_ECASH":
    case "REQUEST_MINT_SELECTOR":
      return [{ type }];
    case "REVIEW_MINT":
      return [{ type, mintUrl: MINT2, token: INPUTS.cashuTokenV3 }];
    case "OPTION_CHOSEN":
      return [
        { type, option: { kind: s.optionKind, value: s.input, source: "standalone" } },
      ];
    case "AMOUNT_ENTERED":
      return [
        { type, amount: s.amount, unit: "sat", mintUrl: MINT1 },
        { type, amount: s.amount, unit: "sat", mintUrl: s.otherMint },
      ];
    case "MINT_SELECTED":
      return [
        { type, mintUrl: MINT1 },
        { type, mintUrl: s.otherMint },
      ];
    case "PROOFS_CHOSEN":
      return [{ type, amount: s.amount }];
    case "SEND_MEMO_SUBMITTED":
      return [{ type, memo: "again" }];
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

const TYPES = Object.keys(EXPECTED) as FlowEvent["type"][];

/**
 * What a person can do after leaving a settled preview, ending in Pay. Each
 * would rebuild the old preview if the new flow still carried its payment.
 */
const FOLLOW_THROUGH: { name: string; run: (tm: Built, s: Settled) => Promise<unknown> }[] = [
  { name: "Pay", run: (tm, s) => s.pay(tm) },
  {
    name: "the mint list, then Pay",
    run: async (tm, s) => {
      await tm.machine.requestMintSelector();
      return s.pay(tm);
    },
  },
  {
    name: "a mint, then Pay",
    run: async (tm, s) => {
      await tm.machine.changeMint(MINT1);
      await tm.machine.changeMint(s.otherMint);
      return s.pay(tm);
    },
  },
  {
    name: "an amount, then Pay",
    run: async (tm, s) => {
      await tm.machine.enterAmount({ value: s.amount, unit: "sat" }, MINT1);
      return s.pay(tm);
    },
  },
];

describe.each(SETTLED)("$name", (s) => {
  it.each(TYPES.filter((type) => EXPECTED[type] === "unchanged"))(
    "%s changes nothing, and Pay does not send again",
    async (type) => {
      for (const event of eventsOf(type, s)) {
        const tm = build(s.operations);
        await s.reach(tm);
        expect(tm.calls(s.operation)).toBe(1);
        const context = tm.machine.getContext();
        const handled = tm.handlerCalls.length;

        await tm.machine.send(event);
        await s.pay(tm);

        expect(tm.calls(s.operation)).toBe(1);
        expect(tm.machine.getStep()).toBe(s.step);
        expect(tm.machine.getContext()).toBe(context);
        expect(tm.handlerCalls).toHaveLength(handled);
      }
    },
  );

  it.each(TYPES.filter((type) => EXPECTED[type] === "newFlow"))(
    "%s leaves the settled payment for another flow",
    async (type) => {
      for (const event of eventsOf(type, s)) {
        const tm = build(s.operations);
        await s.reach(tm);

        await tm.machine.send(event);

        expect(tm.machine.getStep()).not.toBe(s.step);
        expect(tm.calls(s.operation)).toBe(1);
      }
    },
  );

  // The new flow carries nothing of the old payment, so nothing done in it
  // rebuilds the old preview for Pay to send again. (After an ecash send, a
  // new send of an amount is a new payment, so this is for previews only.)
  describe.each(s.step === "sendComplete" ? [] : FOLLOW_THROUGH)("then $name", (follow) => {
    it.each(TYPES.filter((type) => EXPECTED[type] === "newFlow"))(
      "%s does not send the old payment again",
      async (type) => {
        for (const event of eventsOf(type, s)) {
          const tm = build(s.operations);
          await s.reach(tm);

          await tm.machine.send(event);
          await follow.run(tm, s);

          expect(tm.calls(s.operation)).toBe(1);
        }
      },
    );
  });
});

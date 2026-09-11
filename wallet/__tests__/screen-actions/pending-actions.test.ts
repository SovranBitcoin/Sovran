import { describe, expect, it, vi } from "vitest";
import { createScreenActionSession } from "../../src/screen-actions/session";
import { createDefaultScreenActionHandlers } from "../../src/screen-actions/defaultHandlers";

describe("screen action pending feedback", () => {
  it.each(["success", "failure"] as const)(
    "publishes cancel loading synchronously, deduplicates repeated taps, and settles %s",
    async (outcome) => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const rollbackSend = vi.fn(
        () =>
          new Promise<void>((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      );
      const notify = vi.fn();
      const defaults = createDefaultScreenActionHandlers({
        getMachine: () => null,
        getOperations: () => ({ rollbackSend }),
        notify,
        navigation: {},
      });
      const session = createScreenActionSession({
        screenType: "sendToken",
        handlers: {},
        defaultHandlers: defaults.sendToken,
        entrySeed: {
          id: "send-1",
          type: "send",
          state: "pending",
          operationId: "op-1",
        },
      });
      const pending = session.execute("cancel");
      expect(session.inspect().actions.cancel.loading).toBe(true);
      void session.execute("cancel");
      expect(rollbackSend).toHaveBeenCalledTimes(1);
      expect(session.inspect().entry?.state).toBe("pending");
      expect(notify).not.toHaveBeenCalled();
      if (outcome === "success") resolve();
      else reject(new Error("mint unavailable"));
      await pending;
      expect(session.inspect().actions.cancel.loading).toBe(false);
      expect(notify.mock.calls[0]?.[0]).toBe(
        outcome === "success" ? "onSendCancelled" : "onSendCancelFailed",
      );
      // Financial state is always supplied by authoritative history updates.
      expect(session.inspect().entry?.state).toBe("pending");
      session.dispose();
    },
  );

  it("keeps different actions independent and permits a fresh retry after a rejected action", async () => {
    let reject!: (error: Error) => void;
    const cancel = vi.fn(
      () =>
        new Promise<void>((_, no) => {
          reject = no;
        }),
    );
    const checkStatus = vi.fn(async () => {});
    const session = createScreenActionSession({
      screenType: "sendToken",
      handlers: { cancel, checkStatus },
      entrySeed: {
        id: "send-1",
        type: "send",
        state: "pending",
        operationId: "op-1",
      },
    });
    const pending = session.execute("cancel");
    const rejected = expect(pending).rejects.toThrow("failed");
    await session.execute("checkStatus");
    expect(checkStatus).toHaveBeenCalledTimes(1);
    reject(new Error("failed"));
    await rejected;
    expect(session.inspect().actions.cancel.loading).toBe(false);
    cancel.mockResolvedValueOnce();
    await session.execute("cancel");
    expect(cancel).toHaveBeenCalledTimes(2);
    session.dispose();
  });
});

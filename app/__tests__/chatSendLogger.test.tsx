/**
 * @jest-environment node
 */

import { act, renderHook } from '@testing-library/react-native';

import { useLoggedChatSend } from '@/shared/ui/composed/chat/useChatSurfacePerfLogger';
import type { Logger } from '@/shared/lib/logger';

type Emit = [event: string, fields: Record<string, unknown>];

function makeLog() {
  const info: Emit[] = [];
  const warn: Emit[] = [];
  const log = {
    info: (event: string, fields: Record<string, unknown>) => info.push([event, fields]),
    warn: (event: string, fields: Record<string, unknown>) => warn.push([event, fields]),
  } as unknown as Logger;
  return { log, info, warn };
}

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('useLoggedChatSend', () => {
  it('emits dispatch with the surface tag and the caller-supplied extras', async () => {
    const { log, info } = makeLog();
    const send = jest.fn(async (_text: string) => {});
    const { result } = renderHook(() =>
      useLoggedChatSend({
        log,
        surface: 'ai',
        send,
        dispatchExtras: (text: string) => ({ textLen: text.length }),
      })
    );

    await act(async () => {
      await result.current('hello');
    });

    expect(send).toHaveBeenCalledWith('hello');
    expect(info[0][0]).toBe('chat.send.dispatch');
    expect(info[0][1]).toMatchObject({ surface: 'ai', textLen: 5 });
  });

  it('emits complete with a numeric duration once the send resolves', async () => {
    const { log, info } = makeLog();
    const { result } = renderHook(() =>
      useLoggedChatSend({
        log,
        surface: 'dm',
        send: async () => {},
        dispatchExtras: () => ({}),
      })
    );

    await act(async () => {
      await result.current();
    });

    expect(info.map((e) => e[0])).toEqual(['chat.send.dispatch', 'chat.send.complete']);
    expect(typeof info[1][1].duration_ms).toBe('number');
  });

  it('logs a failure and rethrows so callers still see the rejection', async () => {
    const { log, info, warn } = makeLog();
    const boom = new Error('relay down');
    const { result } = renderHook(() =>
      useLoggedChatSend({
        log,
        surface: 'dm',
        send: async () => {
          throw boom;
        },
        dispatchExtras: () => ({}),
      })
    );

    await act(async () => {
      await expect(result.current()).rejects.toThrow('relay down');
    });

    expect(info.map((e) => e[0])).toEqual(['chat.send.dispatch']);
    expect(warn[0][0]).toBe('chat.send.failed');
    expect(warn[0][1]).toMatchObject({ surface: 'dm', err: boom });
    expect(typeof warn[0][1].duration_ms).toBe('number');
  });

  it('drops a second send while the first is still in flight', async () => {
    const { log, info } = makeLog();
    const gate = deferred();
    const send = jest.fn(() => gate.promise);
    const { result } = renderHook(() =>
      useLoggedChatSend({ log, surface: 'ai', send, dispatchExtras: () => ({}) })
    );

    await act(async () => {
      const first = result.current();
      const second = result.current();
      expect(await second).toBeUndefined();
      gate.resolve();
      await first;
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(info.map((e) => e[0])).toEqual(['chat.send.dispatch', 'chat.send.complete']);
  });

  it('awaits a send that returns a non-promise value', async () => {
    const { log, info } = makeLog();
    const send = jest.fn(() => 'ignored');
    const { result } = renderHook(() =>
      useLoggedChatSend({ log, surface: 'dm', send, dispatchExtras: () => ({}) })
    );

    await act(async () => {
      await result.current();
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(info.map((e) => e[0])).toEqual(['chat.send.dispatch', 'chat.send.complete']);
  });
});

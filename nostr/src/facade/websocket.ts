import { fromThrowable } from "neverthrow";
import type { NaggError } from "../errors";

export type WebSocketLike = {
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
};

const socketError = (cause: unknown): NaggError => ({
  type: "network",
  message: "WebSocket operation failed",
  cause,
});

export const openWebSocket = fromThrowable(
  (Ctor: new (url: string) => WebSocketLike, url: string) => new Ctor(url),
  socketError,
);

export const sendWebSocket = fromThrowable(
  (socket: WebSocketLike, frame: unknown[]) =>
    socket.send(JSON.stringify(frame)),
  socketError,
);

/** Release callbacks even when the native socket refuses to close. */
export function closeWebSocket(socket: WebSocketLike): void {
  socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
  // Closing is best effort; callers must still release their other resources.
  fromThrowable(() => socket.close(), socketError)();
}

# network-timeouts

iOS only. Supplies `expo/fetch` with a `URLSessionConfiguration` whose
`timeoutIntervalForRequest` is 300 seconds instead of the platform default of
60. Android's OkHttp client in React Native has no read timeout, so nothing is
needed there.

Why: a Routstr node paid per request buffers the whole completion before it
sends a byte, so the first byte of a long answer arrives after more than a
minute of silence, and iOS was abandoning the request at exactly 60 seconds —
after the node had redeemed the token.

The JavaScript deadlines in `app/shared/lib/routstr/requestDeadline.ts` stay
the effective limits and sit under this value.

Remove when Expo lets the idle timeout be configured from JavaScript, or when
Routstr nodes stream `X-Cashu` responses instead of buffering them.

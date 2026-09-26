/**
 * How long `fetch` waits for the next byte before iOS gives up on a request.
 *
 * Mirrors `timeoutIntervalForRequest` in `ios/NetworkTimeoutsModule.swift`,
 * which is where the value actually takes effect. Exported so the JavaScript
 * deadlines that sit under it (`shared/lib/routstr/requestDeadline.ts`) can be
 * checked against it in a test rather than by remembering.
 */
export const IOS_REQUEST_IDLE_TIMEOUT_SECONDS = 300;

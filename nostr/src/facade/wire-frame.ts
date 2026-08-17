/**
 * Shared NIP-01 wire-frame parsing.
 *
 * Both the relay transport and the Primal cache speak the same envelope shape
 * — a JSON array whose first two members are strings (`["EVENT", subId, ...]`,
 * `["EOSE", subId]`, `["NOTICE", msg]`). Keeping one parser means a malformed
 * frame is rejected identically on both transports instead of drifting.
 */
export function parseWireFrame(data: unknown): [string, string, unknown?] | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return parsed as [string, string, unknown?];
    }
  } catch {
    // ignore malformed frames
  }
  return null;
}

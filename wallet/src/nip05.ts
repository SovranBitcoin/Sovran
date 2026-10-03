import { z } from "zod";
import { safeFetch, withTimeout, type RequestControls } from "./safeFetch";

const HEX_PUBKEY = /^[0-9a-f]{64}$/;
const Nip05Response = z.object({ names: z.record(z.string(), z.string()) });
const MAX_RESPONSE_LENGTH = 32_768;

/** NIP-05 identifiers are ASCII; a bare domain denotes its `_` name. */
export function parseNip05Identifier(input: string): {
  identifier: string;
  username: string;
  domain: string;
} | null {
  const value = input.trim().toLowerCase();
  if (!value || value.length > 256) return null;
  const parts = value.includes("@") ? value.split("@") : ["_", value];
  if (parts.length !== 2) return null;
  const [username, domain] = parts;
  if (!username || !domain || !/^[a-z0-9._-]+$/.test(username)) return null;
  // Public DNS names only: no credentials, ports, IP literals or URL syntax.
  const labels = domain.split(".");
  if (
    labels.length < 2 ||
    domain.length > 253 ||
    !/^[a-z]{2,63}$/.test(labels[labels.length - 1] ?? "") ||
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    ) ||
    domain.endsWith(".onion") ||
    domain.endsWith(".local")
  )
    return null;
  return { identifier: `${username}@${domain}`, username, domain };
}

export type Nip05Verification =
  | { status: "verified"; identifier: string }
  | { status: "mismatch"; identifier: string }
  | { status: "error"; reason: "invalid" | "response" | "missing" | "network" };

type Lookup =
  | { status: "found"; pubkey: string; identifier: string }
  | Extract<Nip05Verification, { status: "error" }>;

async function lookupNip05(
  address: string,
  controls: RequestControls,
): Promise<Lookup> {
  const parsed = parseNip05Identifier(address);
  if (!parsed) return { status: "error", reason: "invalid" };
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (controls.signal?.aborted) return { status: "error", reason: "network" };
  controls.signal?.addEventListener("abort", abort, { once: true });
  const timeoutMs = controls.timeoutMs ?? 5_000;
  const url = `https://${parsed.domain}/.well-known/nostr.json?name=${encodeURIComponent(parsed.username)}`;
  try {
    return await withTimeout(
      (async (): Promise<Lookup> => {
        const response = await safeFetch(
          url,
          { signal: controller.signal, timeoutMs },
          {
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
          },
        );
        // Also reject followed redirects on native transports that ignore redirect:error.
        if (
          !response.ok ||
          response.redirected ||
          (response.url && response.url !== url)
        )
          return { status: "error", reason: "response" };
        const length = Number(response.headers.get("content-length"));
        if (length > MAX_RESPONSE_LENGTH)
          return { status: "error", reason: "response" };
        // RN does not consistently expose a streaming body. Bound accepted text and
        // the entire read deadline, including servers that stall after headers.
        const text = await response.text();
        if (text.length > MAX_RESPONSE_LENGTH || controller.signal.aborted)
          return { status: "error", reason: "response" };
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          return { status: "error", reason: "response" };
        }
        const result = Nip05Response.safeParse(raw);
        if (!result.success) return { status: "error", reason: "response" };
        const names = result.data.names;
        // Local names are case-insensitive. Reject conflicting case variants
        // rather than choosing whichever key the server happened to order first.
        const matches = Object.entries(names).filter(
          ([name]) => name.toLowerCase() === parsed.username,
        );
        const keys = new Set(matches.map(([, key]) => key));
        if (keys.size > 1) return { status: "error", reason: "response" };
        const pubkey = matches[0]?.[1];
        if (!pubkey) return { status: "error", reason: "missing" };
        if (!HEX_PUBKEY.test(pubkey))
          return { status: "error", reason: "response" };
        return { status: "found", pubkey, identifier: parsed.identifier };
      })(),
      timeoutMs,
      "nip05",
    );
  } catch {
    // Domain-controlled responses/errors must not leak credential-bearing URLs.
    return { status: "error", reason: "network" };
  } finally {
    controller.abort();
    controls.signal?.removeEventListener("abort", abort);
  }
}

/** Verify the domain's mapping against the selected key; never replace that key. */
export async function verifyNip05(
  address: string,
  expectedPubkey: string,
  controls: RequestControls = {},
): Promise<Nip05Verification> {
  if (!HEX_PUBKEY.test(expectedPubkey))
    return { status: "error", reason: "invalid" };
  const result = await lookupNip05(address, controls);
  if (result.status === "error") return result;
  return {
    status: result.pubkey === expectedPubkey ? "verified" : "mismatch",
    identifier: result.identifier,
  };
}

/** Optional payment-recipient enrichment; lookup failure is not a payment failure. */
export async function fetchNip05Pubkey(
  address: string,
  controls: RequestControls = {},
): Promise<string | null> {
  const result = await lookupNip05(address, controls);
  return result.status === "found" ? result.pubkey : null;
}

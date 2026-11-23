/** Trailing slashes and a trailing `/v1` are noise — two spellings of one node
 *  must not render as two rows, or select as two different providers. */
export function normalizeNodeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

/** Legacy directory row shape kept for `ai-provider-directory-store` persistence compatibility. */
export interface ServerProvider {
  baseUrl: string;
  name?: string;
  pubkey?: string;
  followers?: number;
  followersSource?: 'graph' | 'vertex' | 'relays';
  modelCount?: number;
  encryptedModelCount?: number;
  minMessageSats?: number;
  mints: string[];
  status: 'online' | 'offline' | 'unknown';
  latencyMs?: number;
}

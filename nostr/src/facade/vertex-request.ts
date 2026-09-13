export type VertexRequestInput = {
  kind: 'profile' | 'search' | 'recommend';
  target?: string;
  query?: string;
  sort?: 'globalPagerank';
  limit?: number;
};
export type UnsignedVertexRequest = {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};
export type SignedVertexRequest = UnsignedVertexRequest & {
  id: string;
  pubkey: string;
  sig: string;
};

/** Only the one-credit global ranking is available to app callers. */
export function buildVertexRequest(
  input: VertexRequestInput,
): UnsignedVertexRequest {
  const tags: string[][] = [];
  if (input.kind === 'profile' && input.target)
    tags.push(['param', 'target', input.target]);
  if (input.kind === 'search' && input.query)
    tags.push(['param', 'search', input.query]);
  tags.push(['param', 'sort', 'globalPagerank']);
  tags.push(['param', 'limit', String(input.limit ?? 10)]);
  return {
    kind: { profile: 5312, search: 5315, recommend: 5313 }[input.kind],
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  };
}

/** UTF-8 JSON, unpadded base64url; works in native runtimes without Buffer. */
export function encodeSignedVertexRequest(event: SignedVertexRequest): string {
  const bytes = new TextEncoder().encode(JSON.stringify(event));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

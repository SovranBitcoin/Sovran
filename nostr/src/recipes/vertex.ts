import { z } from 'zod';
import type { NaggAppViewBinding } from '../transport';
import {
  encodeSignedVertexRequest,
  type SignedVertexRequest,
} from '../facade/vertex-request';

export const VertexFailureSchema = z.object({
  ok: z.literal(false),
  reason: z.enum([
    'insufficient_credits',
    'rejected',
    'timeout',
    'unavailable',
  ]),
  message: z.string().nullish(),
});
export const VertexRelayResponseSchema = z.discriminatedUnion('ok', [
  VertexFailureSchema,
  z.object({
    ok: z.literal(true),
    kind: z.enum(['profile', 'search', 'recommend']),
    result: z.unknown(),
    fetchedAt: z.number().nullish(),
    cached: z.boolean().nullish(),
  }),
]);

export function vertexRelay(
  signedEvent: SignedVertexRequest,
): NaggAppViewBinding {
  return {
    path: '/nostr/vertex/relay',
    method: 'POST',
    body: signedEvent,
    operationName: 'VertexRelay',
  };
}

export function profileAppView(input: {
  pubkey: string;
  signedVertexRequest?: SignedVertexRequest;
}): NaggAppViewBinding {
  return {
    path: '/nostr/profile',
    method: 'GET',
    operationName: 'Profile',
    searchParams: {
      pubkey: input.pubkey,
      ...(input.signedVertexRequest
        ? { svr: encodeSignedVertexRequest(input.signedVertexRequest) }
        : {}),
    },
  };
}

import { z } from 'zod';

export type NaggError =
  | { type: 'vertex'; reason: 'insufficient_credits' | 'rejected' | 'timeout' | 'unavailable'; message: string }
  | { type: 'endpoint_required'; message: string }
  | { type: 'network'; message: string; cause: unknown }
  | { type: 'http'; message: string; status: number; statusText: string }
  | { type: 'schema'; message: string; issues: z.core.$ZodIssue[] };

export function toNaggNetworkError(cause: unknown): NaggError {
  return {
    type: 'network',
    message: errorMessage(cause, 'GraphQL request failed'),
    cause,
  };
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

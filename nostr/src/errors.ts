import { z } from 'zod';

export type NaggError =
  | { type: 'endpoint_required'; message: string }
  | { type: 'network'; message: string; cause: unknown }
  | { type: 'http'; message: string; status: number; statusText: string }
  | { type: 'graphql'; message: string; errors: GraphqlError[] }
  | { type: 'schema'; message: string; issues: z.core.$ZodIssue[] }
  | { type: 'missing_data'; message: string };

export type GraphqlError = {
  message?: string;
  path?: readonly unknown[];
  extensions?: Record<string, unknown>;
};

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

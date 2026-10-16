import { z } from 'zod';

/**
 * What the payment-request receive screen is opened with: the receive
 * operation the wallet created, as its route parameter carries it.
 */
export const PaymentRequestEntrySchema = z.object({
  operationId: z.string().min(1).max(128),
  encodedRequest: z.string().min(4).max(8192),
  // Whole minor units: the flow counts them and never a fraction of one.
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  unit: z.string().min(1).max(16),
  mints: z.array(z.string().max(2048)).max(16),
});

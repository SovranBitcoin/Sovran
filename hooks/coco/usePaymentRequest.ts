/**
 * @fileoverview Hook for handling NUT-18 payment requests
 *
 * This hook provides functionality to read and process Cashu payment requests.
 * It wraps the coco-cashu-core PaymentRequestService.
 */

import type { Token } from '@cashu/cashu-ts';

/**
 * Transport type for inband delivery (direct token transfer)
 */
export interface InbandTransport {
  type: 'inband';
}

/**
 * Transport type for HTTP POST delivery
 */
export interface HttpTransport {
  type: 'http';
  url: string;
}

/**
 * Prepared payment request with inband transport
 */
interface PreparedInbandPaymentRequest {
  transport: InbandTransport;
  amount?: number;
  mints?: string[];
}

/**
 * Prepared payment request with HTTP transport
 */
interface PreparedHttpPaymentRequest {
  transport: HttpTransport;
  amount?: number;
  mints?: string[];
}

/**
 * Union type for prepared payment requests
 */
type PreparedPaymentRequest = PreparedInbandPaymentRequest | PreparedHttpPaymentRequest;

/**
 * Return type for the usePaymentRequest hook
 */
interface UsePaymentRequestReturn {
  /** Read and decode a payment request string */
  readPaymentRequest: (paymentRequest: string) => Promise<PreparedPaymentRequest>;
  /** Handle an inband payment request */
  handleInbandPaymentRequest: (
    mintUrl: string,
    request: PreparedInbandPaymentRequest,
    inbandHandler: (token: Token) => Promise<void>,
    amount?: number
  ) => Promise<void>;
  /** Handle an HTTP payment request */
  handleHttpPaymentRequest: (
    mintUrl: string,
    request: PreparedHttpPaymentRequest,
    amount?: number
  ) => Promise<Response>;
  /** Whether a payment request operation is in progress */
  isLoading: boolean;
  /** Current error if any */
  error: Error | null;
  /** Reset the error state */
  reset: () => void;
}

/**
 * @fileoverview Hook for handling NUT-18 payment requests
 *
 * This hook provides functionality to read and process Cashu payment requests.
 * It wraps the coco-cashu-core PaymentRequestService.
 */

import { useManager } from 'coco-cashu-react';
import { useCallback, useState } from 'react';
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
 * Union type for supported transports
 */
export type Transport = InbandTransport | HttpTransport;

/**
 * Prepared payment request with inband transport
 */
export interface PreparedInbandPaymentRequest {
  transport: InbandTransport;
  amount?: number;
  mints?: string[];
}

/**
 * Prepared payment request with HTTP transport
 */
export interface PreparedHttpPaymentRequest {
  transport: HttpTransport;
  amount?: number;
  mints?: string[];
}

/**
 * Union type for prepared payment requests
 */
export type PreparedPaymentRequest = PreparedInbandPaymentRequest | PreparedHttpPaymentRequest;

/**
 * Return type for the usePaymentRequest hook
 */
export interface UsePaymentRequestReturn {
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

/**
 * Hook for handling NUT-18 payment requests
 *
 * @example
 * ```tsx
 * const { readPaymentRequest, handleInbandPaymentRequest, isLoading, error } = usePaymentRequest();
 *
 * // Read a payment request
 * const prepared = await readPaymentRequest('creqA...');
 *
 * // Handle based on transport type
 * if (prepared.transport.type === 'inband') {
 *   await handleInbandPaymentRequest(mintUrl, prepared, async (token) => {
 *     // Token is ready - navigate to send screen
 *   });
 * }
 * ```
 */
export function usePaymentRequest(): UsePaymentRequestReturn {
  const manager = useManager();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Read and decode a payment request string
   */
  const readPaymentRequest = useCallback(
    async (paymentRequest: string): Promise<PreparedPaymentRequest> => {
      setIsLoading(true);
      setError(null);

      try {
        const prepared = await manager.wallet.readPaymentRequest(paymentRequest);
        return prepared as PreparedPaymentRequest;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to read payment request');
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [manager]
  );

  /**
   * Handle an inband payment request by sending tokens and calling the handler
   */
  const handleInbandPaymentRequest = useCallback(
    async (
      mintUrl: string,
      request: PreparedInbandPaymentRequest,
      inbandHandler: (token: Token) => Promise<void>,
      amount?: number
    ): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        await manager.wallet.handleInbandPaymentRequest(mintUrl, request, inbandHandler, amount);
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('Failed to handle inband payment request');
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [manager]
  );

  /**
   * Handle an HTTP payment request by sending tokens to the specified URL
   */
  const handleHttpPaymentRequest = useCallback(
    async (
      mintUrl: string,
      request: PreparedHttpPaymentRequest,
      amount?: number
    ): Promise<Response> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await manager.wallet.handleHttpPaymentRequest(mintUrl, request, amount);
        return response;
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('Failed to handle HTTP payment request');
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [manager]
  );

  /**
   * Reset the error state
   */
  const reset = useCallback(() => {
    setError(null);
  }, []);

  return {
    readPaymentRequest,
    handleInbandPaymentRequest,
    handleHttpPaymentRequest,
    isLoading,
    error,
    reset,
  };
}



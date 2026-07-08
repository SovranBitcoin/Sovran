import { ReceivePaymentRequestQuoteScreen } from '@/features/receive/screens/ReceivePaymentRequestQuoteScreen';

// Root-level modal route for viewing a single-use incoming payment request from
// the transactions list (a pending "as Ecash" request). Mirrors the standalone
// lightningReceive/onchainReceive/mintQuote/receiveToken detail routes; the
// in-flow creation path renders the same screen at /(receive-flow)/paymentRequest.
export default ReceivePaymentRequestQuoteScreen;

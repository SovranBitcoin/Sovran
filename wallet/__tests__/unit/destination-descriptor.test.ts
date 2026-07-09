/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * destination-descriptor.ts — render-ready Send destination descriptor
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * describeDestination composes resolveIntent and decorates it with colada-owned
 * copy, a semantic icon, a statically-known amount, an action tag, and (for
 * payable identities) a recipient slot the app fills asynchronously.
 */

import { describe, expect, it } from 'vitest';

import { createPaymentCopyResolver } from '../../src/copy';
import { defaultDetectors } from '../../src/detectors';
import { describeDestination } from '../../src/destination-descriptor';
import { parsePaymentInput } from '../../src/parse';
import { INPUTS, WALLETS } from '../_harness/fixtures';

const describeInput = (name: keyof typeof INPUTS) =>
  describeDestination(
    parsePaymentInput(INPUTS[name], defaultDetectors),
    defaultDetectors,
    WALLETS.default,
  );

describe('describeDestination', () => {
  it('ecash token → redeem with amount', () => {
    const d = describeInput('cashuTokenV3');
    expect(d.kind).toBe('ecash');
    expect(d.action).toBe('receiveToken');
    expect(d.amount).toEqual({ value: 1, unit: 'sat' });
    expect(d.label).toBe('Redeem 1 sats');
    expect(d.icon).toBe('ecash');
    expect(d.recipient).toBeUndefined();
    expect(d.hasAlternatives).toBe(false);
  });

  it('payment request with amount → pay amount', () => {
    const d = describeInput('paymentRequestBasic');
    expect(d.kind).toBe('paymentRequest');
    expect(d.action).toBe('sendPaymentRequest');
    expect(d.amount).toEqual({ value: 100, unit: 'sat' });
    expect(d.label).toBe('Pay 100 sats');
  });

  it('payment request without amount → bare verb, null amount', () => {
    const d = describeInput('paymentRequestNoAmount');
    expect(d.kind).toBe('paymentRequest');
    expect(d.amount).toBeNull();
    expect(d.label).toBe('Pay request');
  });

  it('P2PK-locked payment request → recipient pubkey slot', () => {
    const d = describeInput('paymentRequestLocked');
    expect(d.kind).toBe('paymentRequest');
    expect(d.amount).toEqual({ value: 50, unit: 'sat' });
    expect(d.recipient).toEqual({
      ref: { type: 'pubkey', value: `02${'a'.repeat(64)}` },
      pending: true,
    });
  });

  it('bolt11 invoice with amount → pay amount, melt', () => {
    const d = describeInput('bolt11WithAmount');
    expect(d.kind).toBe('lightningInvoice');
    expect(d.action).toBe('meltInvoice');
    expect(d.amount).toEqual({ value: 250000, unit: 'sat' });
    expect(d.label).toBe('Pay 250000 sats');
  });

  it('bolt12 offer → bolt12 melt, null amount (quote-first)', () => {
    const d = describeInput('bolt12Offer');
    expect(d.kind).toBe('bolt12Offer');
    expect(d.action).toBe('meltBolt12');
    expect(d.icon).toBe('lightning');
    expect(d.amount).toBeNull();
    expect(d.label).toBe('Pay');
  });

  it('lightning address → payable person (startContactSend)', () => {
    const d = describeInput('lightningAddress');
    expect(d.kind).toBe('person');
    expect(d.action).toBe('startContactSend');
    expect(d.amount).toBeNull();
    expect(d.label).toBe('Pay');
    expect(d.recipient).toEqual({
      ref: { type: 'lightningAddress', value: INPUTS.lightningAddress },
      pending: true,
    });
  });

  it('lnurlp endpoint → Lightning melt, no recipient', () => {
    const d = describeInput('lnurlpUri');
    expect(d.kind).toBe('lightningAddress');
    expect(d.action).toBe('meltLnurl');
    expect(d.recipient).toBeUndefined();
  });

  it('standalone on-chain address → send onchain, null amount', () => {
    const d = describeInput('onchainAddress');
    expect(d.kind).toBe('onchain');
    expect(d.action).toBe('meltOnchain');
    expect(d.amount).toBeNull();
    expect(d.label).toBe('Send onchain');
  });

  it('BIP-321 on-chain with amount → send amount in sats', () => {
    const d = describeInput('bip321OnchainWithAmount');
    expect(d.kind).toBe('onchain');
    expect(d.amount).toEqual({ value: 10000, unit: 'sat' });
    expect(d.label).toBe('Send 10000 sats');
  });

  it('npub → payable person with npub recipient', () => {
    const d = describeInput('npub');
    expect(d.kind).toBe('person');
    expect(d.action).toBe('startContactSend');
    expect(d.recipient).toEqual({
      ref: { type: 'npub', value: INPUTS.npub },
      pending: true,
    });
  });

  it('mint URL → open mint', () => {
    const d = describeInput('mintUrl');
    expect(d.kind).toBe('mint');
    expect(d.action).toBe('openMint');
    expect(d.label).toBe('View mint');
  });

  it('BIP-321 multi-option → primary option + hasAlternatives + chooseOption', () => {
    const d = describeInput('bip321Multi');
    expect(d.hasAlternatives).toBe(true);
    expect(d.action).toBe('chooseOption');
    // Parse sorts lightning above onchain, so the primary is the invoice.
    expect(d.kind).toBe('lightningInvoice');
    expect(d.amount).toEqual({ value: 250000, unit: 'sat' });
  });

  it('empty input → unsupported with empty label (row hidden)', () => {
    const d = describeInput('emptyString');
    expect(d.kind).toBe('unsupported');
    expect(d.action).toBe('none');
    expect(d.label).toBe('');
  });

  it('random text → unsupported with copy label', () => {
    const d = describeInput('randomString');
    expect(d.kind).toBe('unsupported');
    expect(d.label).toBe('Unrecognized destination');
  });

  it('raw carries the original input for routing on tap', () => {
    const d = describeInput('bolt11WithAmount');
    expect(d.raw).toBe(INPUTS.bolt11WithAmount);
  });

  it('honors a locale-bound copy override', () => {
    const copy = createPaymentCopyResolver({
      overrides: { 'send.destination.payAmount': 'Send {amount} sats now' },
    });
    const d = describeDestination(
      parsePaymentInput(INPUTS.bolt11WithAmount, defaultDetectors),
      defaultDetectors,
      WALLETS.default,
      { copy },
    );
    expect(d.label).toBe('Send 250000 sats now');
  });
});

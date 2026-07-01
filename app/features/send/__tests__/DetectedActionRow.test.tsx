/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { DetectedActionRow } from '@/features/send/components/DetectedActionRow';
import type { DestinationDescriptor } from 'wallet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mutable per-test mock state.
let mockMetadata: Record<string, unknown> | undefined;
let mockIsLoading = false;
let mockNip05Result: string | null = null;

jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({
  useNostrProfileMetadata: (pubkey?: string) => ({
    metadata: pubkey ? mockMetadata : undefined,
    isLoading: mockIsLoading,
  }),
}));

jest.mock('wallet', () => ({
  fetchNip05Pubkey: async () => mockNip05Result,
}));

jest.mock('nostr-tools', () => ({
  nip19: {
    decode: (v: string) => {
      if (v.startsWith('npub1')) return { type: 'npub', data: 'npubhex' };
      throw new Error('bad bech32');
    },
  },
}));

jest.mock('@/shared/lib/identity', () => ({
  resolveIdentityName: ({ nostrProfile }: { nostrProfile?: { displayName?: string } }) =>
    nostrProfile?.displayName ?? 'Unknown',
}));

jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { info: jest.fn(), debug: jest.fn() },
  redactError: (e: unknown) => e,
}));

jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'black' }));

jest.mock('@/shared/ui/composed/ListRow', () => ({
  ListRow: (props: Record<string, unknown>) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement('ListRow', props, typeof props.title === 'string' ? props.title : null);
  },
}));

function findRow(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.find((n) => (n.type as string) === 'ListRow');
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const baseDescriptor = (
  over: Partial<DestinationDescriptor> & Pick<DestinationDescriptor, 'kind'>
): DestinationDescriptor => ({
  label: '',
  amount: null,
  icon: 'unknown',
  action: 'none',
  hasAlternatives: false,
  raw: 'RAW',
  ...over,
});

describe('DetectedActionRow', () => {
  beforeEach(() => {
    mockMetadata = undefined;
    mockIsLoading = false;
    mockNip05Result = null;
  });

  const protocolCases: { name: string; descriptor: DestinationDescriptor }[] = [
    {
      name: 'lightning invoice',
      descriptor: baseDescriptor({
        kind: 'lightningInvoice',
        label: 'Pay 100 sats',
        icon: 'lightning',
        action: 'meltInvoice',
      }),
    },
    {
      name: 'ecash token',
      descriptor: baseDescriptor({
        kind: 'ecash',
        label: 'Redeem 500 sats',
        icon: 'ecash',
        action: 'receiveToken',
      }),
    },
    {
      name: 'payment request',
      descriptor: baseDescriptor({
        kind: 'paymentRequest',
        label: 'Pay 500 sats',
        icon: 'paymentRequest',
        action: 'sendPaymentRequest',
      }),
    },
    {
      name: 'onchain',
      descriptor: baseDescriptor({
        kind: 'onchain',
        label: 'Send onchain',
        icon: 'onchain',
        action: 'meltOnchain',
      }),
    },
  ];

  protocolCases.forEach(({ name, descriptor }) => {
    it(`renders ${name} label and routes the tap through onExecute`, async () => {
      const onExecute = jest.fn();
      const onStartContactSend = jest.fn();
      let renderer: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          <DetectedActionRow
            descriptor={descriptor}
            onExecute={onExecute}
            onStartContactSend={onStartContactSend}
          />
        );
      });
      const row = findRow(renderer!);
      expect(row.props.title).toBe(descriptor.label);
      expect(row.props.subtitle).toBe(descriptor.raw); // pasted value on the subline
      expect(row.props.testID).toBe(`send-detected-${descriptor.kind}`);
      await act(async () => {
        row.props.onPress();
      });
      expect(onExecute).toHaveBeenCalledTimes(1);
      expect(onStartContactSend).not.toHaveBeenCalled();
    });
  });

  it('middle-truncates a long pasted value on the subline', async () => {
    const raw = `lnbc2500u1pvjluez${'q'.repeat(60)}fj9srp`;
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <DetectedActionRow
          descriptor={baseDescriptor({
            kind: 'lightningInvoice',
            label: 'Pay 250000 sats',
            icon: 'lightning',
            action: 'meltInvoice',
            raw,
          })}
          onExecute={jest.fn()}
          onStartContactSend={jest.fn()}
        />
      );
    });
    const subtitle = findRow(renderer!).props.subtitle as string;
    expect(subtitle).toContain('…');
    expect(subtitle.startsWith('lnbc2500u1')).toBe(true);
    expect(subtitle.endsWith('fj9srp')).toBe(true);
    expect(subtitle.length).toBeLessThan(raw.length);
  });

  it('hydrates an npub person to "Pay <name>" and contact-sends with lud16', async () => {
    mockMetadata = { displayName: 'Calle', picture: 'pic', lud16: 'calle@d.com', nip05: null };
    const onExecute = jest.fn();
    const onStartContactSend = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <DetectedActionRow
          descriptor={baseDescriptor({
            kind: 'person',
            label: 'Pay',
            icon: 'person',
            action: 'startContactSend',
            recipient: { ref: { type: 'npub', value: 'npub1xxx' }, pending: true },
          })}
          onExecute={onExecute}
          onStartContactSend={onStartContactSend}
        />
      );
    });
    await flush();
    expect(findRow(renderer!).props.title).toBe('Pay Calle');
    expect(findRow(renderer!).props.subtitle).toBe('npub1xxx'); // pasted identity on the subline
    await act(async () => {
      findRow(renderer!).props.onPress();
    });
    expect(onStartContactSend).toHaveBeenCalledWith({
      pubkey: 'npubhex',
      displayName: 'Calle',
      picture: 'pic',
      nip05: null,
      lud16: 'calle@d.com',
    });
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('resolves a lightning address via NIP-05 and falls back lud16 to the address', async () => {
    mockNip05Result = 'lnhex';
    mockMetadata = { displayName: 'Calle', picture: 'pic', lud16: null, nip05: null };
    const onStartContactSend = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <DetectedActionRow
          descriptor={baseDescriptor({
            kind: 'person',
            label: 'Pay',
            icon: 'person',
            action: 'startContactSend',
            recipient: {
              ref: { type: 'lightningAddress', value: 'calle@domain.com' },
              pending: true,
            },
          })}
          onExecute={jest.fn()}
          onStartContactSend={onStartContactSend}
        />
      );
    });
    await flush();
    expect(findRow(renderer!).props.title).toBe('Pay Calle');
    await act(async () => {
      findRow(renderer!).props.onPress();
    });
    expect(onStartContactSend).toHaveBeenCalledWith(
      expect.objectContaining({ pubkey: 'lnhex', lud16: 'calle@domain.com' })
    );
  });

  it('shows a loading skeleton + truncated label while a person is unresolved, still contact-sends', async () => {
    mockMetadata = undefined;
    mockIsLoading = true;
    const onStartContactSend = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <DetectedActionRow
          descriptor={baseDescriptor({
            kind: 'person',
            label: 'Pay',
            icon: 'person',
            action: 'startContactSend',
            recipient: {
              ref: { type: 'npub', value: 'npub1abcdefghijklmnopqrstuvwxyz' },
              pending: true,
            },
          })}
          onExecute={jest.fn()}
          onStartContactSend={onStartContactSend}
        />
      );
    });
    const row = findRow(renderer!);
    expect(row.props.loading).toBe(true);
    expect(row.props.title).toContain('…'); // middle-truncated raw npub
    await act(async () => {
      row.props.onPress();
    });
    expect(onStartContactSend).toHaveBeenCalledTimes(1); // pubkey decoded synchronously
  });

  it('falls back to onExecute when a lightning address has not resolved', async () => {
    mockNip05Result = null; // NIP-05 lookup yields nothing
    const onExecute = jest.fn();
    const onStartContactSend = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <DetectedActionRow
          descriptor={baseDescriptor({
            kind: 'person',
            label: 'Pay',
            icon: 'person',
            action: 'startContactSend',
            recipient: {
              ref: { type: 'lightningAddress', value: 'ghost@nowhere.com' },
              pending: true,
            },
          })}
          onExecute={onExecute}
          onStartContactSend={onStartContactSend}
        />
      );
    });
    await flush();
    await act(async () => {
      findRow(renderer!).props.onPress();
    });
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onStartContactSend).not.toHaveBeenCalled();
  });
});

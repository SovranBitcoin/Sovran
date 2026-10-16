/**
 * @jest-environment node
 *
 * The Details modal: opened as a route, rows handed over through the runtime
 * store, Done at the foot — and the footer rule that tucks a supporting
 * action behind the three dots.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { DetailsSheetContent, DetailsTable } from '@/shared/ui/composed/DetailsSheet';
import { useDetailsSheetStore } from '@/shared/stores/runtime/detailsSheetStore';
import { entryDetailItems } from '@/features/transactions/components/detail/transactionDetailRows';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn();
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn() },
}));

jest.mock('@/shared/lib/logger', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const logger: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  logger.child = () => logger;
  return {
    Log: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement(ReactActual.Fragment, null, children),
    log: logger,
    paymentLog: logger,
    storeLog: logger,
    walletLog: logger,
    cashuLog: logger,
    redactError: (error: unknown) => String(error),
  };
});

const mockPaint = {
  canvas: 'canvas',
  card: {},
  chipFill: 'chip',
  text: { primary: 'p', secondary: 's', tertiary: 't' },
  style: {
    space: { gutter: 16, group: 24, item: 12, related: 6 },
    size: { control: 48 },
    type: { family: 'System' },
  },
};
jest.mock('@/shared/styles/appStyle', () => ({
  useStylePaint: () => mockPaint,
  useAppStyle: () => mockPaint.style,
}));

jest.mock('assets/icons', () => 'Icon');
jest.mock('@/shared/ui/composed/LayoutGuides', () => ({ LayoutGuides: () => null }));
jest.mock('@/shared/ui/composed/GroupedTable', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement(name, props, children);
  return {
    GroupedTable: Object.assign(host('GroupedTable'), {
      Section: host('TableSection'),
      Row: host('TableRow'),
      Action: host('TableAction'),
    }),
  };
});
jest.mock('@/shared/ui/primitives/Haptics', () => ({
  EnhancedHaptics: { copyHaptic: jest.fn() },
}));
jest.mock('@/shared/ui/composed/CopyableValue', () => ({ CopyableValue: 'CopyableValue' }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children, footer }: { children?: unknown; footer?: unknown }) => [children, footer],
  useScreenOptions: jest.fn(),
}));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({
  BottomButtons: ({ children }: { children?: unknown }) => children,
}));
jest.mock('@/shared/lib/currency', () => ({ formatAmount: jest.fn(() => '') }));
jest.mock('@/shared/ui/composed/MiddleEllipsisValue', () => ({
  MiddleEllipsisValue: 'MiddleEllipsisValue',
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('@/shared/ui/composed/ButtonHandler', () => ({
  ButtonHandler: 'ButtonHandler',
}));

const SHORT = { title: 'State', value: 'PAID' };
const LONG = { title: 'Quote', value: 'q'.repeat(64) };

describe('Details modal', () => {
  beforeEach(() => {
    mockPush.mockClear();
    useDetailsSheetStore.getState().clear();
  });

  it('opens as a route, with the rows handed over through the store', () => {
    const onOpenChange = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <DetailsSection trigger="none" open={false} onOpenChange={onOpenChange} items={[SHORT]} />
      );
    });
    expect(mockPush).not.toHaveBeenCalled();

    act(() =>
      renderer.update(
        <DetailsSection trigger="none" open onOpenChange={onOpenChange} items={[SHORT, false]} />
      )
    );
    expect(mockPush).toHaveBeenCalledWith('/details');
    expect(useDetailsSheetStore.getState().items).toEqual([SHORT]);
    // The modal closes itself: `open` was a request, and it is now answered.
    expect(onOpenChange).toHaveBeenCalledWith(false);
    act(() => renderer.unmount());
  });

  it('keeps an open modal in step with the payment underneath', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<DetailsSection trigger="none" open items={[SHORT]} />);
    });
    act(() =>
      renderer.update(
        <DetailsSection trigger="none" items={[{ title: 'State', value: 'ISSUED' }]} />
      )
    );
    expect(useDetailsSheetStore.getState().items).toEqual([{ title: 'State', value: 'ISSUED' }]);
    act(() => renderer.unmount());
  });

  it('a section that did not open the modal cannot overwrite it', () => {
    useDetailsSheetStore.getState().present('someone-else', 'Details', [LONG]);
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<DetailsSection trigger="none" items={[SHORT]} />);
    });
    expect(useDetailsSheetStore.getState().items).toEqual([LONG]);
    act(() => renderer.unmount());
  });

  it('groups the rows by what they are about, in a fixed order', () => {
    const items = [
      LONG,
      { title: 'npub', value: 'npub1example', group: 'People' as const },
      SHORT,
      { title: 'Lock type', value: 'Public key (P2PK)', group: 'Lock' as const },
    ];
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<DetailsTable items={items} />);
    });
    const sections = renderer.root.findAllByType('TableSection' as never);
    // A short fact is part of the payment; a long string is a reference.
    expect(sections.map((section) => section.props.title)).toEqual([
      'Payment',
      'People',
      'Lock',
      'References',
    ]);
    // Keys, ids and hashes are set in the monospace face; words are not.
    const mono = Object.fromEntries(
      renderer.root
        .findAllByType('TableRow' as never)
        .map((row) => [row.props.label, row.props.mono])
    );
    expect(mono).toEqual({ State: false, npub: false, 'Lock type': false, Quote: true });
    act(() => renderer.unmount());

    // One group: drawn bare, with no heading over the only thing on the page.
    act(() => {
      renderer = TestRenderer.create(<DetailsTable items={[SHORT]} />);
    });
    expect(renderer.root.findByType('TableSection' as never).props.title).toBeUndefined();
    act(() => renderer.unmount());
  });

  it('makes every row copyable, including one that is drawn rather than written', () => {
    const drawn = { title: 'Payment Methods', value: <></>, copyText: 'bolt11, onchain' };
    const shortened = {
      title: 'Mint',
      value: React.createElement('Shortened', { value: 'https://mint.example' }),
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<DetailsTable items={[SHORT, drawn, shortened]} />);
    });
    const rows = renderer.root.findAllByType('TableRow' as never);
    expect(rows.map((row) => [row.props.label, row.props.copyable])).toEqual([
      ['State', true],
      ['Payment Methods', true],
      ['Mint', true],
    ]);
    expect(rows[1].props.copyText).toBe('bolt11, onchain');
    expect(rows[2].props.copyText).toBe('https://mint.example');
    act(() => renderer.unmount());
  });

  it("keeps a screen's own wording when the shared rows repeat a title", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <DetailsSection
          trigger="none"
          open
          items={[
            { title: 'Mint', value: 'Sovran' },
            ...entryDetailItems({ id: 'e1', state: 'PAID', type: 'melt', mintUrl: 'https://m' }),
          ]}
        />
      );
    });
    expect(
      useDetailsSheetStore.getState().items.map((row) => [row.title, row.value, row.group])
    ).toEqual([
      ['Mint', 'Sovran', undefined],
      ['ID', 'e1', 'References'],
      ['Type', 'melt', 'Debug'],
      ['Raw state', 'PAID', 'Debug'],
    ]);
    act(() => renderer.unmount());
  });

  it('reads out who it was with, what the token is, and how it is locked', () => {
    const pubkey = 'a'.repeat(64);
    const rows = entryDetailItems({
      id: 'send-1',
      type: 'send',
      state: 'pending',
      mintUrl: 'https://mint.example',
      unit: 'sat',
      metadata: { recipientPubkey: pubkey, recipientNip05: 'alice@example.com' },
      token: {
        mint: 'https://mint.example',
        unit: 'sat',
        memo: 'lunch',
        proofs: [
          {
            amount: 64,
            id: '00aa',
            dleq: { e: 'e', s: 's' },
            secret: JSON.stringify([
              'P2PK',
              {
                nonce: 'ab'.repeat(16),
                data: `02${'11'.repeat(32)}`,
                tags: [['locktime', '1900000000']],
              },
            ]),
          },
          { amount: 4, id: '00aa', secret: 'plain' },
        ],
      },
    });
    const byGroup = (group: string) =>
      Object.fromEntries(
        rows.filter((row) => row.group === group).map((row) => [row.title, row.value])
      );
    expect(byGroup('People')).toMatchObject({ Address: 'alice@example.com', 'Public key': pubkey });
    expect(String(byGroup('People').npub)).toMatch(/^npub1/);
    expect(byGroup('Token')).toMatchObject({
      Proofs: '2',
      Denominations: '64, 4',
      Keysets: '00aa',
      'Offline check (DLEQ)': '1 of 2',
      Memo: 'lunch',
    });
    expect(byGroup('Lock')).toMatchObject({ 'Lock type': 'Public key (P2PK)' });
    expect(byGroup('Lock')).toHaveProperty('Unlocks');
  });

  it('puts Done at the foot, with Copy all beside it only when there is more than one value', () => {
    const onClose = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <DetailsSheetContent items={[SHORT, LONG]} onClose={onClose} />
      );
    });
    const footer = renderer.root.findByType('ButtonHandler' as never).props.buttons;
    expect(footer.map((button: { text: string }) => button.text)).toEqual(['Copy all', 'Done']);
    expect(footer[0].condition).toBe(true);
    footer[1].onPress();
    expect(onClose).toHaveBeenCalled();

    act(() => renderer.update(<DetailsSheetContent items={[SHORT]} onClose={onClose} />));
    expect(renderer.root.findByType('ButtonHandler' as never).props.buttons[0].condition).toBe(
      false
    );
    act(() => renderer.unmount());
  });
});

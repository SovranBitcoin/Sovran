/**
 * @jest-environment node
 */

/**
 * ActionMenuHost draws `actionMenuPopup()` requests on the house `Sheet`.
 * Each request (seq) is a fresh instance; picking a row closes the sheet and
 * runs the row (a `keepOpen` row swaps the content in place instead); a scrim
 * tap or swipe dismisses and tells the request's `onDismiss` once, a pick
 * does not; a successor handed to `close(afterClose)` waits until the sheet
 * reports `onClosed`; a late callback from a replaced instance changes
 * nothing.
 *
 * The real Sheet renders here over stand-ins for its native runtime
 * (helpers/sheetRuntimeMocks); `finishAnimations()` lands its slide.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { ActionMenuHost } from '@/shared/blocks/popup/ActionMenuHost';
import {
  E2EActionMenuProbe,
  E2EActionMenuRenderMarker,
  markE2EActionMenuPresented,
} from '@/shared/lib/popup/E2EActionMenuProbe';
import {
  actionMenuPopup,
  dismissActionMenuPopup,
  getActionMenuSnapshot,
  replaceActionMenuPopup,
  type ActionMenuPayload,
} from '@/shared/lib/popup/popups/actionMenu';
import { SectionAnchorList } from '@/shared/ui/composed/SectionAnchorList';
import { Sheet, SheetScrollView } from '@/shared/ui/composed/Sheet';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import { finishAnimations, resetAnimations } from './helpers/sheetRuntimeMocks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-reanimated', () => require('./helpers/sheetRuntimeMocks').reanimated);
jest.mock(
  'react-native-gesture-handler',
  () => require('./helpers/sheetRuntimeMocks').gestureHandler
);
jest.mock(
  'react-native-keyboard-controller',
  () => require('./helpers/sheetRuntimeMocks').keyboardController
);
jest.mock('react-native-screens', () => require('./helpers/sheetRuntimeMocks').screens);
jest.mock('react-native-worklets', () => require('./helpers/sheetRuntimeMocks').worklets);
jest.mock('react-native-safe-area-context', () => require('./helpers/sheetRuntimeMocks').safeArea);
jest.mock(
  'react-native-web/dist/exports/useWindowDimensions',
  () => require('./helpers/sheetRuntimeMocks').windowDimensions
);

jest.mock('@/shared/hooks/useThemeColor', () => ({
  // eslint-disable-next-line no-restricted-syntax -- fixture theme colours must parse as hex
  useThemeColor: (tokens: readonly string[]) => tokens.map(() => '#808080'),
}));
jest.mock('@/shared/hooks/useColorScheme', () => ({ useColorScheme: () => 'dark' }));
jest.mock('@/shared/lib/logger', () => {
  const logger = { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() };
  return {
    log: { ...logger, child: () => logger },
    storeLog: logger,
    useMountLog: jest.fn(),
    useRenderLogger: jest.fn(),
    redactError: (error: unknown) => error,
  };
});

function mockHost(name: string) {
  return ({ children, ...props }: { children?: React.ReactNode }) =>
    jest.requireActual<typeof import('react')>('react').createElement(name, props, children);
}
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: mockHost('Text') }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: mockHost('View') }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: mockHost('VStack') }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: mockHost('HStack') }));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({
  BottomButtons: mockHost('BottomButtons'),
}));
jest.mock('assets/icons', () => ({ __esModule: true, default: mockHost('Icon') }));
jest.mock('@/shared/ui/composed/ScrollEdgeFade', () => ({ ScrollEdgeFade: () => null }));
jest.mock('@shopify/flash-list', () => ({
  FlashList: (props: object) =>
    jest.requireActual<typeof import('react')>('react').createElement('FlashList', props),
}));
// react-native-web's TextInput needs a DOM; its props are what these tests read.
jest.mock('react-native-web/dist/exports/TextInput', () => ({
  __esModule: true,
  default: mockHost('TextInput'),
}));

let renderer: TestRenderer.ReactTestRenderer | undefined;

function open(payload: ActionMenuPayload) {
  if (!renderer) {
    act(() => {
      renderer = TestRenderer.create(<ActionMenuHost />);
    });
  }
  act(() => actionMenuPopup(payload));
  return renderer!;
}

const sheets = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByType(Sheet);
const sheet = (r: TestRenderer.ReactTestRenderer) => r.root.findByType(Sheet);
/** The sheet surface: the view that measures itself to slide up. */
const panel = (r: TestRenderer.ReactTestRenderer) =>
  sheet(r).findAll((node) => typeof node.props.onLayout === 'function' && node.props.className)[0]!;
/** The control with `testID` that owns the press (not a host under it). */
const control = (r: TestRenderer.ReactTestRenderer, testID: string) =>
  r.root.findAll(
    (node) => node.props?.testID === testID && typeof node.props.onPress === 'function'
  )[0];
const scrim = (r: TestRenderer.ReactTestRenderer) => control(r, 'action-menu-dismiss')!;
const title = (r: TestRenderer.ReactTestRenderer) =>
  panel(r)
    .findAll((node) => typeof node.type === 'string')
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))[0];

function layOutAndLand(r: TestRenderer.ReactTestRenderer) {
  act(() => {
    panel(r).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 320 } } });
  });
  act(() => finishAnimations());
}

describe('action-menu host', () => {
  afterEach(() => {
    act(() => {
      renderer?.unmount();
      renderer = undefined;
      dismissActionMenuPopup();
      usePopupStore.getState().close();
    });
    resetAnimations();
  });

  it('mounts the menu open with its rows, outside the accessibility tree', () => {
    const r = open({
      title: 'Reachable rows',
      buttons: [{ text: 'Copy', testID: 'copy' }],
    });
    expect(sheets(r)).toHaveLength(1);
    expect(sheet(r).props.open).toBe(true);
    expect(sheet(r).props.scrimLabel).toBe('Dismiss menu');
    // Rows are mounted on the first render and the surface is not one element.
    expect(panel(r).props.accessible).toBe(false);
    const row = r.root.findAll(
      (node) => node.props.testID === 'copy' && node.props.accessibilityRole
    )[0]!;
    expect(row.props.accessibilityRole).toBe('menuitem');
    expect(title(r)).toBe('Reachable rows');
  });

  it('closes on an item press and runs the item', () => {
    const onPress = jest.fn();
    const onDismiss = jest.fn();
    const r = open({
      title: 'Copy token',
      buttons: [{ text: 'as Text', testID: 'text', onPress }],
      onDismiss,
    });
    layOutAndLand(r);
    act(() => {
      control(r, 'text')!.props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(getActionMenuSnapshot().payload).toBeNull();
    expect(sheet(r).props.open).toBe(false);
    // The sheet slides away, then unmounts; a pick is not a dismissal.
    act(() => finishAnimations());
    expect(r.toJSON()).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('swaps keepOpen content in place without closing the sheet', () => {
    const r = open({
      title: 'Wallet',
      buttons: [
        {
          text: 'Delete',
          testID: 'delete',
          keepOpen: true,
          onPress: () => replaceActionMenuPopup({ title: 'Confirmation' }),
        },
      ],
    });
    const seq = getActionMenuSnapshot().seq;
    const instance = sheet(r);
    act(() => {
      control(r, 'delete')!.props.onPress();
    });
    expect(getActionMenuSnapshot().seq).toBe(seq);
    expect(getActionMenuSnapshot().payload?.title).toBe('Confirmation');
    expect(sheet(r)).toBe(instance);
    expect(sheet(r).props.open).toBe(true);
    expect(title(r)).toBe('Confirmation');
  });

  it('keeps the sheet open while a keepOpen item prepares the content it swaps in', async () => {
    let swap!: () => void;
    const onDismiss = jest.fn();
    const r = open({
      title: 'Profiles',
      onDismiss,
      buttons: [
        {
          text: 'Import',
          testID: 'import',
          keepOpen: true,
          onPress: () =>
            new Promise<void>((resolve) => {
              swap = () => {
                replaceActionMenuPopup({ title: 'Import Nostr' });
                resolve();
              };
            }),
        },
      ],
    });
    layOutAndLand(r);
    await act(async () => {
      control(r, 'import')!.props.onPress();
      await Promise.resolve();
    });
    expect(getActionMenuSnapshot().payload?.title).toBe('Profiles');
    expect(sheet(r).props.open).toBe(true);
    await act(async () => swap());
    expect(sheet(r).props.open).toBe(true);
    expect(title(r)).toBe('Import Nostr');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('tells onDismiss once when the scrim dismisses it', () => {
    const onDismiss = jest.fn();
    const r = open({ title: 'Current', onDismiss });
    layOutAndLand(r);
    act(() => {
      scrim(r).props.onPress();
    });
    expect(getActionMenuSnapshot().payload).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    act(() => finishAnimations());
    expect(r.toJSON()).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('tells onDismiss once when a swipe asks to dismiss twice', () => {
    const onDismiss = jest.fn();
    const r = open({ title: 'Current', onDismiss });
    // The swipe path asks the sheet's owner to dismiss, just as the scrim does.
    act(() => {
      sheet(r).props.onDismissRequest();
    });
    act(() => {
      sheet(r).props.onDismissRequest();
    });
    act(() => finishAnimations());
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(r.toJSON()).toBeNull();
  });

  it('runs a successor passed to close() once, and only after the sheet has closed', () => {
    const next = jest.fn(() => actionMenuPopup({ title: 'Successor' }));
    const r = open({
      buttons: [{ text: 'Next', testID: 'next', onPress: (close) => close(next) }],
    });
    layOutAndLand(r);
    const press = control(r, 'next')!.props.onPress;
    act(() => {
      press();
      press();
    });
    expect(next).not.toHaveBeenCalled();
    expect(sheet(r).props.open).toBe(false);
    act(() => finishAnimations());
    expect(next).toHaveBeenCalledTimes(1);
    expect(getActionMenuSnapshot().payload?.title).toBe('Successor');
    expect(sheet(r).props.open).toBe(true);
    expect(title(r)).toBe('Successor');
  });

  it("opens a primary action's queued popup only after the menu finishes closing", async () => {
    const harness = (successorRendered: boolean) => (
      <>
        <ActionMenuHost />
        {successorRendered ? <E2EActionMenuRenderMarker presentationKey="action-menu" /> : null}
        <E2EActionMenuProbe />
      </>
    );
    act(() => {
      renderer = TestRenderer.create(harness(false));
    });
    const probe = () =>
      renderer!.root.findAllByProps({ testID: 'e2e-action-menu-open:action-menu' });
    const r = open({
      title: 'Paste a link',
      primaryAction: {
        text: 'Continue',
        testID: 'paste-connect',
        onPress: (_values, { close }) => {
          close(() =>
            usePopupStore.getState().open({
              sheetId: 'action-menu',
              payload: { title: 'Next', buttons: [] },
            })
          );
        },
      },
    });
    await act(async () => {
      control(r, 'paste-connect')!.props.onPress();
      await Promise.resolve();
    });
    expect(getActionMenuSnapshot().payload).toBeNull();
    expect(usePopupStore.getState().isOpen).toBe(false);
    expect(probe()).toHaveLength(0);
    act(() => finishAnimations());
    expect(usePopupStore.getState()).toMatchObject({
      isOpen: true,
      current: { sheetId: 'action-menu' },
    });
    // The e2e probe waits for the successor to render and land.
    expect(probe()).toHaveLength(0);
    act(() => renderer!.update(harness(true)));
    act(() => markE2EActionMenuPresented(usePopupStore.getState().openSeq));
    expect(probe().length).toBeGreaterThan(0);
  });

  it('keeps the second menu up when the first instance reports late', () => {
    const r = open({ title: 'First menu' });
    const first = sheet(r).props;
    const second = { title: 'Second menu' };
    act(() => actionMenuPopup(second));
    act(() => {
      first.onDismissRequest();
      first.onClosed();
    });
    expect(getActionMenuSnapshot().payload).toBe(second);
    expect(sheet(r).props.open).toBe(true);
    expect(title(r)).toBe('Second menu');
  });

  it('reopens with a fresh instance and reset inputs', () => {
    const menu = { title: 'Input', inputs: [{ id: 'name', initialValue: 'Initial' }] };
    const r = open(menu);
    const input = () =>
      r.root.findAll(
        (node) => node.props.testID === 'action-menu-input-name' && 'onChangeText' in node.props
      )[0]!;
    act(() => {
      input().props.onChangeText('Edited');
    });
    expect(input().props.value).toBe('Edited');
    act(() => dismissActionMenuPopup());
    expect(sheet(r).props.open).toBe(false);
    const firstSeq = getActionMenuSnapshot().seq;
    act(() => actionMenuPopup(menu));
    expect(getActionMenuSnapshot().seq).toBe(firstSeq + 1);
    expect(sheet(r).props.open).toBe(true);
    expect(input().props.value).toBe('Initial');
  });

  it('gives a menu input the URL keyboard and an accessible label', () => {
    const r = open({
      title: 'Upload server',
      inputs: [{ id: 'server', label: 'Server URL', keyboardType: 'url' }],
    });
    const input = r.root.findAll(
      (node) => node.props.testID === 'action-menu-input-server' && 'keyboardType' in node.props
    )[0]!;
    expect(input.props.keyboardType).toBe('url');
    expect(input.props.accessibilityLabel).toBe('Server URL');
  });

  it('shows the presented probe only once the sheet has landed', () => {
    const r = open({ title: 'Presented' });
    expect(r.root.findAllByProps({ testID: 'action-menu-presented' })).toHaveLength(0);
    layOutAndLand(r);
    expect(r.root.findAllByProps({ testID: 'action-menu-presented' }).length).toBeGreaterThan(0);
    act(() => dismissActionMenuPopup());
    expect(r.root.findAllByProps({ testID: 'action-menu-presented' })).toHaveLength(0);
  });

  it('scrolls a footer menu body inside SheetScrollView and pins the footer rows', () => {
    const r = open({
      title: 'Conversations',
      buttons: [
        { text: 'First', testID: 'row-first' },
        { text: 'Second', testID: 'row-second' },
      ],
      footerButtons: [{ text: 'New conversation', testID: 'footer-new' }],
    });
    expect(sheet(r).props.height).toBe('60%');
    const scroll = r.root.findByType(SheetScrollView);
    expect(control(r, 'row-first')).toBeDefined();
    expect(scroll.findAll((node) => node === control(r, 'row-first'))).toHaveLength(1);
    expect(scroll.findAll((node) => node === control(r, 'row-second'))).toHaveLength(1);
    // The footer is the sheet's own footer slot, outside the scroll body.
    const footer = r.root.findAll((node) => String(node.type) === 'BottomButtons')[0]!;
    expect(footer.findAll((node) => node === control(r, 'footer-new'))).toHaveLength(1);
    expect(scroll.findAll((node) => node === control(r, 'footer-new'))).toHaveLength(0);
  });

  it('lays out a plain menu without a scroll body', () => {
    const r = open({ title: 'Plain', buttons: [{ text: 'One', testID: 'one' }] });
    expect(r.root.findAllByType(SheetScrollView)).toHaveLength(0);
    expect(sheet(r).props.height).toBeUndefined();
    expect(control(r, 'one')).toBeDefined();
  });
});

describe('section anchor list inside a menu sheet', () => {
  afterEach(() => {
    act(() => {
      renderer?.unmount();
      renderer = undefined;
    });
  });

  it('updates list extent through a footer spacer and removes single-section anchor chrome', () => {
    const sections = [
      { id: 'one', anchor: { label: 'One', testID: 'anchor-one' }, data: ['first'] },
      { id: 'two', anchor: { label: 'Two', testID: 'anchor-two' }, data: ['last'] },
    ];
    const content = (single: boolean, inset: number) => (
      <SectionAnchorList
        sections={single ? sections.slice(0, 1) : sections}
        renderItem={(item) => item}
        keyExtractor={(item) => item}
        contentBottomInset={inset}
      />
    );
    act(() => {
      renderer = TestRenderer.create(content(false, 32));
    });
    const bar = renderer!.root.find(
      (node) => String(node.type) === 'View' && typeof node.props.onLayout === 'function'
    );
    act(() => {
      bar.props.onLayout({ nativeEvent: { layout: { height: 40 } } });
    });
    const list = () => renderer!.root.find((node) => String(node.type) === 'FlashList');
    expect(list().props.contentContainerStyle.paddingTop).toBe(52);
    act(() => renderer!.update(content(true, 144)));
    expect(renderer!.root.findAllByProps({ testID: 'anchor-one' })).toHaveLength(0);
    expect(list().props.contentContainerStyle.paddingTop).toBe(12);
    expect(list().props.contentContainerStyle.paddingBottom).toBeUndefined();
    expect(list().props.ListFooterComponent.props.style.height).toBe(144);
    expect(list().props.extraData.contentBottomInset).toBe(144);
  });
});

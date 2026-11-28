/**
 * @jest-environment node
 *
 * Haptics come from the shared primitives, not from call sites: Pressable
 * fires a light impact on press-in by default, Button picks one from its
 * variant, and the status toast fires one outcome notification per terminal
 * state.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { Pressable } from '@/shared/ui/primitives/Pressable';
import { ROW_HAPTICS, SELECTION_HAPTICS, outcomeHaptic } from '@/shared/ui/primitives/Haptics';
import { buttonHaptics } from '@/shared/ui/primitives/Button';
import { StatusToast, type StatusToastStatus } from '@/shared/lib/popup/StatusToast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockImpact = jest.fn(async (_style?: string) => {});
const mockSelection = jest.fn(async () => {});
const mockNotification = jest.fn(async (_type?: string) => {});

jest.mock('expo-haptics', () => ({
  impactAsync: (style?: string) => mockImpact(style),
  selectionAsync: () => mockSelection(),
  notificationAsync: (type?: string) => mockNotification(type),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/shared/lib/popup/useToastSurface', () => ({
  useToastSurface: () => ({ fg: 'white', bg: 'black' }),
}));
jest.mock('@/shared/lib/popup/ToastSlab', () => ({
  TINT_ALPHA: 0.3,
  OPAQUE_TINT_MIX: 0.45,
  SUCCESS_DARK_BG: 'green',
  DANGER_DARK_BG: 'red',
  WARNING_DARK_BG: 'orange',
  useToastFrosted: () => true,
  ToastSlab: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/shared/lib/color', () => ({
  withAlpha: (color: string) => color,
  blend: (color: string) => color,
}));
jest.mock('@/shared/blocks/status', () => ({ LoadingIndicator: () => null }));
jest.mock('@/shared/ui/primitives/PillButton', () => ({ PillButton: () => null }));

function render(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

/** The RN Pressable the shared one renders: below it, carrying the wrapped handlers. */
function surface(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  return renderer.root.find(
    (node) =>
      node.type !== Pressable &&
      typeof node.type !== 'string' &&
      node.props.testID === testID &&
      typeof node.props.onPressIn === 'function'
  );
}

function pressIn(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  act(() => {
    surface(renderer, testID).props.onPressIn();
  });
}

async function press(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  await act(async () => {
    await surface(renderer, testID).props.onPress();
  });
}

beforeEach(() => {
  mockImpact.mockClear();
  mockSelection.mockClear();
  mockNotification.mockClear();
});

describe('Pressable haptics', () => {
  it('fires one light impact on press-in by default, and none on release', async () => {
    const onPress = jest.fn();
    const r = render(<Pressable testID="p" onPress={onPress} />);
    pressIn(r, 'p');
    expect(mockImpact).toHaveBeenCalledTimes(1);
    expect(mockImpact).toHaveBeenCalledWith('light');
    await press(r, 'p');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockImpact).toHaveBeenCalledTimes(1);
  });

  it('fires nothing with haptics={false}', () => {
    const r = render(<Pressable testID="p" haptics={false} onPress={jest.fn()} />);
    pressIn(r, 'p');
    expect(mockImpact).not.toHaveBeenCalled();
    expect(mockSelection).not.toHaveBeenCalled();
  });

  it('fires nothing while disabled', () => {
    const r = render(<Pressable testID="p" disabled onPress={jest.fn()} />);
    pressIn(r, 'p');
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it('fires nothing for a container with nothing to press', () => {
    const r = render(<Pressable testID="p" onPressIn={jest.fn()} />);
    pressIn(r, 'p');
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it('maps the selection type to selectionAsync, not an impact', () => {
    const r = render(<Pressable testID="p" haptics={SELECTION_HAPTICS} onPress={jest.fn()} />);
    pressIn(r, 'p');
    expect(mockSelection).toHaveBeenCalledTimes(1);
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it('row haptics wait for the release, so a scroll starting on a row is silent', async () => {
    const r = render(<Pressable testID="p" haptics={ROW_HAPTICS} onPress={jest.fn()} />);
    pressIn(r, 'p');
    expect(mockImpact).not.toHaveBeenCalled();
    await press(r, 'p');
    expect(mockImpact).toHaveBeenCalledTimes(1);
    expect(mockImpact).toHaveBeenCalledWith('light');
  });

  it('does not wait for the haptic before running the action', async () => {
    mockImpact.mockImplementationOnce(() => new Promise<void>(() => {}));
    const onPress = jest.fn();
    const r = render(<Pressable testID="p" haptics={ROW_HAPTICS} onPress={onPress} />);
    await press(r, 'p');
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('fires once for a row nested in a pressable card', () => {
    const outer = jest.fn();
    const inner = jest.fn();
    const r = render(
      <Pressable testID="card" onPress={outer}>
        <Pressable testID="row" onPress={inner} />
      </Pressable>
    );
    pressIn(r, 'row');
    expect(mockImpact).toHaveBeenCalledTimes(1);
  });
});

describe('Button variant haptics', () => {
  it('maps primary to medium, dangerous to warning and the rest to light', () => {
    expect(buttonHaptics('primary')).toEqual({ type: 'impact', impactStyle: 'medium' });
    expect(buttonHaptics('dangerous')).toEqual({
      type: 'notification',
      notificationType: 'warning',
    });
    expect(buttonHaptics('secondary')).toEqual({ type: 'impact', impactStyle: 'light' });
    expect(buttonHaptics('underline')).toEqual({ type: 'impact', impactStyle: 'light' });
  });

  it('keeps the opt-out and layers overrides on the variant default', () => {
    expect(buttonHaptics('primary', false)).toBe(false);
    expect(buttonHaptics('primary', true)).toEqual({ type: 'impact', impactStyle: 'medium' });
    expect(buttonHaptics('primary', { impactStyle: 'heavy' })).toEqual({
      type: 'impact',
      impactStyle: 'heavy',
    });
  });

  it('a dangerous button fires a warning notification on press-in', () => {
    const r = render(
      <Pressable testID="p" haptics={buttonHaptics('dangerous')} onPress={jest.fn()} />
    );
    pressIn(r, 'p');
    expect(mockNotification).toHaveBeenCalledTimes(1);
    expect(mockNotification).toHaveBeenCalledWith('warning');
    expect(mockImpact).not.toHaveBeenCalled();
  });
});

describe('outcome haptics', () => {
  it('maps severity to one notification, info to none', () => {
    outcomeHaptic('success');
    outcomeHaptic('warning');
    outcomeHaptic('error');
    outcomeHaptic('info');
    expect(mockNotification.mock.calls).toEqual([['success'], ['warning'], ['error']]);
  });

  function toast(status: StatusToastStatus, title = 'Sending', outcomeHaptics?: boolean) {
    return (
      <StatusToast
        status={status}
        title={title}
        {...(outcomeHaptics === undefined ? {} : { outcomeHaptics })}
        toastProps={{ hide: jest.fn() }}
      />
    );
  }

  it('fires exactly one success when the toast turns confirmed', () => {
    const r = render(toast('pending'));
    expect(mockNotification).not.toHaveBeenCalled();
    act(() => r.update(toast('confirmed', 'Sent')));
    act(() => r.update(toast('confirmed', 'Sent 21 sats')));
    expect(mockNotification).toHaveBeenCalledTimes(1);
    expect(mockNotification).toHaveBeenCalledWith('success');
  });

  it('fires one error for a failed payment', () => {
    const r = render(toast('pending'));
    act(() => r.update(toast('failed', 'Failed')));
    expect(mockNotification.mock.calls).toEqual([['error']]);
  });

  it('stays silent when another surface owns the outcome', () => {
    const r = render(toast('pending', 'Receiving', false));
    act(() => r.update(toast('confirmed', 'Received payment', false)));
    expect(mockNotification).not.toHaveBeenCalled();
  });
});

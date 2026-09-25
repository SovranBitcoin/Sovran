/**
 * @jest-environment node
 *
 * The pill is the failure's only presence in the conversation, so what it
 * renders IS the error handling: the curated copy, the actions that particular
 * id admits, and a tap that lands on the seam that can fix it. It must never
 * put an upstream message on screen, and it must not offer a Retry the send
 * flow would refuse.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { AiTurnErrorPill } from '@/features/ai/components/AiTurnErrorPill';
import { ERROR_COPY } from '@/shared/lib/errors/catalog';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { modelPickerPopup } from '@/shared/lib/popup';
import { navigateToAddFunds } from '@/features/ai/lib/navigateToAddFunds';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stub = (name: string) => (props: Record<string, unknown>) => {
  const R = jest.requireActual<typeof import('react')>('react');
  return R.createElement(name, props, props.children as React.ReactNode);
};

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: string | readonly string[]) =>
    typeof token === 'string' ? 'c' : token.map(() => 'c'),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { navigate: jest.fn() },
}));
jest.mock('@/shared/lib/popup', () => ({ modelPickerPopup: jest.fn() }));
jest.mock('@/features/ai/lib/navigateToAddFunds', () => ({ navigateToAddFunds: jest.fn() }));
jest.mock('@/shared/lib/logger', () => {
  const noop = jest.fn();
  return { aiLog: { debug: noop, info: noop, warn: noop, error: noop } };
});
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: stub('Text') }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: stub('View') }));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: stub('Button') }));
jest.mock('assets/icons', () => ({ __esModule: true, default: stub('Icon') }));

function render(node: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(node);
  });
  return renderer;
}

const MESSAGE_ID = 'msg-1-a';
const button = (r: TestRenderer.ReactTestRenderer, action: string) =>
  r.root.findByProps({ testID: `ai-message-error-${action}-${MESSAGE_ID}` });
const buttons = (r: TestRenderer.ReactTestRenderer) =>
  r.root
    .findAllByType('Button' as never)
    .map((n) =>
      String(n.props.testID).replace(`ai-message-error-`, '').replace(`-${MESSAGE_ID}`, '')
    );

const press = (r: TestRenderer.ReactTestRenderer, action: string) => {
  act(() => {
    (button(r, action).props.onPress as () => void)();
  });
};

describe('AiTurnErrorPill', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the curated catalogue copy, never an upstream message', () => {
    const r = render(
      <AiTurnErrorPill
        messageId={MESSAGE_ID}
        error={{ id: 'routstr.provider_refused', text: ERROR_COPY['routstr.provider_refused'] }}
        onRetry={jest.fn()}
      />
    );
    const pill = r.root.findByProps({ testID: `ai-message-error-${MESSAGE_ID}` });
    expect(pill.props.accessibilityRole).toBe('alert');
    expect(pill.props.accessibilityLabel).toBe(ERROR_COPY['routstr.provider_refused']);
    expect(
      pill
        .findAllByType('Text' as never)
        .some((n) => String(n.props.children).includes('switch provider'))
    ).toBe(true);
  });

  it('offers the actions the id admits, in order, each with a stable testID', () => {
    const r = render(
      <AiTurnErrorPill
        messageId={MESSAGE_ID}
        error={{ id: 'routstr.provider_refused', text: 'x' }}
        onRetry={jest.fn()}
      />
    );
    expect(buttons(r)).toEqual(['change-provider', 'retry']);
    expect(button(r, 'retry').props.accessibilityLabel).toBe('Retry');
    expect(button(r, 'change-provider').props.accessibilityLabel).toBe('Change Provider');
  });

  it('dispatches Retry to the send flow with the failed message id', () => {
    const onRetry = jest.fn();
    const r = render(
      <AiTurnErrorPill
        messageId={MESSAGE_ID}
        error={{ id: 'routstr.timeout', text: 'x' }}
        onRetry={onRetry}
      />
    );
    press(r, 'retry');
    expect(onRetry).toHaveBeenCalledWith(MESSAGE_ID);
  });

  it('dispatches Change Model to the existing model picker', () => {
    const r = render(
      <AiTurnErrorPill
        messageId={MESSAGE_ID}
        error={{ id: 'routstr.model_unavailable', text: 'x' }}
      />
    );
    press(r, 'change-model');
    expect(modelPickerPopup).toHaveBeenCalledTimes(1);
  });

  it('dispatches Change Provider to the AI provider list', () => {
    const r = render(
      <AiTurnErrorPill messageId={MESSAGE_ID} error={{ id: 'routstr.no_provider', text: 'x' }} />
    );
    press(r, 'change-provider');
    expect(guardedRouter.navigate).toHaveBeenCalledWith('/(ai-flow)/providers');
  });

  it('dispatches Top up to the wallet receive flow, and shows the shortfall we computed', () => {
    const detail = 'GPT-5 reserves 86 sats per request; 1 available. Add at least 85 sats.';
    const r = render(
      <AiTurnErrorPill
        messageId={MESSAGE_ID}
        error={{ id: 'routstr.balance', text: ERROR_COPY['routstr.balance'], detail }}
      />
    );
    expect(
      r.root.findByProps({ testID: `ai-message-error-detail-${MESSAGE_ID}` }).props.children
    ).toBe(detail);
    // The detail is ours, so it joins the spoken label rather than being lost.
    expect(
      r.root.findByProps({ testID: `ai-message-error-${MESSAGE_ID}` }).props.accessibilityLabel
    ).toBe(`${ERROR_COPY['routstr.balance']} ${detail}`);
    press(r, 'top-up');
    expect(navigateToAddFunds).toHaveBeenCalledTimes(1);
  });

  it('drops Retry while another turn is in flight, keeping the rest', () => {
    // `onRetry` is withheld by the screen exactly while the send flow would
    // refuse a second turn. A visible-but-dead Retry is the thing to avoid.
    const r = render(
      <AiTurnErrorPill
        messageId={MESSAGE_ID}
        error={{ id: 'routstr.provider_refused', text: 'x' }}
      />
    );
    expect(buttons(r)).toEqual(['change-provider']);
  });

  it('still offers something for an id the table does not name', () => {
    const r = render(
      <AiTurnErrorPill
        messageId={MESSAGE_ID}
        error={{ id: 'app.unknown', text: 'x' }}
        onRetry={jest.fn()}
      />
    );
    expect(buttons(r)).toEqual(['retry']);
  });
});

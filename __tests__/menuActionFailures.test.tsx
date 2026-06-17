/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { ActionMenuButton } from '@/shared/ui/composed/ActionMenuButton';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockLogError = jest.fn();

jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  log: {
    error: (...args: unknown[]) => mockLogError(...args),
    warn: jest.fn(),
  },
  storeLog: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
  redactError: (error: unknown) => error,
}));

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    Array.isArray(tokens) ? tokens.map(() => 'black') : 'black',
}));

jest.mock('@/shared/ui/primitives/Button', () => ({
  Button: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement(
      'Button',
      props,
      typeof props.text === 'string' ? props.text : null
    );
  },
}));

jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('View', props, children);
  },
}));

jest.mock('@/shared/ui/primitives/View/HStack', () => ({
  HStack: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('HStack', props, children);
  },
}));

jest.mock('@/shared/blocks/popup/MenuScrim', () => ({
  MenuScrim: () => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('MenuScrim');
  },
}));

jest.mock('assets/icons', () => ({
  __esModule: true,
  default: ({ name, ...props }: { name: string }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Icon', { testID: `icon-${name}`, ...props });
  },
}));

jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const Menu = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu', props, children);

  Menu.Trigger = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.Trigger', props, children);
  Menu.Portal = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.Portal', props, children);
  Menu.Content = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.Content', props, children);
  Menu.Label = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.Label', props, children);
  Menu.Item = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.Item', props, children);
  Menu.ItemTitle = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.ItemTitle', props, children);
  Menu.ItemDescription = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.ItemDescription', props, children);

  return { Menu };
});

function findByTestID(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  return renderer.root.find((node) => node.props.testID === testID);
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('menu action failure containment', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockLogError.mockReset();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      throw new Error(`Unexpected console.error: ${args.map(String).join(' ')}`);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('contains async failures from ButtonHandler overflow menu actions', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    const failingCancel = jest.fn(async () => {
      throw new Error('cancel failed');
    });

    await act(async () => {
      renderer = TestRenderer.create(
        <ButtonHandler
          buttons={[
            { testID: 'copy', text: 'Copy', variant: 'primary', onPress: jest.fn() },
            { testID: 'share', text: 'Share', variant: 'secondary', onPress: jest.fn() },
            { testID: 'nfc', text: 'NFC', variant: 'secondary', onPress: jest.fn() },
            {
              testID: 'send-token-cancel-transaction',
              text: 'Cancel transaction',
              variant: 'dangerous',
              onPress: failingCancel,
            },
          ]}
        />
      );
    });

    const cancelItem = findByTestID(renderer!, 'overflow-send-token-cancel-transaction');
    act(() => {
      cancelItem.props.onPress();
    });
    await flushMicrotasks();

    expect(failingCancel).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith('ui.button_handler.menu_action_failed', {
      testID: 'send-token-cancel-transaction',
      error: 'cancel failed',
    });
  });

  it('contains async failures from ActionMenuButton menu variants', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    const failingVariant = jest.fn(async () => {
      throw new Error('variant failed');
    });

    await act(async () => {
      renderer = TestRenderer.create(
        <ActionMenuButton
          label="Copy"
          testID="copy-token"
          variants={[
            { id: 'text', label: 'as Text', onPress: jest.fn() },
            { id: 'emoji', label: 'as Emoji', onPress: failingVariant },
          ]}
        />
      );
    });

    const variantItem = findByTestID(renderer!, 'copy-token-menu-emoji');
    act(() => {
      variantItem.props.onPress();
    });
    await flushMicrotasks();

    expect(failingVariant).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith('ui.action_menu.menu_action_failed', {
      testID: 'copy-token-menu-emoji',
      variantId: 'emoji',
      error: 'variant failed',
    });
  });
});

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { LegalDocumentScreen } from '@/shared/blocks/LegalDocumentScreen';
import { TermsAndConditionsScreen } from '@/features/onboarding/screens/TermsAndConditionsScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-native', () => ({
  View: 'View',
  ScrollView: 'ScrollView',
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (select: (state: unknown) => unknown) =>
    select({ legalAcceptance: null, termsAccepted: null }),
}));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) => (
    <>
      {children}
      {footer}
    </>
  ),
}));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: 'View' }));
jest.mock('react-native-web/dist/exports/ScrollView', () => 'ScrollView');
jest.mock('@/features/settings/screens/SettingsProfileRecoveryScreen', () => ({
  SettingsProfileRecoveryScreen: 'Recovery',
}));
jest.mock('heroui-native', () => {
  const React = require('react');
  const host = (name: string) =>
    function MockHost(props: Record<string, unknown>) {
      return React.createElement(name, props);
    };
  return {
    Button: Object.assign(host('Button'), { Label: 'Label' }),
    ControlField: Object.assign(host('Checkbox'), { Indicator: 'Indicator' }),
    Label: Object.assign(host('Label'), { Text: 'LabelText' }),
    Card: Object.assign(host('Card'), { Body: 'Body' }),
  };
});
function render(props: React.ComponentProps<typeof TermsAndConditionsScreen>) {
  let renderer: TestRenderer.ReactTestRenderer;
  void act(() => {
    renderer = TestRenderer.create(<TermsAndConditionsScreen {...props} />);
  });
  return renderer!;
}
function button(screen: TestRenderer.ReactTestRenderer, label: string) {
  return screen.root
    .findAll((node) => String(node.type) === 'Button')
    .find((node) =>
      node
        .findAll((child) => String(child.type) === 'Label')
        .some((child) => child.children.includes(label))
    )!;
}
function check(screen: TestRenderer.ReactTestRenderer, id: string, selected: boolean) {
  void act(() =>
    screen.root
      .findAll((node) => String(node.type) === 'Checkbox' && node.props.testID === id)[0]
      .props.onSelectedChange(selected)
  );
}
test('confirms Terms then Privacy without scrolling and saves only after both explicit choices', () => {
  const onClose = jest.fn();
  const screen = render({ onClose });
  const step = () => screen.root.findByType(LegalDocumentScreen).props.documentId;
  expect(step()).toBe('terms');
  expect(button(screen, 'Confirm and continue')).toBeUndefined();
  const next = () => button(screen, 'Continue to Privacy');
  expect(next().props.isDisabled).toBe(true);
  void act(() => next().props.onPress());
  expect(step()).toBe('terms');
  check(screen, 'terms-acceptance', true);
  void act(() => next().props.onPress());
  expect(step()).toBe('privacy');
  expect(onClose).not.toHaveBeenCalled();
  const confirm = () => button(screen, 'Confirm and continue');
  expect(confirm().props.isDisabled).toBe(true);
  void act(() => confirm().props.onPress());
  expect(onClose).not.toHaveBeenCalled();
  check(screen, 'privacy-acknowledgment', true);
  expect(confirm().props.isDisabled).toBe(false);
  void act(() => button(screen, 'Back to Terms').props.onPress());
  expect(step()).toBe('terms');
  check(screen, 'terms-acceptance', false);
  expect(next().props.isDisabled).toBe(true);
  check(screen, 'terms-acceptance', true);
  void act(() => next().props.onPress());
  expect(confirm().props.isDisabled).toBe(true);
  check(screen, 'privacy-acknowledgment', true);
  void act(() => confirm().props.onPress());
  expect(onClose).toHaveBeenCalledTimes(1);
  void act(() => screen.unmount());
});
test('controls stay outside the scroller and can be checked immediately', () => {
  const onClose = jest.fn();
  const screen = render({ onClose });
  const scroller = screen.root.findAll((node) => String(node.type) === 'ScrollView')[0];
  expect(scroller.props.testID).toBe('legal-document-terms');
  expect(scroller.findAll((node) => String(node.type) === 'Checkbox')).toHaveLength(0);
  expect(scroller.findAll((node) => String(node.type) === 'Button')).toHaveLength(0);
  check(screen, 'terms-acceptance', true);
  expect(button(screen, 'Continue to Privacy').props.isDisabled).toBe(false);
  void act(() => button(screen, 'View existing recovery information').props.onPress());
  expect(screen.root.findAll((node) => String(node.type) === 'Recovery')).toHaveLength(1);
  expect(onClose).not.toHaveBeenCalled();
  void act(() => screen.unmount());
});
test('abandoning midway restarts at Terms without retaining partial agreement', () => {
  const onClose = jest.fn();
  const first = render({ onClose });
  check(first, 'terms-acceptance', true);
  void act(() => button(first, 'Continue to Privacy').props.onPress());
  void act(() => first.unmount());
  const second = render({ onClose });
  expect(second.root.findByType(LegalDocumentScreen).props.documentId).toBe('terms');
  expect(button(second, 'Continue to Privacy').props.isDisabled).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  void act(() => second.unmount());
});
test('settings errors offer retry and recovery but no acceptance', () => {
  const onClose = jest.fn(),
    onRetry = jest.fn();
  const screen = render({ onClose, settingsError: true, onRetry });
  expect(button(screen, 'Confirm and continue')).toBeUndefined();
  void act(() => button(screen, 'Retry loading settings').props.onPress());
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  void act(() => screen.unmount());
});

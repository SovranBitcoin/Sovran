/**
 * `Notice` collapses into one accessible node only when it has a label a
 * screen reader can read and nothing interactive inside. Both halves have
 * regressed once: a rich `description` left the collapsed node announcing the
 * title alone, and joining title and description blindly with '. ' double-
 * punctuated a title that already ended in a full stop.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Notice } from '@/shared/ui/composed/Notice';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('assets/icons', () => 'Icon');
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => ['white', 'grey'] }));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (value: string) => value }));

function rootOf(element: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  void act(() => {
    tree = TestRenderer.create(element);
  });
  return tree.root.findAll((node) => String(node.type) === 'View')[0].props;
}

test('a title and a string description are announced as two sentences, punctuated once', () => {
  expect(
    rootOf(
      <Notice status="warning" title="Onchain deposit limits" description="Send 10,000 or more." />
    ).accessibilityLabel
  ).toBe('Onchain deposit limits. Send 10,000 or more.');

  // The title already ends the sentence — it must not gain a second full stop.
  expect(
    rootOf(
      <Notice
        status="warning"
        title="Switching profiles restarts Sovran."
        description="Connect again afterwards."
      />
    ).accessibilityLabel
  ).toBe('Switching profiles restarts Sovran. Connect again afterwards.');
});

test('a rich description or an action leaves the children reachable', () => {
  // A ReactNode description contributes nothing to the label, so collapsing
  // would announce the title alone.
  const rich = rootOf(
    <Notice status="danger" description={<Notice status="info" description="inner" />} />
  );
  expect(rich.accessible).toBe(false);
  expect(rich.accessibilityLabel).toBeUndefined();

  // Collapsing hides the button from the screen reader entirely.
  const withAction = rootOf(
    <Notice status="info" description="Bluetooth is off" action={<Notice status="info" />} />
  );
  expect(withAction.accessible).toBe(false);
});

test('a notice carrying only one of the two phrases still announces it', () => {
  expect(rootOf(<Notice status="warning" title="Title only" />).accessibilityLabel).toBe(
    'Title only'
  );
  expect(rootOf(<Notice status="info" description="Description only." />).accessibilityLabel).toBe(
    'Description only.'
  );
});

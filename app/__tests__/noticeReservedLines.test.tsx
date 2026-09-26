/**
 * `Notice` as a fixed-height slot for supporting copy: `reserveLines` holds
 * the body's height before the copy exists, `loading` draws the card as one block, and
 * `collapseLines` clamps longer copy behind a "Show more" toggle that only
 * appears once the text has measured longer than the clamp. Together they are
 * what stops a bio or a mint description from moving the page when it lands.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Notice } from '@/shared/ui/composed/Notice';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('assets/icons', () => 'Icon');
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: () => ['white', 'grey', 'accent', 'amber', 'red', 'green', 'a', 'b', 'c'],
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (value: string) => value }));

type Props = Record<string, unknown>;

function render(element: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(element);
  });
  return tree;
}

// Host nodes only: the `Notice` element itself also carries the testID prop.
const byTestID = (tree: TestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((node) => typeof node.type === 'string' && (node.props as Props).testID === id);

const bodyTexts = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll((node) => String(node.type) === 'Text' && (node.props as Props).size === 14);

test('reserveLines holds the body height, with or without copy', () => {
  const withCopy = render(<Notice status="info" reserveLines={2} description="Short." />);
  const holder = withCopy.root.findAll(
    (node) => String(node.type) === 'View' && (node.props as Props).style !== undefined
  );
  expect(
    holder.some((node) => (node.props as { style: { minHeight?: number } }).style.minHeight === 38)
  ).toBe(true);
});

test('loading is one block at the finished height, not bars where the text goes', () => {
  const tree = render(<Notice status="info" reserveLines={3} loading testID="about" />);
  const block = byTestID(tree, 'about-loading');
  expect(block).toHaveLength(1);
  // No text skeletons inside: the card itself is the skeleton.
  expect(
    tree.root.findAll(
      (node) => String(node.type) === 'Text' && (node.props as Props).loading === true
    )
  ).toHaveLength(0);
  // The finished card's body slot is drawn (invisibly) at three lines, so the
  // block is exactly as tall as the card it stands in for.
  const holder = tree.root.findAll(
    (node) => String(node.type) === 'View' && (node.props as Props).style !== undefined
  );
  expect(
    holder.some((node) => (node.props as { style: { minHeight?: number } }).style.minHeight === 57)
  ).toBe(true);
  // A skeleton is not something a screen reader should stop on.
  expect((block[0].props as Props).accessible).toBe(false);
});

test('collapseLines clamps only once the copy measures longer than the clamp', () => {
  const tree = render(
    <Notice status="info" collapseLines={2} description="A long bio…" testID="about" />
  );
  // Nothing has measured yet: no clamp, no toggle, and the card still
  // collapses to one accessible label.
  expect(byTestID(tree, 'about-toggle')).toHaveLength(0);
  expect((byTestID(tree, 'about')[0].props as Props).accessible).toBe(true);

  // The invisible twin reports five lines.
  const twin = bodyTexts(tree).find(
    (node) => typeof (node.props as Props).onTextLayout === 'function'
  );
  expect(twin).toBeDefined();
  act(() => {
    (twin!.props as { onTextLayout: (e: unknown) => void }).onTextLayout({
      nativeEvent: { lines: [1, 2, 3, 4, 5] },
    });
  });

  const visible = bodyTexts(tree).find((node) => (node.props as Props).numberOfLines !== undefined);
  expect((visible?.props as Props).numberOfLines).toBe(2);
  const toggle = byTestID(tree, 'about-toggle');
  expect(toggle).toHaveLength(1);
  expect((toggle[0].props as Props).accessibilityState).toEqual({ expanded: false });
  // Reachable: the card no longer collapses over its button.
  expect((byTestID(tree, 'about')[0].props as Props).accessible).toBe(false);

  act(() => {
    (toggle[0].props as { onPress: () => void }).onPress();
  });
  expect((byTestID(tree, 'about-toggle')[0].props as Props).accessibilityState).toEqual({
    expanded: true,
  });
  expect(bodyTexts(tree).some((node) => (node.props as Props).numberOfLines !== undefined)).toBe(
    false
  );
});

test('copy that fits shows no toggle', () => {
  const tree = render(
    <Notice status="info" collapseLines={2} description="Fits." testID="about" />
  );
  const twin = bodyTexts(tree).find(
    (node) => typeof (node.props as Props).onTextLayout === 'function'
  );
  act(() => {
    (twin!.props as { onTextLayout: (e: unknown) => void }).onTextLayout({
      nativeEvent: { lines: [1] },
    });
  });
  expect(byTestID(tree, 'about-toggle')).toHaveLength(0);
});

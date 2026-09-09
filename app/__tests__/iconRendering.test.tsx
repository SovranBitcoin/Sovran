import { render } from '@testing-library/react-native';
import Svg, { Path, Mask } from 'react-native-svg';
import Icon from '../assets/icons';
import generatedIcons from '../assets/icons/generated.json';

jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'rebeccapurple' }));

test('icon size and theme color reach the real SVG renderer', () => {
  const view = render(<Icon name="mdi:check" size={28} />);
  const svg = view.UNSAFE_getByType(Svg);
  expect(Number.parseFloat(String(svg.props.width))).toBe(28);
  expect(Number.parseFloat(String(svg.props.height))).toBe(28);
  expect(svg.props.color).toBe('rebeccapurple');
  expect(view.UNSAFE_getAllByType(Path).length).toBeGreaterThan(0);
});

test('changing explicit icon color and size updates the renderer', () => {
  const view = render(<Icon name="mdi:check" color="tomato" size={32} />);
  view.rerender(<Icon name="mdi:check" color="seagreen" size={18} />);
  const svg = view.UNSAFE_getByType(Svg);
  expect(svg.props.color).toBe('seagreen');
  expect(Number.parseFloat(String(svg.props.width))).toBe(18);
});

test('multicolor flags preserve masks and their authored path fills', () => {
  const view = render(<Icon name="circle-flags:us" color="black" />);
  expect(view.UNSAFE_getAllByType(Mask)).toHaveLength(1);
  expect(
    view.UNSAFE_getAllByType(Path).map((path) => Number.parseInt(path.props.fill?.slice(1), 16))
  ).toContain(0xd80027);
});

test('a missing icon displays the existing fallback glyph', () => {
  const view = render(<Icon name="missing:test" size={20} />);
  const path = view.UNSAFE_getByType(Path);
  expect(path.props.d).toContain('M12 22C6.477 22');
  expect(Number.parseFloat(String(view.UNSAFE_getByType(Svg).props.width))).toBe(20);
});

test('zero size keeps the existing intrinsic-size behavior', () => {
  const view = render(<Icon name="mdi:check" size={0} />);
  expect(Number.parseFloat(String(view.UNSAFE_getByType(Svg).props.width))).toBe(16);
  view.rerender(<Icon name="missing:test" size={0} />);
  expect(Number.parseFloat(String(view.UNSAFE_getByType(Svg).props.width))).toBe(32);
});

test('every bundled glyph parses through the actual SVG renderer', () => {
  for (const name of Object.keys(generatedIcons)) {
    const view = render(<Icon name={name} />);
    expect(view.UNSAFE_getAllByType(Svg)).toHaveLength(1);
    view.unmount();
  }
});

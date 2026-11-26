/**
 * The P2PK currency icon: a key on a disc. On the Share screen the disc is a
 * translucent foreground, so a foreground key would melt into it; the key is
 * cut out in the page (`surface`) colour instead. In QR mode (`iconColor` set)
 * the disc is `iconColor` and the key is `colors[0]`, as for every currency.
 */
import { render } from '@testing-library/react-native';
import Svg, { Path } from 'react-native-svg';

import { CurrencyIcon } from '../assets/icons';

const TOKENS: Record<string, string> = { foreground: 'ivory', surface: 'midnightblue' };
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) => {
    const pick = (t: string) => TOKENS[t] ?? 'gray';
    return Array.isArray(tokens) ? tokens.map(pick) : pick(tokens);
  },
}));

function discAndKey(view: ReturnType<typeof render>) {
  const [discSvg, keySvg] = view.UNSAFE_getAllByType(Svg);
  return {
    disc: discSvg!.findAllByType(Path)[0]!.props.fill as string,
    key: keySvg!.props.color as string,
    keyWidth: Number.parseFloat(String(keySvg!.props.width)),
  };
}

test('on a translucent foreground disc the key is cut out in the surface colour', () => {
  const view = render(<CurrencyIcon currency="p2pk" width={20} colors={['ghostwhite']} />);
  const { disc, key, keyWidth } = discAndKey(view);
  expect(disc).toBe('url(#gradient-p2pk)');
  expect(key).toBe(TOKENS.surface);
  expect(key).not.toBe(TOKENS.foreground);
  expect(keyWidth).toBeCloseTo(20 * 0.58);
});

test('in QR mode the key takes colors[0] on an iconColor disc', () => {
  const view = render(
    <CurrencyIcon currency="p2pk" width={40} colors={['white']} iconColor="black" />
  );
  const { disc, key } = discAndKey(view);
  expect(disc).toBe('black');
  expect(key).toBe('white');
  expect(key).not.toBe(disc);
});

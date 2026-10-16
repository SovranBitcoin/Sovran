import { expect, test } from 'bun:test';
import { lanes } from './lanes';

const story = (id: string, startsFrom: string) => ({ id, startsFrom });
const ids = (groups: { id: string }[][]) => groups.map((lane) => lane.map((each) => each.id));

test('stories that follow from one another share a lane, earlier first, longest lane first', () => {
  const grouped = lanes([
    story('history', 'send'),
    story('open-settings', 'onboarded'),
    story('pay', 'send'),
    story('send', 'receive'),
    story('receive', 'testnut-mint'),
    story('first-launch', 'fresh'),
  ]);

  expect(ids(grouped)).toEqual([
    ['receive', 'send', 'history', 'pay'],
    ['open-settings'],
    ['first-launch'],
  ]);
});

test('stories that only share a starting state outside the set stay apart', () => {
  expect(ids(lanes([story('a', 'onboarded'), story('b', 'onboarded')]))).toEqual([['a'], ['b']]);
});

test('stories that start from each other in a circle are still each played', () => {
  expect(
    ids(lanes([story('a', 'b'), story('b', 'a')]))
      .flat()
      .toSorted()
  ).toEqual(['a', 'b']);
});

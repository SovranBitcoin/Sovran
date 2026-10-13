import { expect, test } from 'bun:test';
import { withGiven } from './given';
import { storySchema } from './story';

const story = (given: unknown, text: string) =>
  storySchema.parse({
    id: 'pay-a-lightning-invoice',
    purpose: 'A person pays a Lightning invoice someone gave them and sees it paid.',
    startsFrom: 'fresh',
    ...(given ? { given } : {}),
    steps: [{ name: 'type the invoice', type: { text }, expect: [{ page: 'SendScreen' }] }],
  });

test('an invoice is fetched for the story and typed where the story marks it', async () => {
  const asked: [string, number][] = [];
  const ready = await withGiven(
    story({ invoice: { mint: 'https://testnut.cashu.space', sats: 10 } }, '{{invoice}}'),
    {},
    async (mint, sats) => {
      asked.push([mint, sats]);
      return 'lnbc100n1example';
    }
  );

  expect(asked).toEqual([['https://testnut.cashu.space', 10]]);
  expect(ready.steps[0].type?.text).toBe('lnbc100n1example');
});

test('a story given nothing is left as written and nothing is fetched', async () => {
  const ready = await withGiven(story(undefined, 'hello'), {}, async () => {
    throw new Error('should not be asked');
  });

  expect(ready.steps[0].type?.text).toBe('hello');
});

test("the simulator's own mint is filled in wherever the story names it", async () => {
  const written = storySchema.parse({
    id: 'add-the-private-mint',
    purpose: 'A person adds the mint this run started for them and chooses it.',
    startsFrom: 'fresh',
    steps: [
      {
        name: 'type its address',
        type: { text: '{{mint}}' },
        expect: [{ visible: { id: 'contact-row:mint:{{mint}}' } }],
      },
      {
        name: 'pick it',
        tap: { id: 'contact-row:mint:{{mint}}' },
        expect: [{ page: 'MintAddScreen' }],
      },
    ],
  });

  const ready = await withGiven(written, { mint: 'https://localhost:20001' });

  expect(ready.steps[0].type?.text).toBe('https://localhost:20001');
  expect(ready.steps[0].expect[0]).toEqual({
    visible: { id: 'contact-row:mint:https://localhost:20001' },
  });
  expect(ready.steps[1].tap).toEqual({ id: 'contact-row:mint:https://localhost:20001' });
});

test('a mark the runner has nothing for is left for a later step to fill from what it remembered', async () => {
  const ready = await withGiven(story(undefined, '{{word1}}'));

  expect(ready.steps[0].type?.text).toBe('{{word1}}');
});

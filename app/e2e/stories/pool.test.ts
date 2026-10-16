import { describe, expect, test } from 'bun:test';
import { runPool, runRounds } from './pool';

const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('sharing stories among workers', () => {
  test('every story is played exactly once and reported in the order given', async () => {
    const played: string[] = [];
    const results = await runPool(['a', 'b', 'c', 'd', 'e'], ['w1', 'w2'], async (story) => {
      played.push(story);
      await after(story === 'a' ? 20 : 1);
      return story.toUpperCase();
    });

    expect(played.toSorted()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(results.map((result) => result.outcome)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  test('a slow story holds up only its own worker', async () => {
    const results = await runPool(['slow', 'b', 'c', 'd'], ['w1', 'w2'], async (story) => {
      await after(story === 'slow' ? 40 : 1);
      return story;
    });

    const by = (story: string) => results.find((result) => result.story === story)?.worker;
    expect(by('slow')).toBe('w1');
    expect([by('b'), by('c'), by('d')]).toEqual(['w2', 'w2', 'w2']);
  });

  test('a worker never plays two stories at once', async () => {
    const busy = new Set<string>();
    let overlapped = false;
    await runPool([1, 2, 3, 4, 5, 6], ['w1', 'w2', 'w3'], async (_story, worker) => {
      if (busy.has(worker)) overlapped = true;
      busy.add(worker);
      await after(2);
      busy.delete(worker);
    });

    expect(overlapped).toBe(false);
  });
});

test('each repetition executes on fresh workers while a round keeps its own wallet', async () => {
  let created = 0;
  const seen = new Map<string, string[]>();
  const results = await runRounds(
    [
      ['receive', 'spend'],
      ['receive', 'spend'],
    ],
    () => [`wallet-${++created}`],
    async (story, worker) => {
      seen.set(worker, [...(seen.get(worker) ?? []), story]);
      return story;
    }
  );
  expect([...seen.values()]).toEqual([
    ['receive', 'spend'],
    ['receive', 'spend'],
  ]);
  expect(results.map((result) => result.worker)).toEqual([
    'wallet-1',
    'wallet-1',
    'wallet-2',
    'wallet-2',
  ]);
});

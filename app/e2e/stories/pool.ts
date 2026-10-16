/**
 * Shares stories out among workers (ADR 0033): each worker takes the next
 * story as soon as it has finished the last, so a slow story holds up nothing
 * but its own worker. Every story is played once; a failure is a result, not
 * a reason to play it again. `play` reports failure in what it resolves to: if
 * it rejects, the run ends there without the stories still being played.
 */

interface PoolResult<Story, Outcome> {
  story: Story;
  worker: string;
  outcome: Outcome;
  wallMs: number;
}

export async function runPool<Story, Outcome>(
  stories: readonly Story[],
  workers: readonly string[],
  play: (story: Story, worker: string) => Promise<Outcome>
): Promise<PoolResult<Story, Outcome>[]> {
  const results: PoolResult<Story, Outcome>[] = [];
  let next = 0;
  await Promise.all(
    workers.map(async (worker) => {
      while (next < stories.length) {
        const at = next++;
        const started = performance.now();
        const outcome = await play(stories[at], worker);
        results[at] = {
          story: stories[at],
          worker,
          outcome,
          wallMs: Math.round(performance.now() - started),
        };
      }
    })
  );
  return results;
}

/** Repetitions get fresh disposable workers: a public mint cannot rewind with
 * a saved wallet, and repeated attempts must execute rather than copy proof. */
export async function runRounds<Story, Outcome>(
  rounds: readonly (readonly Story[])[],
  prepareWorkers: () => readonly string[],
  play: (story: Story, worker: string) => Promise<Outcome>
): Promise<PoolResult<Story, Outcome>[]> {
  const results: PoolResult<Story, Outcome>[] = [];
  for (const round of rounds) results.push(...(await runPool(round, prepareWorkers(), play)));
  return results;
}

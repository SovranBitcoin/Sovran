import type { ProfileEntry } from '@/shared/stores/global/profileStore';

type RemovalRefusal =
  | 'active'
  | 'last'
  | 'missing'
  | 'busy'
  | 'balance'
  | 'pending'
  | 'unreadable'
  | 'imported-confirmation';
type RemovalResult =
  | { kind: 'removed'; completed: string[] }
  | { kind: 'refused'; reason: RemovalRefusal }
  | { kind: 'failed'; completed: string[]; failed: string; remaining: string[]; cause: unknown };

export interface RemovalPorts {
  inventory: () => { activeAccountIndex: number; profiles: ProfileEntry[] };
  inspect: (profile: ProfileEntry) => Promise<'empty' | 'balance' | 'pending' | 'unreadable'>;
  prepare: (profile: ProfileEntry) => Promise<{ name: string; run: () => Promise<void> }[]>;
}

/** The caller holds the same admission lock as switches, creation and delete-all. */
export async function removeProfileData(
  accountIndex: number,
  importedKeyConfirmed: boolean,
  ports: RemovalPorts
): Promise<RemovalResult> {
  const { activeAccountIndex, profiles } = ports.inventory();
  const profile = profiles.find((entry) => entry.accountIndex === accountIndex);
  if (!profile) return { kind: 'refused', reason: 'missing' };
  if (
    profiles.filter(
      (entry) => entry.pubkey === profile.pubkey || entry.accountIndex === accountIndex
    ).length !== 1
  )
    return { kind: 'refused', reason: 'unreadable' };
  if (profiles.length <= 1) return { kind: 'refused', reason: 'last' };
  if (activeAccountIndex === accountIndex) return { kind: 'refused', reason: 'active' };
  if (profile.source === 'imported' && !importedKeyConfirmed)
    return { kind: 'refused', reason: 'imported-confirmation' };
  let steps: Awaited<ReturnType<RemovalPorts['prepare']>>;
  try {
    const safety = await ports.inspect(profile);
    if (safety !== 'empty') return { kind: 'refused', reason: safety };
    steps = await ports.prepare(profile);
  } catch {
    // Native errors may contain payment records. Only a fixed refusal reaches the UI.
    return { kind: 'refused', reason: 'unreadable' };
  }
  const completed: string[] = [];
  for (const [index, step] of steps.entries()) {
    const current = ports.inventory();
    const target = current.profiles.find((entry) => entry.accountIndex === accountIndex);
    if (
      current.activeAccountIndex === accountIndex ||
      current.profiles.length <= 1 ||
      target?.pubkey !== profile.pubkey ||
      current.profiles.filter((entry) => entry.pubkey === profile.pubkey).length !== 1 ||
      (target.source === 'imported' && !importedKeyConfirmed)
    )
      return {
        kind: 'failed',
        completed,
        failed: step.name,
        remaining: steps.slice(index).map((s) => s.name),
        cause: new Error('Profile inventory changed'),
      };
    try {
      await step.run();
      completed.push(step.name);
    } catch (cause) {
      return {
        kind: 'failed',
        completed,
        failed: step.name,
        remaining: steps.slice(index).map((s) => s.name),
        cause,
      };
    }
  }
  return { kind: 'removed', completed };
}

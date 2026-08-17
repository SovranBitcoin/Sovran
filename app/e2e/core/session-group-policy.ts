import type { RunStatus } from './run';

interface SessionGroupCompletionInput {
  statuses: readonly RunStatus[];
  expectedScenarios: number;
  /** True only when a real funded device session was started. */
  fundedSession: boolean;
  fundsReconciled?: boolean;
}

interface SessionGroupCompletion {
  shouldContinue: boolean;
  outcome: 'complete' | 'scenario-failed' | 'dependency-prefix-incomplete' | 'unsafe-funds';
}

export function shouldRunSessionGroupMember(options: {
  memberIndex: number;
  newInstance: boolean;
  predecessor?: RunStatus;
}): boolean {
  return options.memberIndex === 0 || options.newInstance || options.predecessor === 'passed';
}

/** Classifies a group only after its session callback resolves. Session/setup
 * exceptions deliberately bypass this policy and abort the surrounding run. */
export function assessSessionGroupCompletion({
  statuses,
  expectedScenarios,
  fundedSession,
  fundsReconciled,
}: SessionGroupCompletionInput): SessionGroupCompletion {
  if (fundedSession && fundsReconciled !== true) {
    return { shouldContinue: false, outcome: 'unsafe-funds' };
  }
  if (statuses.includes('failed')) {
    return { shouldContinue: true, outcome: 'scenario-failed' };
  }
  if (statuses.length < expectedScenarios) {
    return { shouldContinue: true, outcome: 'dependency-prefix-incomplete' };
  }
  return { shouldContinue: true, outcome: 'complete' };
}

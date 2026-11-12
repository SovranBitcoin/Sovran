/** @jest-environment node */
import { executedSelection } from '../scripts/persistence/report';
import { baselineCases, caseTitle } from './releaseFixtures/cases';
const cases = baselineCases().slice(0, 2);
const report = (titles: readonly string[], status = 'passed') => ({
  success: true,
  testResults: [{ assertionResults: titles.map((title) => ({ ancestorTitles: [title], status })) }],
});
it('rejects a successful process/report when its executed cases differ from the declared selection', () => {
  expect(executedSelection(report([caseTitle(cases[0])]), cases)).toMatchObject({
    complete: false,
    problems: [expect.stringContaining('E2/baseline')],
  });
  expect(executedSelection(report(cases.map(caseTitle), 'pending'), cases).complete).toBe(false);
  expect(
    executedSelection(report([...cases.map(caseTitle), 'E99/extra [store]']), cases).complete
  ).toBe(false);
  expect(executedSelection(report(cases.map(caseTitle)), cases)).toMatchObject({
    complete: true,
    problems: [],
    success: true,
  });
});

import { z } from 'zod';
import { caseTitle, type UpgradeCase } from '../../__tests__/releaseFixtures/cases';
const reportSchema = z.object({
  success: z.boolean(),
  testResults: z.array(
    z.object({
      assertionResults: z.array(
        z.object({
          ancestorTitles: z.array(z.string()),
          status: z.string(),
        })
      ),
    })
  ),
});
/** A process exit alone cannot establish that the declared selection actually ran. */
export function executedSelection(raw: unknown, cases: readonly UpgradeCase[]) {
  const report = reportSchema.parse(raw);
  const assertions = report.testResults.flatMap((file) => file.assertionResults);
  const expected = new Set(cases.map(caseTitle));
  const actual = new Set(
    assertions.flatMap((assertion) =>
      assertion.ancestorTitles.filter((title) => /^E\d+\//.test(title))
    )
  );
  const problems: string[] = [];
  for (const title of expected) {
    const scoped = assertions.filter((assertion) => assertion.ancestorTitles.includes(title));
    if (!scoped.length) problems.push(`Selected case was not executed: ${title}`);
    else if (
      scoped.some((assertion) => assertion.status !== 'passed' && assertion.status !== 'failed')
    )
      problems.push(`Selected case contains skipped assertions: ${title}`);
  }
  for (const title of actual)
    if (!expected.has(title)) problems.push(`Unexpected case was executed: ${title}`);
  return { complete: problems.length === 0, problems, cases: [...actual], success: report.success };
}

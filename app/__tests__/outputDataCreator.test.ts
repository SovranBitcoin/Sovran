/** @jest-environment node */

import { OutputData } from '@cashu/cashu-ts';
import { resolveOutputDataCreator } from '@/shared/lib/cashu/outputDataCreator';

describe('Cashu crypto backend gate', () => {
  it('rejects CDK selection until official bindings are integrated', () => {
    expect(() => resolveOutputDataCreator('cdk')).toThrow(
      'Official CDK bindings are not integrated; use the cashu-ts backend.'
    );
  });

  it('uses cashu-ts directly without instrumentation', () => {
    expect(resolveOutputDataCreator()).toBe(OutputData);
  });
});

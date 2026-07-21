import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('onboarding Terms e2e selector', () => {
  it('exposes one stable cross-platform checked control', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'features/onboarding/screens/TermsAndConditionsScreen.tsx'),
      'utf8'
    );

    expect(source).toContain('testID="terms-acceptance"');
    expect(source).toContain('accessibilityRole="checkbox"');
    expect(source).toContain('accessibilityState={{ checked: isChecked }}');
    expect(source).toContain("accessibilityValue={{ text: isChecked ? '1' : '0' }}");
  });
});

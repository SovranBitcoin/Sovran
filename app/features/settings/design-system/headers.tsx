import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { HeaderGradient } from '@/shared/ui/composed/HeaderGradient';
import { IdentityHeader } from '@/shared/ui/composed/IdentityHeader';
import { View } from '@/shared/ui/primitives/View/View';
import type { DesignSystemScenario } from './types';

function GradientPreview() {
  const backgroundColor = useThemeColor('surface');
  return <HeaderGradient backgroundColor={backgroundColor} height={96} />;
}

export const HEADER_SCENARIOS: readonly DesignSystemScenario[] = [
  {
    id: 'gradient',
    title: 'Gradient',
    covers: ['shared/ui/composed/HeaderGradient.tsx'],
    render: () => <GradientPreview />,
  },
  {
    id: 'identity',
    title: 'Compact identity',
    covers: ['shared/ui/composed/IdentityHeader.tsx'],
    render: () => (
      <View className="items-center py-4">
        <IdentityHeader name="Pay Alex with a long display name" seed="header-example-alex" />
      </View>
    ),
  },
];

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { HeaderGradient } from '@/shared/ui/composed/HeaderGradient';
import { IdentityBarTitle, IdentityNameBand } from '@/shared/ui/composed/IdentityHeader';
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
    title: 'Bar identity',
    covers: ['shared/ui/composed/IdentityHeader.tsx'],
    // The two halves as the bar stacks them: the picture at header-button size
    // on the bar's own row, the name in the band directly beneath it.
    render: () => (
      <View className="items-center py-4">
        <IdentityBarTitle name="Pay Alex with a long display name" seed="header-example-alex" />
        <IdentityNameBand name="Pay Alex with a long display name" />
      </View>
    ),
  },
];

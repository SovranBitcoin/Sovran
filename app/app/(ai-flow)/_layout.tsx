/**
 * AI flow modal layout.
 *
 * Mirrors `(mint-flow)`: a nested stack inside the root modal presentation, so
 * provider details push horizontally the way mint details do.
 */

import { Stack } from 'expo-router';
import { AndroidSheetFlowStack } from '../../config/flowLayoutOptions';

const PROVIDERS_OPTIONS = { title: 'AI provider' };
const PROVIDER_OPTIONS = { title: 'Provider details' };

export default function AiFlowLayout() {
  return (
    <AndroidSheetFlowStack>
      <Stack.Screen name="providers" options={PROVIDERS_OPTIONS} />
      <Stack.Screen name="provider" options={PROVIDER_OPTIONS} />
    </AndroidSheetFlowStack>
  );
}

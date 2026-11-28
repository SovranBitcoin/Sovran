/**
 * @fileoverview Settings Flow Layout
 *
 * Nested stack for the settings pages. The root Stack presents this group as a
 * pushed page (`slideFromRight('(settings-flow)')` in config/modalScreens.ts);
 * screens within push horizontally with a back header. Being a pushed page,
 * not a sheet, its first screen goes back with the arrow on iOS too.
 */

import { Stack } from 'expo-router';
import { FlowStack } from '../../config/flowLayoutOptions';

// Redirects to the Settings tab; no header flashes on the way.
const INDEX_OPTIONS = { headerShown: false };
const PROFILE_OPTIONS = { title: 'Profile' };
const ROUTING_OPTIONS = { title: 'Swap routing' };
const NETWORK_OPTIONS = { title: 'Network' };
const KEYRING_OPTIONS = { title: 'P2PK Keys' };
const STORAGE_OPTIONS = { title: 'Storage inventory' };
const DESIGN_SYSTEM_OPTIONS = { title: 'Design system' };
const DESIGN_SYSTEM_FOUNDATIONS_OPTIONS = { title: 'Foundations' };
const DESIGN_SYSTEM_WALLET_CONTROLS_OPTIONS = { title: 'Wallet controls' };
const DESIGN_SYSTEM_UI_KIT_OPTIONS = { title: 'State-locked UI kit' };
const DESIGN_SYSTEM_SCRUBBER_OPTIONS = { title: 'Animation frame scrubber' };
const DESIGN_SYSTEM_LOADING_OPTIONS = { title: 'Loading indicator' };
const DESIGN_SYSTEM_SEGMENTED_OPTIONS = { title: 'Segmented progress' };
const DESIGN_SYSTEM_TIMELINE_OPTIONS = { title: 'Timeline' };
const DESIGN_SYSTEM_TIMELINE_MATRIX_OPTIONS = { title: 'Timeline states' };
const DESIGN_SYSTEM_EMPTY_STATES_OPTIONS = { title: 'Empty states' };
const DESIGN_SYSTEM_SKELETON_CROSSFADE_OPTIONS = { title: 'Skeleton crossfade' };
const DESIGN_SYSTEM_FADE_STRESS_OPTIONS = { title: 'Fade-reveal stress' };
const DESIGN_SYSTEM_SCREENS_OPTIONS = { title: 'Screens' };
const DESIGN_SYSTEM_VARIATIONS_OPTIONS = { title: 'Variations' };
const DESIGN_SYSTEM_PROMPTS_OPTIONS = { title: 'Prompts' };
// A blocking screen has no header in the app; the one page that has sets its own title.
const DESIGN_SYSTEM_PROMPT_OPTIONS = { headerShown: false };
const RECOVERY_OPTIONS = { title: 'Recover wallet' };
const DELETE_OPTIONS = { title: 'Delete account' };

export default function SettingsFlowLayout() {
  return (
    <FlowStack pushed>
      <Stack.Screen name="index" options={INDEX_OPTIONS} />
      <Stack.Screen name="profile" options={PROFILE_OPTIONS} />
      <Stack.Screen name="edit-profile" options={{ title: 'Edit profile' }} />
      <Stack.Screen name="routing" options={ROUTING_OPTIONS} />
      <Stack.Screen name="network" options={NETWORK_OPTIONS} />
      <Stack.Screen name="keyring" options={KEYRING_OPTIONS} />
      <Stack.Screen name="storage" options={STORAGE_OPTIONS} />
      <Stack.Screen name="terms" options={{ title: 'Terms and Conditions' }} />
      <Stack.Screen name="privacy" options={{ title: 'Privacy Policy' }} />
      <Stack.Screen name="design-system-headers" options={{ title: 'Headers' }} />
      <Stack.Screen name="design-system" options={DESIGN_SYSTEM_OPTIONS} />
      <Stack.Screen name="design-system-foundations" options={DESIGN_SYSTEM_FOUNDATIONS_OPTIONS} />
      <Stack.Screen
        name="design-system-wallet-controls"
        options={DESIGN_SYSTEM_WALLET_CONTROLS_OPTIONS}
      />
      <Stack.Screen name="design-system-ui-kit" options={DESIGN_SYSTEM_UI_KIT_OPTIONS} />
      <Stack.Screen name="design-system-scrubber" options={DESIGN_SYSTEM_SCRUBBER_OPTIONS} />
      <Stack.Screen name="design-system-loading" options={DESIGN_SYSTEM_LOADING_OPTIONS} />
      <Stack.Screen name="design-system-segmented" options={DESIGN_SYSTEM_SEGMENTED_OPTIONS} />
      <Stack.Screen name="design-system-timeline" options={DESIGN_SYSTEM_TIMELINE_OPTIONS} />
      <Stack.Screen
        name="design-system-timeline-matrix"
        options={DESIGN_SYSTEM_TIMELINE_MATRIX_OPTIONS}
      />
      <Stack.Screen
        name="design-system-empty-states"
        options={DESIGN_SYSTEM_EMPTY_STATES_OPTIONS}
      />
      <Stack.Screen
        name="design-system-skeleton-crossfade"
        options={DESIGN_SYSTEM_SKELETON_CROSSFADE_OPTIONS}
      />
      <Stack.Screen name="design-system-fade-stress" options={DESIGN_SYSTEM_FADE_STRESS_OPTIONS} />
      <Stack.Screen name="design-system-screens" options={DESIGN_SYSTEM_SCREENS_OPTIONS} />
      <Stack.Screen name="design-system-variations" options={DESIGN_SYSTEM_VARIATIONS_OPTIONS} />
      <Stack.Screen name="design-system-prompts" options={DESIGN_SYSTEM_PROMPTS_OPTIONS} />
      <Stack.Screen name="design-system-prompt" options={DESIGN_SYSTEM_PROMPT_OPTIONS} />
      <Stack.Screen name="recovery" options={RECOVERY_OPTIONS} />
      <Stack.Screen name="delete" options={DELETE_OPTIONS} />
    </FlowStack>
  );
}

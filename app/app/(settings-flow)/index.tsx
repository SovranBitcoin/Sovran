import { Redirect } from 'expo-router';

/** Settings is a tab (ADR 0035); a link to the old Settings page lands there. */
export default function SettingsFlowIndex() {
  return <Redirect href="/(drawer)/(tabs)/settings" />;
}

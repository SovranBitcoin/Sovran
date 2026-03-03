import { withSheetProvider } from 'hocs/withSheetProvider';

import { ClaimUsernameScreen } from '@/features/onboarding';

function ClaimUsernameRoute() {
  return <ClaimUsernameScreen />;
}

export default withSheetProvider(ClaimUsernameRoute);

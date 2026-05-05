import { makeStaticPopup, makeParamPopup } from './factory';

export const devModePopup = makeParamPopup<boolean>((enabled) => ({
  message: enabled ? 'Developer mode enabled' : 'Developer mode disabled',
  icon: 'icon:material-symbols:report-rounded',
  type: 'success',
}));

export const deeplinkFailedPopup = makeStaticPopup({
  message: 'Failed to process link',
  icon: 'icon:lucide:link',
  type: 'error',
});

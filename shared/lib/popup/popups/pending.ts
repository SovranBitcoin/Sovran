import { makeParamPopup } from './factory';

export const rollbackSuccessPopup = makeParamPopup<{ count: number }>(({ count }) => ({
  message: `Successfully rolled back ${count} transaction${count !== 1 ? 's' : ''}`,
  icon: 'icon:mdi:cash-multiple',
  type: 'success',
}));

export const rollbackPartialPopup = makeParamPopup<{
  success: number;
  failed: number;
  total: number;
}>(({ success, failed, total }) => ({
  message: `Rolled back ${success}, failed ${failed}`,
  icon: 'icon:mdi:alert-circle-outline',
  type: failed === total ? 'error' : 'warning',
}));

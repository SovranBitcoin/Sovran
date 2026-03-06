import { popup } from '../engine';
import type { BaseOverrides } from './types';

export function rollbackSuccessPopup(params: { count: number }, overrides?: BaseOverrides): void {
  popup({
    message: `Successfully rolled back ${params.count} transaction${params.count !== 1 ? 's' : ''}`,
    icon: 'icon:mdi:cash-refund',
    type: 'success',
    ...overrides,
  });
}

export function rollbackPartialPopup(params: {
  success: number;
  failed: number;
  total: number;
}): void {
  popup({
    message: `Rolled back ${params.success}, failed ${params.failed}`,
    icon: 'icon:mdi:alert-circle-outline',
    type: params.failed === params.total ? 'error' : 'warning',
  });
}

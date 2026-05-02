import type { ReactNode } from 'react';
import { popup } from '../engine';
import type { PopupIcon } from '../icons';
import type { PopupTextSegment } from '../format';
import type { BaseOverrides, TextOverrides } from './types';

type PopupType = 'success' | 'error' | 'warning' | 'info';
type PopupVariant = 'toast' | 'sheet';

type PopupSpec = {
  message: string;
  text?: string | ReactNode | PopupTextSegment[];
  icon?: PopupIcon;
  type?: PopupType;
  variant?: PopupVariant;
  buttons?: { text: string; page?: string; onPress?: () => void }[];
};

/**
 * Build a popup wrapper that takes only optional overrides. Wrappers built
 * this way replace ~6 lines of `popup({ message, text, icon, type, ...overrides })`
 * boilerplate with a single declaration.
 */
export function makeStaticPopup<O extends BaseOverrides = TextOverrides>(spec: PopupSpec) {
  return (overrides?: O): void => popup({ ...spec, ...overrides });
}

/**
 * Build a popup wrapper that takes a params object (used to interpolate copy
 * or branch on state) plus optional overrides. The builder receives the
 * params and returns a fully-resolved spec.
 */
export function makeParamPopup<P, O extends BaseOverrides = BaseOverrides>(
  build: (params: P) => PopupSpec
) {
  return (params: P, overrides?: O): void => popup({ ...build(params), ...overrides });
}

export {
  createScreenActionManager,
  shouldApplyEntryUpdate,
  mergeEntryUpdate,
  decorateEntry,
  meltOperationToScreenActionEntry,
  type MeltOperationLike,
} from './createManager';
export { getAvailableActions } from './availability';
export type {
  ActionAvailability,
  ActionHandler,
  ActionState,
  DecoratedEntryFields,
  ScreenActionContext,
  ScreenActionHandlerMap,
  ScreenActionManager,
  ScreenActionName,
  ScreenType,
} from './types';

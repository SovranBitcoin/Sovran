/**
 * Renders a `ViewState<T>` in one slot: the skeleton while `loading`, then a
 * crossfade (through `SkeletonContentCrossfade`) into whichever of `ready`,
 * `empty` or `error` arrived.
 *
 * `ready`, `refreshing` and `stale` all render through `renderData` at the
 * same place in the tree, so moving between them never remounts the content:
 * a list keeps its scroll position and its rows keep their state while a
 * refresh runs or after it fails. `renderData` is told which of the three it
 * is drawing so it can add a quiet "updating" or "out of date" mark.
 *
 * Use it instead of `{isLoading && …}` branches; the
 * `view-state/no-jsx-loading-branch` lint rule points here.
 */

import { Fragment, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { matchViewState, type ViewState } from '@/shared/lib/viewState';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';

interface StateSwitchDataInfo {
  status: 'ready' | 'refreshing' | 'stale';
  /** Why the data is stale, when a reload failed. */
  error?: unknown;
}

interface StateSwitchProps<T> {
  state: ViewState<T>;
  /** The placeholder; share the content's chrome so the swap shifts nothing. */
  renderLoading: () => ReactNode;
  /** The data, for `ready`, `refreshing` and `stale` alike. */
  renderData: (data: T, info: StateSwitchDataInfo) => ReactNode;
  /** Loaded, and nothing there. Renders nothing when omitted. */
  renderEmpty?: () => ReactNode;
  /** The load failed with nothing to show. Renders nothing when omitted. */
  renderError?: (error: unknown) => ReactNode;
  /** Passed to `SkeletonContentCrossfade`. */
  wave?: 'region' | 'none';
  /** Passed to `SkeletonContentCrossfade`. */
  exit?: 'fade' | 'none';
  /** Passed to `SkeletonContentCrossfade`. */
  surfaceColor?: string;
  /** Passed to `SkeletonContentCrossfade`. */
  crossfadeContent?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  visualKey?: string;
  visualSurface?: string;
  visualDisabled?: boolean;
}

// One key per kind of content: the three data states share a key, so React
// keeps that subtree; data ↔ empty ↔ error swap it.
const DATA_KEY = 'data';

export function StateSwitch<T>({
  state,
  renderLoading,
  renderData,
  renderEmpty,
  renderError,
  wave,
  exit,
  surfaceColor,
  crossfadeContent,
  style,
  testID,
  visualKey,
  visualSurface,
  visualDisabled,
}: StateSwitchProps<T>) {
  const renderContent = () =>
    matchViewState<T, ReactNode>(state, {
      loading: () => null,
      empty: () => <Fragment key="empty">{renderEmpty?.() ?? null}</Fragment>,
      error: (error) => <Fragment key="error">{renderError?.(error) ?? null}</Fragment>,
      ready: (data) => <Fragment key={DATA_KEY}>{renderData(data, { status: 'ready' })}</Fragment>,
      refreshing: (data) => (
        <Fragment key={DATA_KEY}>{renderData(data, { status: 'refreshing' })}</Fragment>
      ),
      stale: (data, error) => (
        <Fragment key={DATA_KEY}>{renderData(data, { status: 'stale', error })}</Fragment>
      ),
    });

  return (
    <SkeletonContentCrossfade
      loading={state.status === 'loading'}
      renderSkeleton={renderLoading}
      renderContent={renderContent}
      wave={wave}
      exit={exit}
      surfaceColor={surfaceColor}
      crossfadeContent={crossfadeContent}
      style={style}
      testID={testID}
      visualKey={visualKey}
      visualSurface={visualSurface}
      visualComponent="StateSwitch"
      visualDisabled={visualDisabled}
    />
  );
}

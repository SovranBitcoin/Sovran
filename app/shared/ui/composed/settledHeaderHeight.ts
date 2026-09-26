/**
 * The iOS twin of `SheetHeaderHeightContext`: a header height that is right on
 * the first frame of a page, not half a second later.
 *
 * native-stack seeds HeaderHeightContext with a guess and only corrects it when
 * the native header reports its real height, after the push lands. The guess
 * is wrong in both directions: a modal flow's nested stack is taken for a
 * full-screen card (83 guessed, 70 real in a sheet on iOS 26), and the settings
 * stack's glass header is taller than the default (83 guessed, 93 real). Every
 * page padded by that value slid 10–13pt some 300–1000ms after it opened.
 *
 * Android does not need this — its flows use a JS header of known height,
 * published through `SheetHeaderHeightContext`. iOS's native header height
 * varies by stack, OS version and device, so instead of a constant this
 * remembers the height each stack settled to and starts its pages there. It is
 * kept across launches, so only a stack's first page on a device (or after an
 * OS update changes the header) pays for the correction.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContext } from 'expo-router/react-navigation';
import { useContext, useEffect, useRef, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

/** Settled height per stack and orientation. The stack is named by its route
 *  names: stable across mounts, unlike its state key, and different for every
 *  navigator whose header could differ. */
const settled: Record<string, number> = {};

const STORAGE_KEY = 'ui.settledHeaderHeight.v1';

/** A page whose native header never reaches the remembered height has a
 *  different header; stop overriding and trust the navigator. */
const TRUST_NAVIGATOR_AFTER_MS = 3000;

let loading: Promise<void> | null = null;

/**
 * Read the stored heights. Called from the root layout at launch: imports are
 * evaluated lazily, so waiting for this module to load would start the read on
 * the very render that needs its answer. Idempotent. A value learned this
 * session before the read lands wins over the stored one.
 */
export function loadSettledHeaderHeights(): Promise<void> {
  if (Platform.OS !== 'ios') return Promise.resolve();
  loading ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      const stored: unknown = raw ? JSON.parse(raw) : null;
      if (typeof stored !== 'object' || stored === null) return;
      for (const [key, value] of Object.entries(stored)) {
        if (typeof value === 'number' && value > 0) settled[key] ??= value;
      }
    })
    .catch(() => undefined);
  return loading;
}

function remember(key: string, value: number) {
  if (settled[key] === value) return;
  settled[key] = value;
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settled)).catch(() => undefined);
}

export function useSettledHeaderHeight(navigatorHeight: number): number {
  const navigation = useContext(NavigationContext);
  const { width, height } = useWindowDimensions();
  const orientation = width > height ? 'landscape' : 'portrait';
  const stack = navigation?.getState()?.routeNames?.join(',');
  const key = Platform.OS === 'ios' && stack ? `${stack}|${orientation}` : null;
  const [remembered] = useState(() => (key ? settled[key] : undefined));
  const firstValue = useRef(navigatorHeight);
  const [released, setReleased] = useState(false);
  const reached = navigatorHeight === remembered;
  const overriding = remembered !== undefined && !reached && !released;

  // Only a change after mount is the native header reporting in; the
  // navigator's first value is its own guess.
  useEffect(() => {
    if (!key || navigatorHeight <= 0 || navigatorHeight === firstValue.current) return;
    remember(key, navigatorHeight);
  }, [key, navigatorHeight]);

  useEffect(() => {
    if (reached) setReleased(true);
  }, [reached]);

  useEffect(() => {
    if (!overriding) return;
    const timer = setTimeout(() => setReleased(true), TRUST_NAVIGATOR_AFTER_MS);
    return () => clearTimeout(timer);
  }, [overriding]);

  return overriding ? remembered : navigatorHeight;
}

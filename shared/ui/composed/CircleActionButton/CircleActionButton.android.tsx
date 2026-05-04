/**
 * Android variant of `CircleActionButton`. Shares implementation with the
 * iOS file — platform extensions pick the right one at bundle time. Kept
 * as a thin re-export so future Android-specific tweaks have a home.
 */
export { CircleActionButton } from './CircleActionButton.ios';

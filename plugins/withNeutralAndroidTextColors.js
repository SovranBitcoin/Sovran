/**
 * Neutralizes Android's stock AppCompat teal on text fields.
 *
 * Nothing in the app sets colorAccent/colorControlActivated, so EditText
 * carets, selection teardrop handles, and the selection highlight fall back
 * to AppCompat's default teal — unrelated to any app theme and jarring next
 * to the runtime palettes. Runtime themes are dynamic per profile/wallpaper,
 * so a static XML value can only be a NEUTRAL; per-input theme-accurate
 * tinting (cursorColor/selectionHandleColor props) can layer on top later.
 */
const { withAndroidStyles } = require('expo/config-plugins');

// Build-time config plugin: these land as literal strings in Android style
// XML at prebuild — the theme system / brandColors (TS, runtime) can't reach
// here, so the hex-color lint rule doesn't apply.
// Material blue-gray — legible as a caret on both dark and light surfaces.
// eslint-disable-next-line no-restricted-syntax
const NEUTRAL = '#90A4AE';
// Selection highlight wants low alpha (#AARRGGBB) or selected text is unreadable.
// eslint-disable-next-line no-restricted-syntax
const NEUTRAL_HIGHLIGHT = '#3D90A4AE';

const ITEMS = [
  ['colorAccent', NEUTRAL],
  ['colorControlActivated', NEUTRAL],
  ['android:textColorHighlight', NEUTRAL_HIGHLIGHT],
];

module.exports = function withNeutralAndroidTextColors(config) {
  return withAndroidStyles(config, (cfg) => {
    const appTheme = cfg.modResults.resources.style?.find((s) => s.$.name === 'AppTheme');
    if (!appTheme) {
      throw new Error('withNeutralAndroidTextColors: AppTheme style not found in styles.xml');
    }
    appTheme.item = appTheme.item ?? [];
    for (const [name, value] of ITEMS) {
      appTheme.item = appTheme.item.filter((item) => item.$.name !== name);
      appTheme.item.push({ $: { name }, _: value });
    }
    return cfg;
  });
};

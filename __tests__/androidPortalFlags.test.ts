import { readFileSync } from 'fs';
import { relative, resolve } from 'path';

const ROOT = resolve(__dirname, '..');

const PORTAL_FILES = [
  'features/send/screens/SendTokenScreen.tsx',
  'features/wallet/components/FiatCurrencyPill/FiatCurrencyPill.androidMenu.tsx',
  'features/wallet/screens/WalletScreen.tsx',
  'shared/blocks/popup/ActionMenuHost.tsx',
  'shared/blocks/popup/PopupHost.tsx',
  'shared/ui/composed/ActionMenuButton.tsx',
  'shared/ui/composed/ButtonHandler.tsx',
];

function portalLinesWithoutAndroidOverlayOptOut(file: string): string[] {
  return readFileSync(resolve(ROOT, file), 'utf8')
    .split('\n')
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /<\s*(Menu|BottomSheet)\.Portal\b/.test(line))
    .filter(({ line }) => !line.includes('disableFullWindowOverlay'))
    .map(({ line, index }) => `${relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
}

describe('Android portal flags', () => {
  it('opts local HeroUI menu and sheet portals out of Android full-window overlays', () => {
    const missing = PORTAL_FILES.flatMap(portalLinesWithoutAndroidOverlayOptOut);

    expect(missing).toEqual([]);
  });

  it('keeps the feed image overlay off react-native-screens FullWindowOverlay on Android', () => {
    const source = readFileSync(
      resolve(ROOT, 'features/feed/components/nostr/image-overlay/AnimatedImageOverlay.tsx'),
      'utf8'
    );

    expect(source).toContain("Platform.OS === 'android'");
    expect(source).toContain('<Modal');
    expect(source).toContain('navigationBarTranslucent');
    expect(source).toContain('<GestureHandlerRootView');
    expect(source).toContain("Platform.OS === 'ios'");
    expect(source).toContain('<FullWindowOverlay>{content}</FullWindowOverlay>');
  });

  it('measures the Android QR boot-morph anchor in window coordinates', () => {
    const source = readFileSync(
      resolve(ROOT, 'shared/ui/composed/QRButton/QRButton.android.tsx'),
      'utf8'
    );

    expect(source).toContain('measureInWindow');
    expect(source).not.toMatch(/\bmeasure\(/);
    expect(source).not.toContain('runOnUI');
  });

  it('keeps the custom Android header-left profile button on a flat touch surface', () => {
    const source = readFileSync(resolve(ROOT, 'shared/blocks/HeaderProfileButton.tsx'), 'utf8');

    expect(source).toContain("Platform.OS === 'android'");
    expect(source).toContain('ANDROID_BUTTON_SIZE = 44');
    expect(source).toContain('backgroundColor: flatSurface');
  });

  it('keeps Android bottom footers out of the masked blur native path', () => {
    const source = readFileSync(resolve(ROOT, 'shared/ui/composed/BottomButtons.tsx'), 'utf8');

    expect(source).toContain("blur && Platform.OS !== 'android'");
    expect(source).toContain('shouldRenderBlur');
  });

  it('keeps button text wrappers mounted before Android loading transitions', () => {
    const source = readFileSync(resolve(ROOT, 'shared/ui/primitives/Button.tsx'), 'utf8');

    expect(source).toContain('collapsable={false}');
    expect(source).toContain('styles.hiddenContent');
  });
});

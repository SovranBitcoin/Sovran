import { describe, expect, it } from 'bun:test';
import { parseUiautomatorXml } from './ax-adapter';
import { classifyObservedState, findElement } from '../ax';
import { escapeInputText } from './adb';

// A trimmed, structurally faithful uiautomator dump: RN testIDs in
// resource-id, native Switch semantics, an id-only probe whose content-desc
// carries the value payload, XML entities, and an off-screen carousel dupe.
const XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.sovranbitcoin.dev" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="wallet-send" class="android.view.ViewGroup" content-desc="Send" checkable="false" checked="false" clickable="true" enabled="true" bounds="[60,2000][520,2120]" />
    <node index="1" text="" resource-id="wallet-receive" class="android.view.ViewGroup" content-desc="Receive" checkable="false" checked="false" clickable="true" enabled="true" bounds="[560,2000][1020,2120]" />
    <node index="2" text="&#8383; 100" resource-id="wallet-balance" class="android.widget.TextView" content-desc="" checkable="false" enabled="true" bounds="[300,400][780,500]" />
    <node index="3" text="" resource-id="settings-mock-offline-toggle" class="android.widget.Switch" content-desc="Mock offline" checkable="true" checked="true" enabled="true" bounds="[800,900][1000,980]" />
    <node index="9" text="" resource-id="filter-mint-https://mint.minibits.cash/Bitcoin" class="android.view.ViewGroup" content-desc="Minibits, 1" checkable="true" checked="true" enabled="true" bounds="[40,1000][500,1080]" />
    <node index="10" text="" resource-id="notification-policy-strict" class="android.widget.RadioButton" content-desc="Strict, 1" checkable="true" checked="true" enabled="true" bounds="[40,1100][500,1180]" />
    <node index="11" text="" resource-id="profile-reveal-mnemonic" class="android.widget.Switch" content-desc="Hide, 1" checkable="true" checked="true" enabled="true" bounds="[40,1200][500,1280]" />
    <node index="4" text="" resource-id="transaction-probe-tx1" class="android.view.View" content-desc="{&quot;status&quot;:&quot;pending&quot;,&amp;more}" checkable="false" enabled="true" bounds="[0,0][1,1]" />
    <node index="8" text="https://testnut.cashu.space" resource-id="mint-add-search-input" class="android.widget.EditText" content-desc="Search mints" editable="true" enabled="true" bounds="[40,300][1040,400]" />
    <node index="5" text="Disabled row" resource-id="dead-row" class="android.view.ViewGroup" content-desc="" checkable="false" enabled="false" bounds="[0,1200][1080,1300]" />
    <node index="6" text="" resource-id="carousel-dupe" class="android.view.ViewGroup" content-desc="Off screen" enabled="true" bounds="[1200,0][2280,100]" />
    <node index="12" text="raw-private-value" resource-id="profile-secret-value-mnemonic" class="android.widget.EditText" content-desc="raw-private-label" editable="true" enabled="false" bounds="[1200,100][2280,200]" />
    <node index="7" text="" resource-id="" class="android.view.View" content-desc="" bounds="broken" />
  </node>
</hierarchy>`;

describe('parseUiautomatorXml', () => {
  const snap = parseUiautomatorXml(XML);

  it('takes screen dimensions from the root node when not supplied', () => {
    expect(snap.screen).toEqual({ width: 1080, height: 2400 });
  });

  it('maps resource-id → id and content-desc → label', () => {
    const send = findElement(snap, { id: 'wallet-send' });
    expect(send).not.toBeNull();
    expect(send!.label).toBe('Send');
    expect(send!.frame).toEqual({ x: 60, y: 2000, width: 460, height: 120 });
  });

  it('prefers text over content-desc for the label and decodes entities', () => {
    const balance = findElement(snap, { id: 'wallet-balance' });
    expect(balance!.label).toBe('₿ 100');
  });

  it('maps Switch checked state to the value convention', () => {
    const toggle = findElement(snap, { id: 'settings-mock-offline-toggle' });
    expect(toggle!.value).toBe('1');
    expect(toggle!.label).toBe('Mock offline');
  });

  it('prefers semantic checked state over a merged label/value description', () => {
    for (const [id, label] of [
      ['filter-mint-https://mint.minibits.cash/Bitcoin', 'Minibits, 1'],
      ['notification-policy-strict', 'Strict, 1'],
      ['profile-reveal-mnemonic', 'Hide, 1'],
    ] as const) {
      const option = findElement(snap, { id });
      expect(option!.label).toBe(label);
      expect(option!.value).toBe('1');
    }
  });

  it('exposes an id-only node content-desc as its value (probe convention)', () => {
    const probe = snap.elements.find((el) => el.id === 'transaction-probe-tx1');
    expect(probe!.value).toBe('{"status":"pending",&more}');
  });

  it('exposes an editable field content as value and the hint as label', () => {
    const field = findElement(snap, { id: 'mint-add-search-input' });
    expect(field!.value).toBe('https://testnut.cashu.space');
    expect(field!.label).toBe('Search mints');
    // resolvable by value so input()'s focus probe works
    const byValue = snap.elements.find((el) => el.id === 'mint-add-search-input');
    expect(byValue!.value).toBe('https://testnut.cashu.space');
  });

  it('carries enabled=false through', () => {
    const dead = snap.elements.find((el) => el.id === 'dead-row');
    expect(dead!.enabled).toBe(false);
  });

  it('drops nodes with unparseable bounds and off-screen matches', () => {
    expect(snap.elements.some((el) => el.frame.width === 0 && el.frame.height === 0)).toBe(false);
    expect(findElement(snap, { id: 'carousel-dupe' })).toBeNull();
  });

  it('redacts retained off-screen secret-profile values without losing stable id/state', () => {
    const secret = snap.elements.find((el) => el.id === 'profile-secret-value-mnemonic');

    expect(secret).toMatchObject({
      id: 'profile-secret-value-mnemonic',
      label: '‹profile-secret:redacted›',
      value: '‹profile-secret:redacted›',
      enabled: false,
    });
    expect(findElement(snap, { id: 'profile-secret-value-mnemonic' })).toBeNull();
  });

  it('feeds classifyObservedState the wallet controls', () => {
    expect(classifyObservedState(snap)).toBe('wallet');
  });

  it('classifies onboarding from labels', () => {
    const onboarding = parseUiautomatorXml(
      `<hierarchy><node text="Get Started" resource-id="" class="android.widget.TextView" enabled="true" bounds="[0,0][1080,2400]" /></hierarchy>`
    );
    expect(classifyObservedState(onboarding)).toBe('onboarding');
  });
});

describe('escapeInputText', () => {
  it('quotes and space-escapes safe text', () => {
    expect(escapeInputText('my wallet 2')).toBe("'my%swallet%s2'");
    expect(escapeInputText('user@host:8081/path?a=1&b=2')).toBe("'user@host:8081/path?a=1&b=2'");
    expect(escapeInputText('')).toBe('');
  });

  it('fails loudly on characters input text cannot deliver', () => {
    expect(() => escapeInputText('₿ 100')).toThrow(/cannot type/);
    expect(() => escapeInputText("it's")).toThrow(/cannot type/);
    expect(() => escapeInputText('multi\nline')).toThrow(/cannot type/);
  });
});

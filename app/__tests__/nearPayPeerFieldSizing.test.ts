import {
  buildPeerLayoutConfigForSizing,
  getPeerFieldSizing,
  getPeerFieldSizingStep,
  PEER_FIELD_HERO_MAX_PEERS,
  PEER_FIELD_STANDARD_MIN_PEERS,
} from '@/features/nearPay/lib/peerFieldSizing';

describe('getPeerFieldSizingStep', () => {
  it('picks the step from the count when there is no previous step', () => {
    expect(getPeerFieldSizingStep(0, null)).toBe('hero');
    expect(getPeerFieldSizingStep(PEER_FIELD_HERO_MAX_PEERS, null)).toBe('hero');
    expect(getPeerFieldSizingStep(PEER_FIELD_HERO_MAX_PEERS + 1, null)).toBe('standard');
    expect(getPeerFieldSizingStep(20, null)).toBe('standard');
  });

  it('holds hero through the hysteresis gap and exits only at the standard floor', () => {
    expect(getPeerFieldSizingStep(7, 'hero')).toBe('hero');
    expect(getPeerFieldSizingStep(PEER_FIELD_STANDARD_MIN_PEERS, 'hero')).toBe('standard');
  });

  it('holds standard through the gap and re-enters hero only at the hero ceiling', () => {
    expect(getPeerFieldSizingStep(7, 'standard')).toBe('standard');
    expect(getPeerFieldSizingStep(PEER_FIELD_HERO_MAX_PEERS, 'standard')).toBe('hero');
  });

  it('never flaps across a 6↔7↔6 churn once hero', () => {
    let step = getPeerFieldSizingStep(5, null);
    for (const count of [6, 7, 6, 7, 7, 6]) {
      step = getPeerFieldSizingStep(count, step);
      expect(step).toBe('hero');
    }
  });
});

describe('getPeerFieldSizing', () => {
  it('standard step reproduces the originally shipped radar constants', () => {
    const sizing = getPeerFieldSizing('standard');
    expect(sizing).toMatchObject({
      avatarSize: 48,
      nodeWidth: 76,
      nodeHeight: 74,
      avatarTop: 4,
      avatarCenterY: 28,
      edgeScaleFalloff: 96,
      labelFontSize: 10,
      bearerBadgeSize: 18,
    });
  });

  it('hero step preserves the node deltas around the larger avatar', () => {
    const standard = getPeerFieldSizing('standard');
    const hero = getPeerFieldSizing('hero');
    expect(hero.avatarSize).toBe(72);
    expect(hero.nodeWidth - hero.avatarSize).toBe(standard.nodeWidth - standard.avatarSize);
    expect(hero.nodeHeight - hero.avatarSize).toBe(standard.nodeHeight - standard.avatarSize);
    expect(hero.avatarCenterY).toBe(hero.avatarTop + hero.avatarSize / 2);
    expect(hero.edgeScaleFalloff).toBe(hero.avatarSize * 2);
  });

  it('returns stable singletons (the memo-comparator contract)', () => {
    expect(getPeerFieldSizing('hero')).toBe(getPeerFieldSizing('hero'));
    expect(getPeerFieldSizing('standard')).toBe(getPeerFieldSizing('standard'));
  });
});

describe('buildPeerLayoutConfigForSizing', () => {
  it('standard config matches the historical PEER_LAYOUT_CONFIG shape', () => {
    expect(buildPeerLayoutConfigForSizing(getPeerFieldSizing('standard'), 124)).toEqual({
      nodeWidth: 76,
      nodeHeight: 74,
      avatarSize: 48,
      avatarGap: 8,
      spaciousAvatarGap: 48,
      spaciousPeerCount: 7,
      densePeerCount: 31,
      spacingCapPeerCount: 20,
      preferredTopInset: 80,
      preferredBottomInset: 124,
      edgePadding: 0,
      edgeScaleFalloff: 96,
      edgeBoundaryScale: 0.9,
      edgeTranslationStrength: 1,
      minVisibleScale: 0.16,
      labelMinScale: 0.58,
    });
  });

  it('hero config scales only the size-derived fields', () => {
    const standard = buildPeerLayoutConfigForSizing(getPeerFieldSizing('standard'), 124);
    const hero = buildPeerLayoutConfigForSizing(getPeerFieldSizing('hero'), 124);
    expect(hero.avatarSize).toBe(72);
    expect(hero.nodeWidth).toBe(100);
    expect(hero.nodeHeight).toBe(98);
    expect(hero.edgeScaleFalloff).toBe(144);
    // Honeycomb tuning is shared: spacious centers sit avatarSize + gap apart.
    expect(hero.spaciousAvatarGap).toBe(standard.spaciousAvatarGap);
    expect(hero.avatarSize + hero.spaciousAvatarGap).toBe(120);
  });
});

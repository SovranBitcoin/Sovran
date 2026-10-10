/**
 * @fileoverview The shape of the app's look.
 *
 * A wallpaper (`themes.ts`, `themeEngine.ts`) answers "what colour is it".
 * This answers what a recolour cannot reach: the spacing system, how round,
 * how surfaces separate from the canvas, the type, the tab bar. The look in
 * `./registry` is data in this shape; `useStylePaint` is the only code that
 * turns it into colours and view styles.
 *
 * Two rules are encoded in the shape rather than left to taste:
 *  - Spacing is named by the RELATIONSHIP it expresses, and the scale is
 *    ordered (`related < item < group < section`), so things that belong
 *    together sit closer than things that do not.
 *  - A surface separates from the canvas by exactly ONE mechanism. There is no
 *    way to ask for a fill and a border together.
 */

/** The one mechanism by which a surface separates from the canvas. */
export type SurfaceKind =
  /** No container. Whitespace and hairline dividers do the grouping. */
  | 'flat'
  /** A fill a perceptible step off the canvas. No stroke. */
  | 'tonal'
  /** A stroke. No fill. */
  | 'outline'
  /** Translucent material where the OS renders it well (iOS 26 liquid glass);
   *  `tonal` everywhere else. Android never gets an imitation blur. */
  | 'glass';

export type TypeFamily = 'oxygen' | 'mona' | 'overpass';

export interface AppStyle {
  /**
   * Spacing, by relationship. Every gap on a styled screen is one of these.
   * A container's distance from its siblings is never smaller than its own
   * padding (`group >= pad`), which is what stops boxes looking crammed.
   */
  readonly space: {
    /** Screen edge to content. Headers, lists and footers all share it. */
    readonly gutter: number;
    /** Lines of one item: a title and its subtitle. */
    readonly related: number;
    /** Sibling items of one group. */
    readonly item: number;
    /** Groups within a section. */
    readonly group: number;
    /** Sections of a screen. */
    readonly section: number;
    /** Inside a container. */
    readonly pad: number;
  };

  /** Heights. Nothing interactive is shorter than `control`. */
  readonly size: {
    /** Secondary controls and chips' tap target. At least 48. */
    readonly control: number;
    /** The primary action. */
    readonly cta: number;
    /** A two-line list row. */
    readonly row: number;
  };

  readonly radius: {
    readonly card: number;
    /** Buttons and inputs. A pill in every style: the control shape is settled. */
    readonly control: number;
    /** Leading visuals in rows, small tiles. A circle in every style. */
    readonly chip: number;
  };

  readonly surface: SurfaceKind;

  readonly type: {
    readonly family: TypeFamily;
    /** The balance figure, in px. */
    readonly balance: number;
    readonly uppercaseLabels: boolean;
  };
}

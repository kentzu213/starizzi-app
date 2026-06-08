/**
 * Pure color helpers for the iOS 26 glass contrast property (Requirement 8).
 *
 * These functions implement the two primitives the design (Property 1, Testing
 * Strategy) requires:
 *   - `compositeOver(base, src)` — alpha compositing of a translucent layer
 *     (e.g. `--glass-bg`, or translucent text) over an opaque base color.
 *   - `wcagContrast(fg, bg)` — WCAG 2.1 contrast ratio using relative luminance
 *     and the (L1 + 0.05) / (L2 + 0.05) formula.
 *
 * No DOM, no side effects — they operate on plain color values so they can be
 * exercised across a large input space by property-based tests.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  /** Alpha in [0, 1]. */
  a: number;
}

/** Parse an `rgb()`, `rgba()`, or `#rrggbb` color string into RGBA (alpha defaults to 1). */
export function parseColor(value: string): Rgba {
  const rgba = value.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i,
  );
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] !== undefined ? Number(rgba[4]) : 1,
    };
  }
  const hex = value.match(/#([0-9a-f]{6})/i);
  if (hex) {
    const int = parseInt(hex[1], 16);
    return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255, a: 1 };
  }
  throw new Error(`No color found in "${value}"`);
}

/**
 * Alpha-composite a (possibly translucent) source layer over an opaque base
 * color using the standard "source over" operator, per channel:
 *   out = src * src.a + base * (1 - src.a)
 * The result is opaque (the base is assumed fully opaque).
 */
export function compositeOver(base: Rgb, src: Rgba): Rgb {
  const a = src.a;
  return {
    r: src.r * a + base.r * (1 - a),
    g: src.g * a + base.g * (1 - a),
    b: src.b * a + base.b * (1 - a),
  };
}

/** WCAG 2.1 relative luminance of an sRGB color (channels in [0, 255]). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG 2.1 contrast ratio between two opaque colors:
 *   (Llighter + 0.05) / (Ldarker + 0.05)
 * Always returns a value >= 1.
 */
export function wcagContrast(fg: Rgb, bg: Rgb): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

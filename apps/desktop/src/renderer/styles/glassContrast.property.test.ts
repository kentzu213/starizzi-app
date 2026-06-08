import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import {
  compositeOver,
  parseColor,
  relativeLuminance,
  wcagContrast,
  type Rgb,
  type Rgba,
} from './glassContrast';

/**
 * Property-based test for the iOS 26 glass redesign.
 *
 * Feature: ios26-glass-redesign, Property 1: Tương phản chữ trên nền kính đạt
 * ngưỡng WCAG trên toàn dải nền
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 *
 * The token values are parsed from the actual `index.css` :root cascade so the
 * test stays in sync with the source of truth (it asserts the *effective*
 * values after the Phase 4-6 override block).
 */

const cssPath = fileURLToPath(new URL('./index.css', import.meta.url));
const cssSource = readFileSync(cssPath, 'utf8');

// --- minimal :root token parser (cascade-aware: later block wins) ----------

function parseRootTokens(css: string): Map<string, string> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = new Map<string, string>();
  const rootRe = /:root\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = rootRe.exec(clean)) !== null) {
    const start = match.index + match[0].length;
    const end = clean.indexOf('}', start);
    if (end === -1) continue;
    for (const decl of clean.slice(start, end).split(';')) {
      const colon = decl.indexOf(':');
      if (colon === -1) continue;
      const name = decl.slice(0, colon).trim();
      const value = decl.slice(colon + 1).trim();
      if (name.startsWith('--') && value.length > 0) tokens.set(name, value);
    }
  }
  return tokens;
}

const tokens = parseRootTokens(cssSource);

function getToken(name: string): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`Missing token ${name} in :root`);
  return value;
}

// --- effective token values behind the glass surface -----------------------

/** The translucent glass layer painted by Bộ_Class_Glass. */
const glassBg: Rgba = parseColor(getToken('--glass-bg'));
/** Primary text color (itself translucent over the composited glass). */
const textPrimary: Rgba = parseColor(getToken('--color-text-primary'));

/**
 * Lmax endpoint: the brightest *opaque* app background that can sit behind the
 * glass surface. Per the design that is `--color-bg-hover` (#222222). We sweep
 * the base from pure black (#000000, the darkest app background) up to this.
 */
const brightestBase: Rgb = parseColor(getToken('--color-bg-hover'));

const SIZES = ['normal', 'large'] as const;
type Size = (typeof SIZES)[number];
const threshold = (s: Size): number => (s === 'normal' ? 4.5 : 3.0);

/**
 * Resolve the contrast ratio for a base luminance level `t` in [0, 1]:
 *   1. build an opaque base gray between #000000 and the brightest base,
 *   2. composite `--glass-bg` over it (the glass surface),
 *   3. composite the (translucent) primary text over that surface,
 *   4. measure WCAG contrast between text and surface.
 */
function contrastForBase(t: number): number {
  const base: Rgb = {
    r: brightestBase.r * t,
    g: brightestBase.g * t,
    b: brightestBase.b * t,
  };
  const surface = compositeOver(base, glassBg);
  const text = compositeOver(surface, textPrimary);
  return wcagContrast(text, surface);
}

describe('Feature: ios26-glass-redesign, Property 1: Tương phản chữ trên nền kính đạt ngưỡng WCAG trên toàn dải nền', () => {
  it('keeps text contrast >= WCAG threshold across the full background range (Req 8.1, 8.2, 8.3, 8.4, 8.5)', () => {
    fc.assert(
      fc.property(
        // base luminance level L over the app range [0 (#000000), Lmax (#222222)]
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom<Size>(...SIZES),
        (t, size) => {
          const ratio = contrastForBase(t);
          expect(ratio).toBeGreaterThanOrEqual(threshold(size));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('holds at the brightest-base worst case (Req 8.3, 8.5)', () => {
    // Brightest base behind the glass is the worst case for contrast; assert it
    // explicitly so the boundary required by Req 8.3/8.5 is covered directly.
    expect(contrastForBase(1)).toBeGreaterThanOrEqual(4.5);
  });

  it('uses a translucent glass background that actually composites (sanity)', () => {
    expect(glassBg.a).toBeGreaterThan(0);
    expect(glassBg.a).toBeLessThan(1);
    expect(relativeLuminance(brightestBase)).toBeGreaterThan(0);
  });
});

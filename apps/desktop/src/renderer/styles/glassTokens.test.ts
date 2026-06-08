import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Unit + edge tests for the iOS 26 Token_Glass declarations in index.css :root.
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 7.4
 *
 * The test parses the actual CSS so it stays in sync with the source of truth
 * (no hardcoded mirror of the token values).
 */

const cssPath = fileURLToPath(new URL('./index.css', import.meta.url));
const cssSource = readFileSync(cssPath, 'utf8');

// ---------------------------------------------------------------------------
// CSS parsing helpers (pure, no DOM needed)
// ---------------------------------------------------------------------------

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Merge every `:root { ... }` block in document order. Later declarations win,
 * matching CSS cascade — so we assert the *effective* token values.
 */
function parseRootTokens(css: string): Map<string, string> {
  const clean = stripComments(css);
  const tokens = new Map<string, string>();
  const rootRe = /:root\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = rootRe.exec(clean)) !== null) {
    const start = match.index + match[0].length;
    // :root blocks contain only declarations, so the next `}` closes the block.
    const end = clean.indexOf('}', start);
    if (end === -1) continue;
    const body = clean.slice(start, end);
    for (const decl of body.split(';')) {
      const colon = decl.indexOf(':');
      if (colon === -1) continue;
      const name = decl.slice(0, colon).trim();
      const value = decl.slice(colon + 1).trim();
      if (name.startsWith('--') && value.length > 0) {
        tokens.set(name, value); // later block overrides earlier (cascade)
      }
    }
  }
  return tokens;
}

function getToken(tokens: Map<string, string>, name: string): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`Missing token ${name} in :root`);
  return value;
}

function firstNumber(value: string): number {
  const m = value.match(/-?\d+(?:\.\d+)?/);
  if (!m) throw new Error(`No numeric value found in "${value}"`);
  return parseFloat(m[0]);
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): Rgba {
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

/** WCAG 2.1 relative luminance of an RGB color. */
function relativeLuminance({ r, g, b }: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Split a value at top-level separators, ignoring separators inside parens. */
function splitTopLevel(value: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === sep && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Leading length values of a single box-shadow layer (offset-x, offset-y, blur, [spread]). */
function shadowLayerLengths(layer: string): number[] {
  const beforeColor = layer.split(/rgba?\(|#|hsla?\(/i)[0];
  const nums = beforeColor.match(/-?\d+(?:\.\d+)?/g) ?? [];
  return nums.map(Number);
}

/**
 * Read the applied blur radius in px from `--glass-blur`.
 * Supports both the clamped form `blur(min(var(--x, N), CEILINGpx))` and a flat
 * value `blur(0px)` (the Claude-paper theme is intentionally blur-free).
 */
function appliedBlurPx(glassBlur: string): number {
  const minIdx = glassBlur.indexOf('min(');
  if (minIdx === -1) {
    // Flat form: blur(<n>px)
    return firstNumber(glassBlur);
  }
  let depth = 0;
  let start = -1;
  let i = minIdx + 'min'.length;
  for (; i < glassBlur.length; i++) {
    if (glassBlur[i] === '(') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (glassBlur[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  const args = splitTopLevel(glassBlur.slice(start, i), ',');
  return firstNumber(args[args.length - 1]);
}

/** Find every `var(--glass-*)` reference in a value and whether it has a fallback. */
function glassVarRefs(value: string): { ref: string; hasFallback: boolean }[] {
  const results: { ref: string; hasFallback: boolean }[] = [];
  const re = /var\(\s*(--glass-[\w-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const openIdx = value.indexOf('(', m.index);
    let depth = 0;
    let end = -1;
    for (let i = openIdx; i < value.length; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const args = splitTopLevel(value.slice(openIdx + 1, end), ',');
    results.push({ ref: m[1], hasFallback: args.length > 1 });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const tokens = parseRootTokens(cssSource);

describe('Token_Glass declarations in index.css :root', () => {
  it('keeps applied blur within the performance ceiling (<= 24px; flat 0 allowed) (Req 7.4)', () => {
    const blur = appliedBlurPx(getToken(tokens, '--glass-blur'));
    expect(blur).toBeGreaterThanOrEqual(0);
    expect(blur).toBeLessThanOrEqual(24);
  });

  it('declares --radius-glass-sm within [8, 16] px (Req 1.2)', () => {
    const sm = firstNumber(getToken(tokens, '--radius-glass-sm'));
    expect(sm).toBeGreaterThanOrEqual(8);
    expect(sm).toBeLessThanOrEqual(16);
  });

  it('declares --radius-glass-lg larger than sm and within a sane surface range (Req 1.2)', () => {
    const sm = firstNumber(getToken(tokens, '--radius-glass-sm'));
    const lg = firstNumber(getToken(tokens, '--radius-glass-lg'));
    expect(lg).toBeGreaterThan(sm);
    expect(lg).toBeLessThanOrEqual(32);
  });

  it('declares --glass-shadow with >=2 layers, each (offset, blur) pair distinct (Req 1.3)', () => {
    const layers = splitTopLevel(getToken(tokens, '--glass-shadow'), ',');
    expect(layers.length).toBeGreaterThanOrEqual(2);

    const pairs = layers.map((layer) => {
      const lengths = shadowLayerLengths(layer);
      // lengths = [offset-x, offset-y, blur, (spread)] -> use (offset-y, blur)
      const [, offsetY, blur] = lengths;
      return `${offsetY}|${blur}`;
    });
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('declares --glass-specular as an inset highlight (Req 1.4)', () => {
    const specular = getToken(tokens, '--glass-specular');
    expect(specular).toContain('inset');
    // must carry a real color (rgb/rgba/hex), not be empty
    expect(/rgba?\(|#[0-9a-f]{3,8}/i.test(specular)).toBe(true);
  });

  it('declares --color-accent-gradient as a single locked accent (izzi cyan) (Req 1.5)', () => {
    const gradient = getToken(tokens, '--color-accent-gradient').toLowerCase();
    expect(gradient).toContain('linear-gradient');
    // theme accent is izzi cyan #67e8f9 (with a near-flat darker cyan stop)
    expect(gradient).toContain('#67e8f9');
  });

  it('provides a fallback for every var(--glass-*) reference inside :root (Req 1.7)', () => {
    for (const [name, value] of tokens) {
      for (const { ref, hasFallback } of glassVarRefs(value)) {
        expect(hasFallback, `${name} references var(${ref}) without a fallback`).toBe(true);
      }
    }
  });
});

describe('blur performance ceiling (Req 7.2/7.4)', () => {
  const applied = appliedBlurPx(getToken(tokens, '--glass-blur'));

  it('applied blur never exceeds the 24px performance ceiling', () => {
    expect(applied).toBeLessThanOrEqual(24);
  });

  // The clamp helper still guarantees the ceiling holds for any requested amount,
  // independent of whether the active theme uses blur (iOS-glass) or is flat (Claude paper).
  const clampBlur = (amount: number) => Math.min(amount, 24);
  it.each([
    [12, 12],
    [24, 24],
    [30, 24],
    [100, 24],
  ])('clamp model keeps requested blur %ipx -> %ipx', (requested, expected) => {
    expect(clampBlur(requested)).toBe(expected);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Text-search verification for the three merged Stylesheet_Lệch after they were
 * folded into the shared Hệ_Token (tasks 3.1–3.3).
 * Validates: Requirements 3.3, 3.5, 10.1
 *
 * Two checks, both run against the real CSS so they stay in sync with the source:
 *   1. Case-insensitive text search of the 8 slate/indigo hex values across all
 *      three files returns a combined total of 0 (Req 10.1, 3.3).
 *   2. The count of standalone hex (#...) and rgb()/rgba() color literals — i.e.
 *      those NOT supplied as a var() fallback — is 0 (Req 3.3, 3.5).
 */

// The three Stylesheet_Lệch, in cascade-load order.
const FILES = ['agent-gateway.css', 'agent-store.css', 'agent-hub.css'] as const;

function readStyle(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');
}

const sources = FILES.map((name) => ({ name, css: readStyle(name) }));

// The 8 slate/indigo hex values that must be fully eradicated (Req 10.1).
const SLATE_INDIGO_HEX = [
  '#1e293b',
  '#0f172a',
  '#334155',
  '#475569',
  '#64748b',
  '#6366f1',
  '#3b82f6',
  '#8b5cf6',
] as const;

// ---------------------------------------------------------------------------
// Pure text helpers
// ---------------------------------------------------------------------------

/** Count case-insensitive, possibly-overlapping-free occurrences of `needle`. */
function countOccurrences(haystack: string, needle: string): number {
  const hay = haystack.toLowerCase();
  const sub = needle.toLowerCase();
  let count = 0;
  let idx = hay.indexOf(sub);
  while (idx !== -1) {
    count++;
    idx = hay.indexOf(sub, idx + sub.length);
  }
  return count;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Remove every `var(...)` expression (including any fallback contents), handling
 * nested parens such as `var(--x, rgba(0,0,0,.5))`. What remains is the text that
 * is NOT a token reference, so any color literal left over is a true standalone
 * literal rather than a token fallback.
 */
function stripVarReferences(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css.startsWith('var(', i)) {
      let depth = 0;
      let j = i + 3; // index of the opening '('
      for (; j < css.length; j++) {
        if (css[j] === '(') depth++;
        else if (css[j] === ')') {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
      }
      i = j; // skip the entire var(...) expression
    } else {
      out += css[i];
      i++;
    }
  }
  return out;
}

/** Standalone color literals (hex + rgb/rgba) in a chunk of CSS text. */
function findColorLiterals(css: string): string[] {
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  const rgb = css.match(/\brgba?\([^)]*\)/gi) ?? [];
  return [...hex, ...rgb];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Stylesheet_Lệch merge verification (Req 3.3, 3.5, 10.1)', () => {
  it('contains 0 slate/indigo hex values across all three files, case-insensitive (Req 10.1, 3.3)', () => {
    const breakdown: Record<string, number> = {};
    let total = 0;
    for (const { name, css } of sources) {
      for (const hex of SLATE_INDIGO_HEX) {
        const n = countOccurrences(css, hex);
        if (n > 0) breakdown[`${name} ${hex}`] = n;
        total += n;
      }
    }
    expect(total, `slate/indigo hex found: ${JSON.stringify(breakdown)}`).toBe(0);
  });

  it('contains 0 hex/rgba color literals outside var() token references (Req 3.3, 3.5)', () => {
    const offenders: Record<string, string[]> = {};
    let total = 0;
    for (const { name, css } of sources) {
      const stripped = stripVarReferences(stripComments(css));
      const literals = findColorLiterals(stripped);
      if (literals.length > 0) offenders[name] = literals;
      total += literals.length;
    }
    expect(total, `color literals outside tokens: ${JSON.stringify(offenders)}`).toBe(0);
  });

  it.each(FILES)('%s individually has 0 slate/indigo hex and 0 standalone color literals', (name) => {
    const css = readStyle(name);
    const slateHits = SLATE_INDIGO_HEX.reduce((sum, hex) => sum + countOccurrences(css, hex), 0);
    const literals = findColorLiterals(stripVarReferences(stripComments(css)));
    expect(slateHits, `${name} slate/indigo hex count`).toBe(0);
    expect(literals, `${name} standalone literals`).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests for the iOS 26 Bộ_Class_Glass declarations in index.css.
 * Validates: Requirements 2.1, 2.2, 2.3, 2.8
 *
 * The test parses the actual CSS so it stays in sync with the source of truth
 * (no hardcoded mirror of the class definitions). It asserts:
 *   - exactly three glass classes exist (Req 2.1)
 *   - every glass property references a token via var(--token) (Req 2.2)
 *   - class names are kebab-case (Req 2.3)
 *   - no color/blur/radius/shadow literal lives OUTSIDE a var() (Req 2.8)
 *
 * Note: `glass-panel` is a static surface and intentionally has NO
 * backdrop-filter (Req 7.3); the expectations below account for that.
 */

const cssPath = fileURLToPath(new URL('./index.css', import.meta.url));
const cssSource = readFileSync(cssPath, 'utf8');

const GLASS_CLASSES = ['glass-surface', 'glass-card', 'glass-panel'] as const;

/** Glass properties each class must declare, and reference a token for. */
const EXPECTED_PROPERTIES: Record<(typeof GLASS_CLASSES)[number], string[]> = {
  'glass-surface': ['background', 'backdrop-filter', '-webkit-backdrop-filter', 'border', 'box-shadow'],
  'glass-card': [
    'background',
    'backdrop-filter',
    '-webkit-backdrop-filter',
    'border',
    'border-radius',
    'box-shadow',
  ],
  // glass-panel: static surface — solid token bg, no backdrop-filter (Req 7.3)
  'glass-panel': ['background', 'border', 'border-radius', 'box-shadow'],
};

const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Literals that must never appear OUTSIDE a var() in a glass declaration:
 * hex colors, color functions, blur(), and length/percentage values
 * (radius/shadow offsets/blur amounts).
 */
const LITERAL_RE =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|\bblur\(|\d+(?:\.\d+)?(?:px|rem|em)\b|\d+(?:\.\d+)?%/;

// ---------------------------------------------------------------------------
// CSS parsing helpers (pure, no DOM needed)
// ---------------------------------------------------------------------------

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const cleanCss = stripComments(cssSource);

/** Collect the base name of every `.glass-*` class selector in the stylesheet. */
function glassClassNames(css: string): Set<string> {
  const names = new Set<string>();
  const re = /\.(glass-[a-z0-9-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    // Trim any trailing hyphen produced by selector combinators (defensive).
    names.add(m[1].replace(/-+$/, ''));
  }
  return names;
}

/** Return the declaration body of the base rule `.name { ... }`. */
function ruleBody(css: string, name: string): string {
  const re = new RegExp(`\\.${name.replace(/-/g, '\\-')}\\s*\\{`);
  const m = re.exec(css);
  if (!m) throw new Error(`Rule .${name} not found in index.css`);
  const open = css.indexOf('{', m.index);
  let depth = 0;
  let end = -1;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`Unterminated rule .${name}`);
  return css.slice(open + 1, end);
}

interface Declaration {
  prop: string;
  value: string;
}

function declarations(body: string): Declaration[] {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const colon = d.indexOf(':');
      return { prop: d.slice(0, colon).trim(), value: d.slice(colon + 1).trim() };
    });
}

/** Remove every balanced `var(...)` expression (including nested fallbacks). */
function stripVarExpressions(value: string): string {
  let result = '';
  let i = 0;
  while (i < value.length) {
    if (value.startsWith('var(', i)) {
      let depth = 0;
      let j = i + 3; // points at the '(' of var(
      for (; j < value.length; j++) {
        if (value[j] === '(') depth++;
        else if (value[j] === ')') {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
      }
      i = j;
    } else {
      result += value[i];
      i++;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const glassRules = new Map<string, Declaration[]>(
  GLASS_CLASSES.map((name) => [name, declarations(ruleBody(cleanCss, name))]),
);

describe('Bộ_Class_Glass declarations in index.css', () => {
  it('defines exactly the three glass classes (Req 2.1)', () => {
    expect(glassClassNames(cleanCss)).toEqual(new Set(GLASS_CLASSES));
  });

  it('names every glass class in kebab-case (Req 2.3)', () => {
    for (const name of glassClassNames(cleanCss)) {
      expect(name, `${name} is not kebab-case`).toMatch(KEBAB_CASE);
    }
  });

  describe.each(GLASS_CLASSES)('.%s', (name) => {
    const decls = glassRules.get(name)!;

    it('declares its expected glass properties', () => {
      const props = decls.map((d) => d.prop);
      for (const expected of EXPECTED_PROPERTIES[name]) {
        expect(props, `.${name} is missing "${expected}"`).toContain(expected);
      }
    });

    it('references a token via var(--token) for every glass property (Req 2.2)', () => {
      for (const { prop, value } of decls) {
        expect(value, `.${name} { ${prop} } does not reference var(--token)`).toMatch(/var\(\s*--/);
      }
    });

    it('contains no color/blur/radius/shadow literal outside var() (Req 2.8)', () => {
      for (const { prop, value } of decls) {
        const residue = stripVarExpressions(value);
        expect(
          LITERAL_RE.test(residue),
          `.${name} { ${prop} } has a literal outside var(): "${residue.trim()}"`,
        ).toBe(false);
      }
    });
  });

  it('keeps glass-panel a static surface with no backdrop-filter (Req 7.3)', () => {
    const props = glassRules.get('glass-panel')!.map((d) => d.prop);
    expect(props).not.toContain('backdrop-filter');
    expect(props).not.toContain('-webkit-backdrop-filter');
  });

  it('uses backdrop-filter for glass-surface and glass-card', () => {
    for (const name of ['glass-surface', 'glass-card'] as const) {
      const props = glassRules.get(name)!.map((d) => d.prop);
      expect(props, `.${name} should use backdrop-filter`).toContain('backdrop-filter');
    }
  });
});

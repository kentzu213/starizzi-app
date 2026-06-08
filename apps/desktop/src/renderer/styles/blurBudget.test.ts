import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BLUR_BEARING_GLASS_CLASSES,
  BLUR_BUDGET,
  maxNestedBlurDepth,
  withinBlurBudget,
  type BlurNode,
} from './blurBudget';

/**
 * Blur-layer budget tests.
 * Validates: Requirements 7.2, 7.3
 *
 * Two layers of assurance:
 *   1. Pure model: maxNestedBlurDepth counts the deepest blur chain and the
 *      budget gate flags trees that exceed 3.
 *   2. CSS invariant: glass-panel (the static container surface used as the
 *      outermost wrapper) must NOT declare backdrop-filter (Req 7.3), which is
 *      what keeps real screen trees within the 3-layer budget.
 */

const cssPath = fileURLToPath(new URL('./index.css', import.meta.url));
const cssSource = readFileSync(cssPath, 'utf8');

function ruleBody(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = new RegExp(`\\.${selector.replace(/-/g, '\\-')}\\s*\\{`);
  const m = re.exec(clean);
  if (!m) throw new Error(`Rule .${selector} not found`);
  const open = clean.indexOf('{', m.index);
  let depth = 0;
  for (let i = open; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    else if (clean[i] === '}') {
      depth--;
      if (depth === 0) return clean.slice(open + 1, i);
    }
  }
  throw new Error(`Unterminated rule .${selector}`);
}

describe('maxNestedBlurDepth model (Req 7.2)', () => {
  it('counts a single blur surface as depth 1', () => {
    const tree: BlurNode = { classes: ['glass-card'] };
    expect(maxNestedBlurDepth(tree, BLUR_BEARING_GLASS_CLASSES)).toBe(1);
  });

  it('counts the deepest blur chain across branches', () => {
    const tree: BlurNode = {
      classes: ['glass-surface'], // 1
      children: [
        { classes: ['no-blur'], children: [{ classes: ['glass-card'] }] }, // 1 + 1 = 2
        { classes: ['glass-card'], children: [{ classes: ['glass-card'] }] }, // 1 + 1 + 1 = 3
      ],
    };
    expect(maxNestedBlurDepth(tree, BLUR_BEARING_GLASS_CLASSES)).toBe(3);
  });

  it('treats glass-panel as non-blurring (Req 7.3)', () => {
    const tree: BlurNode = {
      classes: ['glass-panel'],
      children: [{ classes: ['glass-card'] }],
    };
    // panel doesn't count → only the inner card → depth 1
    expect(maxNestedBlurDepth(tree, BLUR_BEARING_GLASS_CLASSES)).toBe(1);
  });

  it('flags a tree that exceeds the 3-layer budget', () => {
    const overBudget: BlurNode = {
      classes: ['glass-card'],
      children: [
        { classes: ['glass-card'], children: [{ classes: ['glass-card'], children: [{ classes: ['glass-card'] }] }] },
      ],
    };
    expect(maxNestedBlurDepth(overBudget, BLUR_BEARING_GLASS_CLASSES)).toBe(4);
    expect(withinBlurBudget(overBudget)).toBe(false);
  });

  it('accepts a tree exactly at the budget', () => {
    const atBudget: BlurNode = {
      classes: ['glass-surface'],
      children: [{ classes: ['glass-card'], children: [{ classes: ['glass-card'] }] }],
    };
    expect(maxNestedBlurDepth(atBudget, BLUR_BEARING_GLASS_CLASSES)).toBe(BLUR_BUDGET);
    expect(withinBlurBudget(atBudget)).toBe(true);
  });
});

describe('CSS blur invariant (Req 7.3)', () => {
  it('glass-panel does NOT declare backdrop-filter', () => {
    const body = ruleBody(cssSource, 'glass-panel');
    expect(body).not.toMatch(/backdrop-filter/);
  });

  it('glass-surface and glass-card DO declare backdrop-filter', () => {
    for (const cls of ['glass-surface', 'glass-card']) {
      expect(ruleBody(cssSource, cls)).toMatch(/backdrop-filter\s*:/);
    }
  });
});

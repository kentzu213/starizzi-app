import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Electron window-config preservation test.
 * Validates: Requirement 9.7
 *
 * The glass redesign must keep the frameless + custom-titlebar window config and
 * must NOT enable vibrancy or transparency. This reads src/main/index.ts as text
 * and asserts those invariants.
 */

const mainPath = fileURLToPath(new URL('../main/index.ts', import.meta.url));
const mainSource = readFileSync(mainPath, 'utf8');

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const code = stripComments(mainSource);

describe('Electron BrowserWindow config (Req 9.7)', () => {
  it('keeps frame: false (frameless window)', () => {
    expect(code).toMatch(/frame\s*:\s*false/);
  });

  it("keeps titleBarStyle: 'hidden' (custom titlebar)", () => {
    expect(code).toMatch(/titleBarStyle\s*:\s*['"]hidden['"]/);
  });

  it('does NOT enable vibrancy', () => {
    // No `vibrancy: '<material>'` assignment to a non-empty material.
    const vibrancy = code.match(/vibrancy\s*:\s*['"]([^'"]*)['"]/);
    expect(vibrancy?.[1] ?? '').toBe('');
  });

  it('does NOT enable transparent window', () => {
    expect(code).not.toMatch(/transparent\s*:\s*true/);
  });
});

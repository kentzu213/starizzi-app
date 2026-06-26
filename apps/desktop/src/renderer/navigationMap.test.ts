import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Navigation-map regression test for App.tsx.
 * Validates: Requirement 9.1
 *
 * The glass redesign must NOT change the `useState<Page>` navigation contract:
 * the set of Page values and the (trigger → destination) pairs must match the
 * baseline. This reads App.tsx as text (no DOM) and asserts the page set plus
 * the setCurrentPage('<dest>') destinations are exactly the baseline.
 */

const appPath = fileURLToPath(new URL('./App.tsx', import.meta.url));
const appSource = readFileSync(appPath, 'utf8');

/** Baseline Page union (the 11 navigable pages in App.tsx). */
const BASELINE_PAGES = [
  'chat',
  'tasks',
  'memory',
  'status',
  'dashboard',
  'marketplace',
  'agents',
  'extensions',
  'settings',
  'setup',
  'costs',
  'knowledge',
  'graph',
] as const;

function parsePageUnion(src: string): Set<string> {
  // Capture the `type Page = | 'a' | 'b' ...;` block.
  const m = src.match(/type Page\s*=\s*([\s\S]*?);/);
  if (!m) throw new Error('Page union not found in App.tsx');
  const literals = m[1].match(/'([a-z]+)'/g) ?? [];
  return new Set(literals.map((l) => l.replace(/'/g, '')));
}

function parseNavigationDestinations(src: string): Set<string> {
  const dests = new Set<string>();
  const re = /setCurrentPage\(\s*'([a-z]+)'\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) dests.add(m[1]);
  return dests;
}

describe('App.tsx navigation map (Req 9.1)', () => {
  it('keeps the exact Page union from the baseline', () => {
    expect(parsePageUnion(appSource)).toEqual(new Set(BASELINE_PAGES));
  });

  it('uses useState<Page> for the navigation state', () => {
    expect(appSource).toMatch(/useState<Page>\(/);
  });

  it('only navigates to pages that exist in the Page union (no orphan destinations)', () => {
    const pages = parsePageUnion(appSource);
    for (const dest of parseNavigationDestinations(appSource)) {
      expect(pages.has(dest), `setCurrentPage('${dest}') targets an unknown page`).toBe(true);
    }
  });

  it('preserves the key (trigger → destination) pairs from the baseline', () => {
    // Chat → dashboard and Chat → agents are the explicit cross-page triggers.
    expect(appSource).toContain("onNavigateToDashboard={() => setCurrentPage('dashboard')}");
    expect(appSource).toContain("onNavigateToAgentHub={() => setCurrentPage('agents')}");
    // Extensions → marketplace, Dashboard → chat, Setup → chat.
    expect(appSource).toContain("onGoMarketplace={() => setCurrentPage('marketplace')}");
    expect(appSource).toContain("onGoChat={() => setCurrentPage('chat')}");
    expect(appSource).toContain("onComplete={() => setCurrentPage('chat')}");
  });
});

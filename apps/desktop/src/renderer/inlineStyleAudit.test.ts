import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Inline-style audit across the 15 Màn_Hình + 16 Component_Chung.
 * Validates: Requirements 9.4, 10.2
 *
 * After the glass redesign every remaining `style={{ ... }}` must be an
 * Inline_Style_Động: it must NOT contain a hex color, rgb()/rgba(), or
 * linear-gradient() literal. Any color value must be a var(--token) reference
 * (or, for data-driven values, a string that resolves to a token). This test
 * extracts each inline style block and asserts no raw color literal remains.
 */

const SCREEN_FILES = [
  'pages/Login.tsx',
  'pages/Chat.tsx',
  'pages/Tasks.tsx',
  'pages/Memory.tsx',
  'pages/Status.tsx',
  'pages/Dashboard.tsx',
  'pages/Marketplace.tsx',
  'pages/Extensions.tsx',
  'pages/ExtensionDetail.tsx',
  'pages/AgentStore.tsx',
  'pages/DeveloperDashboard.tsx',
  'pages/DeveloperUpload.tsx',
  'pages/CostDashboard.tsx',
  'pages/Settings.tsx',
  'pages/SetupWizard.tsx',
];

const COMPONENT_FILES = [
  'components/AgentSetupPanel.tsx',
  'components/AgentStatusBadge.tsx',
  'components/AgentTabBar.tsx',
  'components/AppIcons.tsx',
  'components/ChatComposer.tsx',
  'components/ChatEmptyState.tsx',
  'components/ChatMessageList.tsx',
  'components/ErrorBoundary.tsx',
  'components/ModelSelector.tsx',
  'components/OnboardingWizard.tsx',
  'components/PermissionDialog.tsx',
  'components/Sidebar.tsx',
  'components/Skeleton.tsx',
  'components/TitleBar.tsx',
  'components/UpdateBanner.tsx',
  'components/UpdateNotification.tsx',
];

const ALL_FILES = [...SCREEN_FILES, ...COMPONENT_FILES];

function read(rel: string): string | null {
  try {
    return readFileSync(fileURLToPath(new URL(`./${rel}`, import.meta.url)), 'utf8');
  } catch {
    return null;
  }
}

/** Extract the contents of every `style={{ ... }}` block (brace-balanced). */
function extractInlineStyleBlocks(src: string): string[] {
  const blocks: string[] = [];
  const marker = 'style={{';
  let idx = src.indexOf(marker);
  while (idx !== -1) {
    // Start right after `style={{`; find the matching close of the outer `{`.
    let depth = 2; // we've consumed `{{`
    let i = idx + marker.length;
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push(src.slice(start, i - 1));
    idx = src.indexOf(marker, i);
  }
  return blocks;
}

/** A raw color literal that should never appear inside an inline style (Req 9.4). */
const COLOR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\s*\(|\blinear-gradient\s*\(|\bradial-gradient\s*\(/;

describe('Inline-style audit: remaining inline styles are dynamic-only (Req 9.4, 10.2)', () => {
  it('finds all 31 target files', () => {
    const missing = ALL_FILES.filter((f) => read(f) === null);
    expect(missing, `missing files: ${missing.join(', ')}`).toEqual([]);
  });

  it.each(ALL_FILES)('%s has no color/gradient literal inside any inline style', (rel) => {
    const src = read(rel);
    if (src === null) return; // covered by the existence test above
    const offenders: string[] = [];
    for (const block of extractInlineStyleBlocks(src)) {
      const hit = block.match(COLOR_LITERAL);
      if (hit) offenders.push(`${hit[0]} → in: ${block.replace(/\s+/g, ' ').trim().slice(0, 80)}`);
    }
    expect(offenders, `color literals in inline style of ${rel}: ${JSON.stringify(offenders)}`).toEqual([]);
  });
});

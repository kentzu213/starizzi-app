/**
 * Blur-layer budget model for the iOS 26 glass redesign.
 *
 * Validates (pure model + CSS invariant): Requirement 7.2 (and 7.3).
 *
 * Req 7.2 caps nested `backdrop-filter` blur layers at 3 on any branch of a
 * Màn_Hình's DOM tree. This module provides:
 *   - `maxNestedBlurDepth(tree, blurClasses)` — pure deepest-chain blur counter.
 *   - `BLUR_BEARING_GLASS_CLASSES` — the shared glass classes that DO blur
 *     (`glass-surface`, `glass-card`); `glass-panel` is intentionally excluded
 *     (static surface, Req 7.3).
 *   - `BLUR_BUDGET` — the maximum allowed (3).
 */

export const BLUR_BUDGET = 3;

/** Shared glass classes that apply backdrop-filter blur (Req 7.3 excludes glass-panel). */
export const BLUR_BEARING_GLASS_CLASSES = ['glass-surface', 'glass-card'] as const;

export interface BlurNode {
  /** Class names applied to this element. */
  classes: string[];
  children?: BlurNode[];
}

/**
 * Deepest count of ancestor→descendant elements that carry a blur-bearing class
 * along any single root-to-leaf branch.
 */
export function maxNestedBlurDepth(node: BlurNode, blurClasses: readonly string[]): number {
  const blurSet = new Set(blurClasses);
  const self = node.classes.some((c) => blurSet.has(c)) ? 1 : 0;
  const childMax = (node.children ?? []).reduce(
    (max, child) => Math.max(max, maxNestedBlurDepth(child, blurClasses)),
    0,
  );
  return self + childMax;
}

/** True when the tree respects the ≤3 nested-blur budget (Req 7.2). */
export function withinBlurBudget(node: BlurNode, blurClasses: readonly string[] = BLUR_BEARING_GLASS_CLASSES): boolean {
  return maxNestedBlurDepth(node, blurClasses) <= BLUR_BUDGET;
}

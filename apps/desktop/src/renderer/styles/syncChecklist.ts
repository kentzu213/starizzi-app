/**
 * Tiêu_Chí_Đồng_Bộ checklist + logic gate for the iOS 26 glass redesign.
 *
 * Validates (data + pure logic): Requirements 5.2, 5.3, 5.5, 6.3, 6.4, 10.3, 10.4, 10.5
 *
 * Each Màn_Hình / Component_Chung is a SyncCriterion with the four measurable
 * conditions from the design's "Lược đồ Tiêu_Chí_Đồng_Bộ":
 *   (a) 100% màu tham chiếu Hệ_Token
 *   (b) bề mặt kính dùng Bộ_Class_Glass
 *   (c) số Inline_Style_Trình_Bày = 0
 *   (d) không còn màu hardcode lệch token
 *
 * A target is `DaDongBo` ⟺ a ∧ b ∧ c ∧ d. The whole glass-sync scope is complete
 * ⟺ every one of the 31 targets is `DaDongBo`.
 */

export type SyncTargetType = 'screen' | 'component';

export type SyncConditionKey =
  | 'c_a_tokenColors'
  | 'c_b_glassClasses'
  | 'c_c_noInlinePresentational'
  | 'c_d_noHardcodedColor';

export type SyncStatus = 'DaDongBo' | 'ChuaDongBo';

export interface SyncCriterion {
  target: string;
  type: SyncTargetType;
  c_a_tokenColors: boolean;
  c_b_glassClasses: boolean;
  c_c_noInlinePresentational: boolean;
  c_d_noHardcodedColor: boolean;
}

export interface SyncEvaluation {
  target: string;
  type: SyncTargetType;
  status: SyncStatus;
  /** The condition keys that did NOT pass (empty when DaDongBo). */
  failingConditions: SyncConditionKey[];
}

/** Human-readable label for each condition (for reviewer output, Req 10.3/10.5). */
export const CONDITION_LABELS: Record<SyncConditionKey, string> = {
  c_a_tokenColors: '100% màu tham chiếu Hệ_Token',
  c_b_glassClasses: 'Bề mặt kính dùng Bộ_Class_Glass',
  c_c_noInlinePresentational: 'Không còn Inline_Style_Trình_Bày',
  c_d_noHardcodedColor: 'Không còn màu hardcode lệch token',
};

const CONDITION_KEYS: SyncConditionKey[] = [
  'c_a_tokenColors',
  'c_b_glassClasses',
  'c_c_noInlinePresentational',
  'c_d_noHardcodedColor',
];

/** 15 Màn_Hình (Req 5.1 / 10.3). */
export const SCREENS = [
  'Login',
  'Chat',
  'Tasks',
  'Memory',
  'Status',
  'Dashboard',
  'Marketplace',
  'Extensions',
  'ExtensionDetail',
  'AgentStore',
  'DeveloperDashboard',
  'DeveloperUpload',
  'CostDashboard',
  'Settings',
  'SetupWizard',
] as const;

/** 16 Component_Chung (Req 6.1 / 10.3). */
export const COMPONENTS = [
  'AgentSetupPanel',
  'AgentStatusBadge',
  'AgentTabBar',
  'AppIcons',
  'ChatComposer',
  'ChatEmptyState',
  'ChatMessageList',
  'ErrorBoundary',
  'ModelSelector',
  'OnboardingWizard',
  'PermissionDialog',
  'Sidebar',
  'Skeleton',
  'TitleBar',
  'UpdateBanner',
  'UpdateNotification',
] as const;

/** Total targets that must be DaDongBo for completion (Req 10.4). */
export const TOTAL_TARGETS = SCREENS.length + COMPONENTS.length; // 31

/**
 * Evaluate a single criterion: `DaDongBo` ⟺ all four conditions pass (Req 5.3, 6.4).
 * `failingConditions` lists exactly the conditions that did not pass (Req 5.5, 10.5).
 */
export function evaluate(criterion: SyncCriterion): SyncEvaluation {
  const failingConditions = CONDITION_KEYS.filter((key) => !criterion[key]);
  return {
    target: criterion.target,
    type: criterion.type,
    status: failingConditions.length === 0 ? 'DaDongBo' : 'ChuaDongBo',
    failingConditions,
  };
}

/**
 * The glass-sync scope is complete ⟺ the checklist covers all 31 targets AND
 * every target evaluates to `DaDongBo` (Req 10.4). A single failing condition on
 * any target keeps the scope incomplete (Req 10.5).
 */
export function isScopeComplete(checklist: SyncCriterion[]): boolean {
  if (checklist.length !== TOTAL_TARGETS) return false;
  const covered = new Set(checklist.map((c) => c.target));
  const allCovered = [...SCREENS, ...COMPONENTS].every((t) => covered.has(t));
  if (!allCovered) return false;
  return checklist.every((c) => evaluate(c).status === 'DaDongBo');
}

/** Build a fully-synced checklist (all four conditions pass on all 31 targets). */
export function buildCompletedChecklist(): SyncCriterion[] {
  const pass = (target: string, type: SyncTargetType): SyncCriterion => ({
    target,
    type,
    c_a_tokenColors: true,
    c_b_glassClasses: true,
    c_c_noInlinePresentational: true,
    c_d_noHardcodedColor: true,
  });
  return [
    ...SCREENS.map((s) => pass(s, 'screen')),
    ...COMPONENTS.map((c) => pass(c, 'component')),
  ];
}

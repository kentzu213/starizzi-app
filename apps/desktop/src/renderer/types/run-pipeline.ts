/**
 * Pipeline routing model for the AI-company (agent-company spec, Phase 2/3).
 *
 * PURE + data-only: maps each product-lifecycle stage to its department, owning agent,
 * mission loop, and risk tier (🟢/🟡/🔴). The UI reads this to route work and to gate
 * stage transitions (green = advance freely, red = require human confirm). No side effects.
 */

export type PipelineStage = 'idea' | 'prototype' | 'build' | 'polish' | 'operate' | 'gtm';
export type StageRisk = 'green' | 'yellow' | 'red';

export interface StageMeta {
  stage: PipelineStage;
  label: string;
  /** Org department (phân cấp #2). */
  department: string;
  /** Owning agent id (must match a TOP_AGENTS id). */
  agentId: string;
  /** Mission loop id (must match an AGENT_LOOPS id). */
  missionId: string;
  /** Risk tier that gates auto-advance (🟢 auto · 🟡 notify · 🔴 human-gate). */
  risk: StageRisk;
  /** Parallel branch (go-to-market) — does not block the main chain. */
  parallel?: boolean;
}

/** The main technical chain (sequential). */
export const PIPELINE: StageMeta[] = [
  { stage: 'idea', label: 'Ý tưởng', department: 'Điều hành', agentId: 'orchestrator', missionId: 'loop-planning', risk: 'green' },
  { stage: 'prototype', label: 'Prototype', department: 'Kỹ thuật', agentId: 'prototyper', missionId: 'loop-prototype', risk: 'green' },
  { stage: 'build', label: 'Sản phẩm', department: 'Kỹ thuật', agentId: 'builder', missionId: 'loop-build', risk: 'yellow' },
  { stage: 'polish', label: 'Polish', department: 'Kỹ thuật', agentId: 'sweeper', missionId: 'loop-polish', risk: 'yellow' },
  { stage: 'operate', label: 'Vận hành', department: 'Kỹ thuật', agentId: 'maintainer', missionId: 'loop-operate', risk: 'red' },
];

/** Go-to-market runs in parallel with the technical chain. */
export const PARALLEL_STAGE: StageMeta = {
  stage: 'gtm',
  label: 'Go-to-market',
  department: 'Thị trường',
  agentId: 'grower',
  missionId: 'loop-gtm',
  risk: 'green',
  parallel: true,
};

const ALL_STAGES: StageMeta[] = [...PIPELINE, PARALLEL_STAGE];

export function stageMeta(stage: string): StageMeta | undefined {
  return ALL_STAGES.find((s) => s.stage === stage);
}

/** Next stage in the main chain, or null at the end / for unknown/parallel stages. */
export function nextStage(stage: string): PipelineStage | null {
  const i = PIPELINE.findIndex((s) => s.stage === stage);
  return i >= 0 && i < PIPELINE.length - 1 ? PIPELINE[i + 1].stage : null;
}

export function stageRisk(stage: string): StageRisk {
  return stageMeta(stage)?.risk ?? 'green';
}

/** A transition needs human confirmation when the DESTINATION stage is red. */
export function transitionNeedsApproval(toStage: string): boolean {
  return stageRisk(toStage) === 'red';
}

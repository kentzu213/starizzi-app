// Feature: agent-company Phase 2/3 (pipeline routing + risk gate).
import { describe, it, expect } from 'vitest';
import { PIPELINE, nextStage, stageMeta, stageRisk, transitionNeedsApproval } from './run-pipeline';

describe('run-pipeline routing', () => {
  it('advances the main chain in order and stops at the end', () => {
    expect(nextStage('idea')).toBe('prototype');
    expect(nextStage('prototype')).toBe('build');
    expect(nextStage('build')).toBe('polish');
    expect(nextStage('polish')).toBe('operate');
    expect(nextStage('operate')).toBeNull();
    expect(nextStage('unknown')).toBeNull();
    expect(nextStage('gtm')).toBeNull(); // parallel, not in the main chain
  });

  it('classifies risk with operate = red (gated), build/polish = yellow, rest = green', () => {
    expect(stageRisk('operate')).toBe('red');
    expect(stageRisk('build')).toBe('yellow');
    expect(stageRisk('polish')).toBe('yellow');
    expect(stageRisk('idea')).toBe('green');
    expect(stageRisk('prototype')).toBe('green');
    expect(stageRisk('gtm')).toBe('green');
    expect(stageRisk('nonsense')).toBe('green'); // safe default
  });

  it('only red destinations need human approval', () => {
    expect(transitionNeedsApproval('operate')).toBe(true);
    expect(transitionNeedsApproval('build')).toBe(false);
    expect(transitionNeedsApproval('prototype')).toBe(false);
  });

  it('every main-chain stage maps to a department + agent + mission', () => {
    for (const s of PIPELINE) {
      const meta = stageMeta(s.stage);
      expect(meta).toBeDefined();
      expect(meta!.department.length).toBeGreaterThan(0);
      expect(meta!.agentId.length).toBeGreaterThan(0);
      expect(meta!.missionId.startsWith('loop-')).toBe(true);
    }
  });
});

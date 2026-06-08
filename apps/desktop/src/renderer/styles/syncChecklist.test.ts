import { describe, expect, it } from 'vitest';
import {
  COMPONENTS,
  SCREENS,
  TOTAL_TARGETS,
  buildCompletedChecklist,
  evaluate,
  isScopeComplete,
  type SyncCriterion,
} from './syncChecklist';

/**
 * Unit tests for the Tiêu_Chí_Đồng_Bộ logic gate.
 * Validates: Requirements 5.3, 5.5, 6.4, 10.4, 10.5
 */

function criterion(overrides: Partial<SyncCriterion> = {}): SyncCriterion {
  return {
    target: 'Login',
    type: 'screen',
    c_a_tokenColors: true,
    c_b_glassClasses: true,
    c_c_noInlinePresentational: true,
    c_d_noHardcodedColor: true,
    ...overrides,
  };
}

describe('evaluate() logic gate (Req 5.3, 6.4)', () => {
  it('returns DaDongBo only when all four conditions pass', () => {
    const result = evaluate(criterion());
    expect(result.status).toBe('DaDongBo');
    expect(result.failingConditions).toEqual([]);
  });

  it('returns ChuaDongBo when any single condition fails (Req 5.5)', () => {
    const result = evaluate(criterion({ c_c_noInlinePresentational: false }));
    expect(result.status).toBe('ChuaDongBo');
    expect(result.failingConditions).toEqual(['c_c_noInlinePresentational']);
  });

  it('lists exactly the conditions that did not pass (Req 5.5, 10.5)', () => {
    const result = evaluate(
      criterion({ c_a_tokenColors: false, c_d_noHardcodedColor: false }),
    );
    expect(result.status).toBe('ChuaDongBo');
    expect(result.failingConditions.sort()).toEqual(
      ['c_a_tokenColors', 'c_d_noHardcodedColor'].sort(),
    );
  });

  it('flags all four conditions when none pass', () => {
    const result = evaluate(
      criterion({
        c_a_tokenColors: false,
        c_b_glassClasses: false,
        c_c_noInlinePresentational: false,
        c_d_noHardcodedColor: false,
      }),
    );
    expect(result.failingConditions).toHaveLength(4);
  });
});

describe('isScopeComplete() (Req 10.4, 10.5)', () => {
  it('covers exactly 15 screens + 16 components = 31 targets', () => {
    expect(SCREENS).toHaveLength(15);
    expect(COMPONENTS).toHaveLength(16);
    expect(TOTAL_TARGETS).toBe(31);
  });

  it('is complete when all 31 targets are DaDongBo (Req 10.4)', () => {
    expect(isScopeComplete(buildCompletedChecklist())).toBe(true);
  });

  it('is incomplete when one target has a failing condition (Req 10.5)', () => {
    const checklist = buildCompletedChecklist();
    checklist[0] = { ...checklist[0], c_b_glassClasses: false };
    expect(isScopeComplete(checklist)).toBe(false);
  });

  it('is incomplete when a target is missing (fewer than 31)', () => {
    const checklist = buildCompletedChecklist().slice(0, TOTAL_TARGETS - 1);
    expect(isScopeComplete(checklist)).toBe(false);
  });

  it('is incomplete when the count is right but a target name is wrong', () => {
    const checklist = buildCompletedChecklist();
    checklist[checklist.length - 1] = {
      ...checklist[checklist.length - 1],
      target: 'NotARealTarget',
    };
    expect(isScopeComplete(checklist)).toBe(false);
  });
});

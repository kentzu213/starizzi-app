import { describe, expect, it } from 'vitest';
import {
  getModelCreditPolicy,
  isPaidCreditOnlyModel,
  MODEL_CREDIT_NOTICE_VI,
} from './model-credit-policy';

describe('model credit policy', () => {
  it.each([
    'grok-4.5-high',
    'xai/grok-4.5-fast',
    'gcli/grok-4.5-high',
    'gpt-5.6-sol',
    'izzi/gpt-5.6-terra',
    'gpt-5.6-luna',
    'claude-opus-4.7',
    'anthropic/claude-opus-4-7-20260719',
    'claude-4.8-opus',
    'claude-opus-5.0',
  ])('requires topped-up balance for %s', (modelId) => {
    expect(getModelCreditPolicy(modelId)).toBe('paid-balance-required');
    expect(isPaidCreditOnlyModel(modelId)).toBe(true);
  });

  it.each(['izzi-smart', 'izzi/auto', 'izzi-auto', 'auto'])(
    'marks %s as able to route to a paid-only model',
    (modelId) => {
      expect(getModelCreditPolicy(modelId)).toBe('may-route-paid-only');
      expect(isPaidCreditOnlyModel(modelId)).toBe(false);
    },
  );

  it.each([
    '',
    'grok-4.1',
    'not-grok-4.5-high',
    'gpt-5.6',
    'gpt-5.6-mini',
    'claude-opus-4.6',
    'claude-opus-4-1-20250805',
    'claude-opus-4-20250514',
    'claude-4-sonnet',
    'gemini-2.5-pro',
  ])('keeps free-credit eligibility unspecified for %s', (modelId) => {
    expect(getModelCreditPolicy(modelId)).toBe('standard');
    expect(isPaidCreditOnlyModel(modelId)).toBe(false);
  });

  it('keeps the direct and SmartRouter notices explicit about the $5 free credit', () => {
    expect(MODEL_CREDIT_NOTICE_VI['paid-balance-required']).toContain('$5');
    expect(MODEL_CREDIT_NOTICE_VI['paid-balance-required']).toContain('số dư nạp');
    expect(MODEL_CREDIT_NOTICE_VI['may-route-paid-only']).toContain('Smart Router');
    expect(MODEL_CREDIT_NOTICE_VI['may-route-paid-only']).toContain('$5');
    expect(MODEL_CREDIT_NOTICE_VI['may-route-paid-only']).toContain('số dư nạp');
  });
});

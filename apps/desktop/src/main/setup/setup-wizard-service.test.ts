import { describe, expect, it } from 'vitest';
import { SetupWizardService } from './setup-wizard-service';

describe('SetupWizardService Izzi models', () => {
  it('uses canonical izzi-smart first and includes explicit Grok 4.5 High + GPT-5.6 Sol', () => {
    const models = SetupWizardService.getAvailableModels();
    expect(models[0]?.id).toBe('izzi-smart');
    expect(models.some((model) => model.id === 'grok-4.5-high')).toBe(true);
    expect(models.some((model) => model.id === 'gpt-5.6-sol')).toBe(true);
    expect(models[0]?.description).toContain('paid-balance-only');
    for (const id of [
      'grok-4.5-high',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]) {
      expect(models.find((model) => model.id === id)?.description).toContain('$5 free credit');
    }
  });
});

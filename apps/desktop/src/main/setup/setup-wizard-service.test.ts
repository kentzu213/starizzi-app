import { describe, expect, it } from 'vitest';
import { SetupWizardService } from './setup-wizard-service';

describe('SetupWizardService Izzi models', () => {
  it('uses canonical izzi-smart first and includes explicit Grok 4.5 High + GPT-5.6 Sol', () => {
    const models = SetupWizardService.getAvailableModels();
    expect(models[0]?.id).toBe('izzi-smart');
    expect(models.some((model) => model.id === 'grok-4.5-high')).toBe(true);
    expect(models.some((model) => model.id === 'gpt-5.6-sol')).toBe(true);
  });
});

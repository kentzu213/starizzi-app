import { DatabaseManager } from '../db/database';

export const ALLOWED_MODELS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex'] as const;
export type AllowedModel = (typeof ALLOWED_MODELS)[number];

export type AuthType = 'bearer' | 'x-api-key';
export type ActiveProvider = 'managed' | 'custom';

/** Non-secret custom provider configuration (persisted as JSON). */
export interface CustomProviderConfig {
  baseUrl: string;
  authType: AuthType;
  selectedModel: AllowedModel;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const CONFIG_KEY = 'custom_provider_config';
const ENABLED_KEY = 'custom_provider_enabled';

const AUTH_TYPES: readonly AuthType[] = ['bearer', 'x-api-key'];

/**
 * Validate a candidate custom-provider config in the MAIN process (R5.5).
 * Returns the list of concise error reasons (Vietnamese) when invalid.
 */
export function validateCustomConfig(config: Partial<CustomProviderConfig> | null | undefined): ValidationResult {
  const errors: string[] = [];

  if (!config) {
    return { ok: false, errors: ['Thiếu cấu hình custom provider'] };
  }

  // baseUrl must be a valid https URL (R5.1 / INV-4)
  if (!config.baseUrl || typeof config.baseUrl !== 'string') {
    errors.push('Base URL không được để trống');
  } else {
    try {
      const url = new URL(config.baseUrl);
      if (url.protocol !== 'https:') {
        errors.push('Base URL phải dùng https');
      }
    } catch {
      errors.push('Base URL không hợp lệ');
    }
  }

  // authType ∈ {bearer, x-api-key} (R5.4)
  if (!config.authType || !AUTH_TYPES.includes(config.authType)) {
    errors.push('Kiểu auth không hợp lệ (chỉ Bearer hoặc x-api-key)');
  }

  // selectedModel ∈ ALLOWED_MODELS (R5.2 / INV-3)
  if (!config.selectedModel || !ALLOWED_MODELS.includes(config.selectedModel as AllowedModel)) {
    errors.push('Model không thuộc danh sách cho phép');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * ProviderSettingsStore — non-secret config + enabled flag, backed by the
 * SQLite settings table via DatabaseManager. Does NOT touch the API key.
 */
export class ProviderSettingsStore {
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  /** Returns the stored config, or null if never configured / unparseable. */
  getConfig(): CustomProviderConfig | null {
    const raw = this.db.getSetting(CONFIG_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as CustomProviderConfig;
      return parsed;
    } catch {
      return null;
    }
  }

  /** Persist non-secret config (validation is the caller's responsibility). */
  saveConfig(config: CustomProviderConfig): void {
    this.db.setSetting(
      CONFIG_KEY,
      JSON.stringify({
        baseUrl: config.baseUrl,
        authType: config.authType,
        selectedModel: config.selectedModel,
      }),
    );
  }

  clearConfig(): void {
    this.db.deleteSetting(CONFIG_KEY);
  }

  isCustomEnabled(): boolean {
    return this.db.getSetting(ENABLED_KEY) === '1';
  }

  setEnabled(enabled: boolean): void {
    this.db.setSetting(ENABLED_KEY, enabled ? '1' : '0');
  }
}

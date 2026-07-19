import { DatabaseManager } from '../db/database';

// codex-lb model suggestions (validated loosely; the endpoint decides what exists).
// Verified against codex-lb /v1/models — GPT-5.6 (Sol/Terra/Luna) are the new flagships.
export const ALLOWED_MODELS = [
  'izzi-smart',
  'grok-4.5-high',
  'gcli/grok-4.5-high',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
] as const;
export type AllowedModel = (typeof ALLOWED_MODELS)[number];

export type AuthType = 'bearer' | 'x-api-key';
export type ActiveProvider = 'managed' | 'custom';

/** Non-secret custom provider configuration (persisted as JSON). */
export interface CustomProviderConfig {
  baseUrl: string;
  authType: AuthType;
  /** Model id to request. Any non-empty string (endpoint validates). */
  selectedModel: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const CONFIG_KEY = 'custom_provider_config';
const ENABLED_KEY = 'custom_provider_enabled';
const LEGACY_CODEX_LB_MIGRATION_KEY = 'custom_provider_legacy_2455_migrated_v1';

const AUTH_TYPES: readonly AuthType[] = ['bearer', 'x-api-key'];

/** Loopback/local hosts where plain http is acceptable (the user's own machine). */
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h === 'host.docker.internal';
}

/** Exact legacy desktop preset: plain HTTP, loopback, and Codex-LB port 2455. */
export function isLegacyLocalCodexLbBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === 'http:' && url.port === '2455' && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Validate a candidate custom-provider config in the MAIN process (R5.5).
 * Returns the list of concise error reasons (Vietnamese) when invalid.
 */
export function validateCustomConfig(config: Partial<CustomProviderConfig> | null | undefined): ValidationResult {
  const errors: string[] = [];

  if (!config) {
    return { ok: false, errors: ['Thiếu cấu hình custom provider'] };
  }

  // baseUrl must be https, OR http when pointing at a loopback/local endpoint
  // (e.g. codex-lb / 9router / LiteLLM at 127.0.0.1) — that stays on the machine.
  if (!config.baseUrl || typeof config.baseUrl !== 'string') {
    errors.push('Base URL không được để trống');
  } else {
    try {
      const url = new URL(config.baseUrl);
      const loopbackHttp = url.protocol === 'http:' && isLoopbackHost(url.hostname);
      if (url.protocol !== 'https:' && !loopbackHttp) {
        errors.push('Base URL phải dùng https (hoặc http với localhost/127.0.0.1)');
      }
    } catch {
      errors.push('Base URL không hợp lệ');
    }
  }

  // authType ∈ {bearer, x-api-key} (R5.4)
  if (!config.authType || !AUTH_TYPES.includes(config.authType)) {
    errors.push('Kiểu auth không hợp lệ (chỉ Bearer hoặc x-api-key)');
  }

  // selectedModel: any non-empty string (the endpoint decides which models exist).
  if (!config.selectedModel || typeof config.selectedModel !== 'string' || config.selectedModel.trim().length === 0) {
    errors.push('Model không được để trống');
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

  /**
   * One-time v1.12 migration for the retired automatic local Codex-LB route.
   *
   * Only an enabled loopback :2455 config is disabled. The config and encrypted
   * key are deliberately preserved so this migration is reversible, and the
   * marker ensures a later explicit user choice to re-enable local Codex-LB is
   * respected. No secret is read or returned by this method.
   */
  migrateLegacyLocalCodexLbConnection(): {
    migrated: boolean;
    reason: 'legacy-local-2455' | 'not-applicable' | 'already-completed';
  } {
    if (this.db.getSetting(LEGACY_CODEX_LB_MIGRATION_KEY) === '1') {
      return { migrated: false, reason: 'already-completed' };
    }

    const config = this.getConfig();
    const shouldMigrate = Boolean(
      this.isCustomEnabled() && config && isLegacyLocalCodexLbBaseUrl(config.baseUrl),
    );
    if (shouldMigrate) {
      this.setEnabled(false);
    }
    this.db.setSetting(LEGACY_CODEX_LB_MIGRATION_KEY, '1');

    return shouldMigrate
      ? { migrated: true, reason: 'legacy-local-2455' }
      : { migrated: false, reason: 'not-applicable' };
  }
}

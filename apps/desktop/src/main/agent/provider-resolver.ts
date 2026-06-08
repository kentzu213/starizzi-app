import type { ChatProvider } from './chat-provider';
import { CustomOpenAIProvider } from './custom-openai-provider';
import type { ManagedAgentProvider } from './managed-agent-provider';
import { ProviderSettingsStore, validateCustomConfig } from './provider-settings-store';
import { SecretStore } from './secret-store';

/**
 * ProviderResolver — the single place that enforces routing (managed XOR custom).
 *
 * resolve() returns the active provider for the current request:
 *  - custom disabled                         → managed (INV-6)
 *  - custom enabled but config invalid       → managed (INV-8 guard)
 *  - custom enabled but no key               → managed (INV-8 guard)
 *  - custom enabled + valid config + has key → CustomOpenAIProvider (INV-5/7)
 *
 * Note: this is a resolve-time guard only. A runtime failure of the custom
 * provider does NOT fall back to managed (R6.5) — that error surfaces to the user.
 */
export class ProviderResolver {
  private settings: ProviderSettingsStore;
  private secrets: SecretStore;
  private managed: ManagedAgentProvider;

  constructor(settings: ProviderSettingsStore, secrets: SecretStore, managed: ManagedAgentProvider) {
    this.settings = settings;
    this.secrets = secrets;
    this.managed = managed;
  }

  resolve(): ChatProvider {
    if (!this.settings.isCustomEnabled()) {
      return this.managed;
    }

    const config = this.settings.getConfig();
    const validation = validateCustomConfig(config);
    const key = this.secrets.getKey();

    if (!validation.ok || !config || !key) {
      return this.managed;
    }

    return new CustomOpenAIProvider(config, key, (text) => this.secrets.redact(text));
  }
}

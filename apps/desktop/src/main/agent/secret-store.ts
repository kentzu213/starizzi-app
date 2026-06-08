import { safeStorage } from 'electron';
import { DatabaseManager } from '../db/database';

/**
 * SecretStore — the ONLY component that touches the raw custom-provider API key.
 *
 * Reuses the exact safeStorage pattern from auth-manager.ts: encrypt with the
 * OS keychain when available and persist as base64 via DatabaseManager.setSetting.
 * The key is never written to a committed file and never logged.
 */
export class SecretStore {
  private db: DatabaseManager;
  private static readonly KEY = 'custom_provider_api_key';

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  /** Encrypt (if available) and persist the API key. Never logs the value. */
  setKey(plain: string): void {
    let encoded: string;
    if (safeStorage.isEncryptionAvailable()) {
      encoded = safeStorage.encryptString(plain).toString('base64');
    } else {
      encoded = plain;
      // R1.2: warn that OS encryption is unavailable WITHOUT logging the key value.
      this.db.appendDiagnosticEvent({
        type: 'custom_provider.secret',
        status: 'info',
        detail: 'OS encryption unavailable (safeStorage) — custom provider key stored without OS-level encryption.',
      });
    }
    this.db.setSetting(SecretStore.KEY, encoded);
  }

  /** Decrypt and return the raw key, or null if none stored. */
  getKey(): string | null {
    const stored = this.db.getSetting(SecretStore.KEY);
    if (!stored) return null;
    try {
      return safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(stored, 'base64'))
        : stored;
    } catch {
      // Corrupted/undecryptable value — treat as no key rather than leaking errors.
      return null;
    }
  }

  deleteKey(): void {
    this.db.deleteSetting(SecretStore.KEY);
  }

  hasKey(): boolean {
    return this.db.getSetting(SecretStore.KEY) !== null;
  }

  /** Masked hint exposing at most the last 4 characters (R1.4). */
  maskedHint(): string | null {
    const key = this.getKey();
    if (!key) return null;
    return '••••' + key.slice(-4);
  }

  /**
   * Redact every occurrence of the stored key from a string (R1.6/R6.4).
   * An explicit extra key (e.g. an unsaved key being tested) can also be passed.
   */
  redact(text: string, extraKey?: string | null): string {
    let result = text;
    const keys = [this.getKey(), extraKey].filter((k): k is string => !!k && k.length > 0);
    for (const key of keys) {
      result = result.split(key).join('••••');
    }
    return result;
  }
}

import type { AIProvider, ModelProviderConfig } from './agent-registry';

/**
 * Model-selection standard (Starizzi):
 *  - ONE picker lists model groups per backend.
 *  - Izzi API group is static (personas + izzi cloud).
 *  - Local connections (codex-lb / any OpenAI-compatible) are DISCOVERED live from
 *    the endpoint's /v1/models, so models added to the router later appear here
 *    automatically. Provider id is 'custom' (the app's single custom connection).
 *  - Picking a model changes the ACTIVE connection: a 'custom' model enables the
 *    custom connection with that selectedModel; 'izzi' disables it so generic
 *    agents fall back to izzi. izzi persona agents always route izzi regardless.
 *
 * Pure helpers here are unit-tested; the store performs the IPC side effects.
 */

// Map (not a plain object) so lookups can't walk the prototype chain — a raw id
// like "toString"/"__proto__" must resolve to itself, not an inherited member.
const PRETTY_NAMES = new Map<string, string>([
  ['izzi-smart', 'Izzi Smart Router'],
  ['grok-4.5-high', 'Grok 4.5 High'],
  ['gcli/grok-4.5-high', 'Grok 4.5 High (9Router upstream)'],
  ['gpt-5.6-sol', 'GPT-5.6 Sol'],
  ['gpt-5.6-terra', 'GPT-5.6 Terra'],
  ['gpt-5.6-luna', 'GPT-5.6 Luna'],
  ['gpt-5.5', 'GPT-5.5'],
  ['gpt-5.4', 'GPT-5.4'],
  ['gpt-5.4-mini', 'GPT-5.4 mini'],
]);

/** Best-effort display name for a raw model id (unknown ids shown verbatim). */
export function prettyModelName(id: string): string {
  return PRETTY_NAMES.get(id) ?? id;
}

/**
 * Build the dynamic "local" model group from discovered model ids. De-dupes,
 * drops blanks, and preserves first-seen order. Returns null when there are no
 * usable ids (so callers can omit the group cleanly).
 */
export function buildLocalModelGroup(
  models: string[],
  label = 'codex-lb (local)',
): ModelProviderConfig | null {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of models) {
    const id = (raw ?? '').trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  if (unique.length === 0) return null;
  return {
    id: 'custom',
    name: label,
    description: 'Model động từ endpoint local (/v1/models) — gọi đúng id đã chọn',
    apiKeyRequired: false,
    models: unique.map((id) => ({ id, name: prettyModelName(id), provider: 'custom' as AIProvider })),
  };
}

/**
 * What to do to the custom (local) connection when the user picks a model of the
 * given provider. 'custom' → enable + point at it; 'izzi' → disable (fall back to
 * izzi); anything else → leave the connection untouched.
 */
export function connectionActionForProvider(
  provider: AIProvider,
): 'enable-custom' | 'disable-custom' | 'none' {
  if (provider === 'custom') return 'enable-custom';
  if (provider === 'izzi') return 'disable-custom';
  return 'none';
}

/** Human label for the local group, derived from the connection's base URL. */
export function deriveEndpointLabel(baseUrl: string | undefined | null): string {
  const url = (baseUrl ?? '').toString();
  if (url.includes(':2455')) return 'codex-lb (local)';
  if (url.includes(':4000')) return '9router (local · smart-route)';
  if (/https?:\/\/(api\.)?izziapi\.com\/v1/i.test(url)) return 'Izzi API (direct)';
  if (/https?:\/\/codex\.izziapi\.com/i.test(url)) return 'codex-lb (hosted)';
  return 'Local (custom)';
}
